import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { authMiddleware, requireRole, AdminJwtPayload } from '../middlewares/auth';

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
};

type Variables = {
  user: AdminJwtPayload;
};

export const keuanganRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Seluruh endpoint keuangan hanya untuk admin terautentikasi dengan role bendahara/superadmin.
keuanganRoutes.use('/*', authMiddleware);
keuanganRoutes.use('/*', requireRole('bendahara'));

/**
 * Potongan SQL "baris efektif" untuk buku kas.
 * Baris efektif = bukan baris pembalik DAN belum pernah dibalik transaksi lain.
 * Pasangan (transaksi asli + pembaliknya) dua-duanya dikeluarkan dari laporan,
 * sehingga total & LPJ hanya menampilkan mutasi yang benar-benar berlaku.
 */
const ACTIVE_ROW = (alias = 't') =>
  `${alias}.dibatalkan = 0 AND ${alias}.reversal_of IS NULL AND ${alias}.id NOT IN (SELECT reversal_of FROM kas_transaksi WHERE reversal_of IS NOT NULL)`;

// =========================================================================
// DOMPET (Kas Tunai / Rekening)
// =========================================================================

/**
 * GET /api/keuangan/dompet
 * Daftar dompet beserta saldo terhitung
 */
keuanganRoutes.get('/dompet', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const includeInactive = c.req.query('semua') === '1';

  try {
    const sql = `
      SELECT d.*,
        COALESCE((
          SELECT SUM(CASE WHEN t.tipe = 'pemasukan' THEN t.nominal ELSE -t.nominal END)
          FROM kas_transaksi t
          WHERE t.dompet_id = d.id AND ${ACTIVE_ROW('t')}
        ), 0) AS saldo
      FROM dompet d
      ${includeInactive ? '' : 'WHERE d.aktif = 1'}
      ORDER BY d.urutan ASC, d.nama ASC
    `;
    const result = await db.prepare(sql).all<any>();
    return c.json({ data: result.results || [] });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil dompet: ' + err.message }, 500);
  }
});

/**
 * POST /api/keuangan/dompet
 */
keuanganRoutes.post('/dompet', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const body = await c.req.json().catch(() => ({}));
  const nama = (body.nama as string)?.trim();
  const jenis = (body.jenis as string) === 'tunai' ? 'tunai' : 'rekening';
  const nomorRekening = ((body.nomor_rekening as string) || '').trim() || null;
  const atasNama = ((body.atas_nama as string) || '').trim() || null;

  if (!nama) return c.json({ error: 'Nama dompet wajib diisi' }, 400);
  if (jenis === 'rekening' && !nomorRekening) {
    return c.json({ error: 'Nomor rekening wajib untuk dompet jenis rekening' }, 400);
  }

  try {
    const maxRow = await db.prepare(`SELECT COALESCE(MAX(urutan), 0) AS m FROM dompet`).first<{ m: number }>();
    const id = 'dmp_' + nanoid(8);
    await db
      .prepare(
        `INSERT INTO dompet (id, nama, jenis, nomor_rekening, atas_nama, aktif, urutan)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .bind(id, nama, jenis, nomorRekening, atasNama, (maxRow?.m || 0) + 1)
      .run();
    return c.json({ success: true, data: { id, nama, jenis, nomor_rekening: nomorRekening, atas_nama: atasNama } }, 201);
  } catch (err: any) {
    return c.json({ error: 'Gagal menambah dompet: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/keuangan/dompet/:id
 */
keuanganRoutes.patch('/dompet/:id', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  try {
    const existing = await db.prepare(`SELECT * FROM dompet WHERE id = ?`).bind(id).first<any>();
    if (!existing) return c.json({ error: 'Dompet tidak ditemukan' }, 404);

    const nama = body.nama !== undefined ? String(body.nama).trim() : existing.nama;
    const nomorRekening =
      body.nomor_rekening !== undefined ? (String(body.nomor_rekening).trim() || null) : existing.nomor_rekening;
    const atasNama = body.atas_nama !== undefined ? (String(body.atas_nama).trim() || null) : existing.atas_nama;
    const aktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : existing.aktif;

    await db
      .prepare(`UPDATE dompet SET nama = ?, nomor_rekening = ?, atas_nama = ?, aktif = ? WHERE id = ?`)
      .bind(nama, nomorRekening, atasNama, aktif, id)
      .run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: 'Gagal memperbarui dompet: ' + err.message }, 500);
  }
});

// =========================================================================
// POS KAS (Pendaftaran, Sponsori, Donasi, Konsumsi, dst.)
// =========================================================================

keuanganRoutes.get('/pos', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const tipe = c.req.query('tipe');
  const includeInactive = c.req.query('semua') === '1';

  try {
    let sql = `SELECT * FROM kas_pos WHERE 1=1`;
    const params: any[] = [];
    if (tipe === 'pemasukan' || tipe === 'pengeluaran') {
      sql += ` AND tipe = ?`;
      params.push(tipe);
    }
    if (!includeInactive) sql += ` AND aktif = 1`;
    sql += ` ORDER BY tipe ASC, urutan ASC, nama ASC`;

    const stmt = db.prepare(sql);
    const result = params.length ? await stmt.bind(...params).all<any>() : await stmt.all<any>();
    return c.json({ data: result.results || [] });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil pos kas: ' + err.message }, 500);
  }
});

keuanganRoutes.post('/pos', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const body = await c.req.json().catch(() => ({}));
  const nama = (body.nama as string)?.trim();
  const tipe = body.tipe as string;
  const deskripsi = ((body.deskripsi as string) || '').trim() || null;

  if (!nama) return c.json({ error: 'Nama pos wajib diisi' }, 400);
  if (tipe !== 'pemasukan' && tipe !== 'pengeluaran') {
    return c.json({ error: 'Tipe pos harus pemasukan atau pengeluaran' }, 400);
  }

  try {
    const maxRow = await db
      .prepare(`SELECT COALESCE(MAX(urutan), 0) AS m FROM kas_pos WHERE tipe = ?`)
      .bind(tipe)
      .first<{ m: number }>();
    const id = 'pos_' + nanoid(8);
    await db
      .prepare(
        `INSERT INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES (?, ?, ?, ?, 1, ?)`
      )
      .bind(id, nama, tipe, deskripsi, (maxRow?.m || 0) + 1)
      .run();
    return c.json({ success: true, data: { id, nama, tipe, deskripsi } }, 201);
  } catch (err: any) {
    return c.json({ error: 'Gagal menambah pos: ' + err.message }, 500);
  }
});

keuanganRoutes.patch('/pos/:id', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  try {
    const existing = await db.prepare(`SELECT * FROM kas_pos WHERE id = ?`).bind(id).first<any>();
    if (!existing) return c.json({ error: 'Pos tidak ditemukan' }, 404);

    const nama = body.nama !== undefined ? String(body.nama).trim() : existing.nama;
    const deskripsi = body.deskripsi !== undefined ? (String(body.deskripsi).trim() || null) : existing.deskripsi;
    const aktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : existing.aktif;

    await db.prepare(`UPDATE kas_pos SET nama = ?, deskripsi = ?, aktif = ? WHERE id = ?`).bind(nama, deskripsi, aktif, id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: 'Gagal memperbarui pos: ' + err.message }, 500);
  }
});

// =========================================================================
// TRANSAKSI KAS
// =========================================================================

/**
 * GET /api/keuangan/transaksi
 * Buku kas. Filter: tipe, pos_id, dompet_id, dari, sampai, search, page, limit
 */
keuanganRoutes.get('/transaksi', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const tipe = c.req.query('tipe') || 'semua';
  const posId = c.req.query('pos_id');
  const dompetId = c.req.query('dompet_id');
  const dari = c.req.query('dari');
  const sampai = c.req.query('sampai');
  const search = c.req.query('search')?.trim();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
  const offset = (page - 1) * limit;

  try {
    let where = ` WHERE 1=1`;
    const params: any[] = [];

    if (tipe === 'pemasukan' || tipe === 'pengeluaran') {
      where += ` AND t.tipe = ?`;
      params.push(tipe);
    }
    if (posId) {
      where += ` AND t.pos_id = ?`;
      params.push(posId);
    }
    if (dompetId) {
      where += ` AND t.dompet_id = ?`;
      params.push(dompetId);
    }
    if (dari) {
      where += ` AND t.tanggal >= ?`;
      params.push(dari);
    }
    if (sampai) {
      where += ` AND t.tanggal <= ?`;
      params.push(sampai);
    }
    if (search) {
      where += ` AND (t.keterangan LIKE ? OR p.nama LIKE ? OR d.nama LIKE ? OR g.pic_nama LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const baseFrom = `
      FROM kas_transaksi t
      LEFT JOIN kas_pos p ON t.pos_id = p.id
      LEFT JOIN dompet d ON t.dompet_id = d.id
      LEFT JOIN pendaftaran_grup g ON t.grup_id = g.id
    `;

    const countRow = await (params.length
      ? db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).bind(...params).first<{ total: number }>()
      : db.prepare(`SELECT COUNT(*) AS total ${baseFrom} ${where}`).first<{ total: number }>());
    const total = countRow?.total || 0;

    const listParams = [...params, limit, offset];
    const rows = await db
      .prepare(
        `SELECT t.*, p.nama AS pos_nama, p.tipe AS pos_tipe, d.nama AS dompet_nama, d.jenis AS dompet_jenis,
                g.pic_nama AS grup_pic, g.nomor_grup
         ${baseFrom} ${where}
         ORDER BY t.tanggal DESC, t.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...listParams)
      .all<any>();

    return c.json({
      data: rows.results || [],
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil transaksi: ' + err.message }, 500);
  }
});

/**
 * POST /api/keuangan/transaksi
 * Input manual pemasukan (sponsor/donasi) atau pengeluaran
 */
keuanganRoutes.post('/transaksi', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const tipe = body.tipe as string;
  const posId = (body.pos_id as string)?.trim();
  const dompetId = (body.dompet_id as string)?.trim();
  const nominal = parseInt(body.nominal, 10);
  const keterangan = ((body.keterangan as string) || '').trim() || null;
  const tanggal = ((body.tanggal as string) || '').trim() || new Date().toISOString().slice(0, 10);

  if (tipe !== 'pemasukan' && tipe !== 'pengeluaran') {
    return c.json({ error: 'Tipe transaksi tidak valid' }, 400);
  }
  if (!posId || !dompetId) {
    return c.json({ error: 'Pos dan dompet wajib dipilih' }, 400);
  }
  if (!Number.isFinite(nominal) || nominal <= 0) {
    return c.json({ error: 'Nominal harus angka lebih dari 0' }, 400);
  }

  try {
    const pos = await db.prepare(`SELECT id, tipe, nama, aktif FROM kas_pos WHERE id = ?`).bind(posId).first<any>();
    if (!pos) return c.json({ error: 'Pos tidak ditemukan' }, 404);
    if (pos.tipe !== tipe) return c.json({ error: `Pos "${pos.nama}" bukan pos ${tipe}` }, 400);

    const dompet = await db.prepare(`SELECT id, nama, jenis FROM dompet WHERE id = ?`).bind(dompetId).first<any>();
    if (!dompet) return c.json({ error: 'Dompet tidak ditemukan' }, 404);

    // Cegah saldo minus untuk pengeluaran
    if (tipe === 'pengeluaran') {
      const saldoRow = await db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN tipe = 'pemasukan' THEN nominal ELSE -nominal END), 0) AS saldo
           FROM kas_transaksi t WHERE dompet_id = ? AND ${ACTIVE_ROW('t')}`
        )
        .bind(dompetId)
        .first<{ saldo: number }>();
      if ((saldoRow?.saldo || 0) < nominal) {
        return c.json(
          { error: `Saldo ${dompet.nama} tidak mencukupi (tersedia Rp ${(saldoRow?.saldo || 0).toLocaleString('id-ID')})` },
          400
        );
      }
    }

    const id = 'kas_' + nanoid(10);
    await db
      .prepare(
        `INSERT INTO kas_transaksi (id, tipe, pos_id, dompet_id, nominal, keterangan, grup_id, nota_url, tanggal, created_by)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .bind(id, tipe, posId, dompetId, nominal, keterangan, tanggal, user?.nama || user?.username || 'Panitia')
      .run();

    return c.json({ success: true, data: { id } }, 201);
  } catch (err: any) {
    return c.json({ error: 'Gagal menyimpan transaksi: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/keuangan/transaksi/:id/batal
 * Membatalkan transaksi manual dengan jurnal pembalik
 */
keuanganRoutes.patch('/transaksi/:id/batal', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const user = c.get('user');
  const id = c.req.param('id');

  try {
    const trx = await db.prepare(`SELECT * FROM kas_transaksi WHERE id = ?`).bind(id).first<any>();
    if (!trx) return c.json({ error: 'Transaksi tidak ditemukan' }, 404);
    if (trx.dibatalkan) return c.json({ error: 'Transaksi sudah dibatalkan' }, 400);
    if (trx.grup_id) {
      return c.json(
        { error: 'Transaksi dari verifikasi pembayaran dibatalkan lewat menu Verifikasi (Batalkan Lunas).' },
        400
      );
    }
    // Sudah pernah dibalik?
    const already = await db
      .prepare(`SELECT id FROM kas_transaksi WHERE reversal_of = ?`)
      .bind(id)
      .first<{ id: string }>();
    if (already) return c.json({ error: 'Transaksi sudah pernah dibatalkan.' }, 400);

    const balikId = 'kas_' + nanoid(10);
    const tipeBalik = trx.tipe === 'pemasukan' ? 'pengeluaran' : 'pemasukan';
    await db
      .prepare(
        `INSERT INTO kas_transaksi (id, tipe, pos_id, dompet_id, nominal, keterangan, grup_id, nota_url, reversal_of, tanggal, created_by)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      )
      .bind(
        balikId,
        tipeBalik,
        trx.pos_id,
        trx.dompet_id,
        trx.nominal,
        `Pembatalan: ${trx.keterangan || id}`,
        id,
        new Date().toISOString().slice(0, 10),
        user?.nama || user?.username || 'Panitia'
      )
      .run();

    return c.json({ success: true, message: 'Transaksi dibatalkan dengan jurnal pembalik' });
  } catch (err: any) {
    return c.json({ error: 'Gagal membatalkan transaksi: ' + err.message }, 500);
  }
});

// =========================================================================
// RINGKASAN & LPJ
// =========================================================================

/**
 * GET /api/keuangan/ringkasan
 * Saldo total, per dompet, per pos; pemasukan & pengeluaran
 */
keuanganRoutes.get('/ringkasan', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const dari = c.req.query('dari');
  const sampai = c.req.query('sampai');

  try {
    const dateFilter = (alias = 't') => {
      let f = ` AND ${ACTIVE_ROW(alias)}`;
      if (dari) f += ` AND ${alias}.tanggal >= '${dari.replace(/'/g, '')}'`;
      if (sampai) f += ` AND ${alias}.tanggal <= '${sampai.replace(/'/g, '')}'`;
      return f;
    };

    const totals = await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN t.tipe = 'pemasukan' THEN t.nominal ELSE 0 END), 0) AS total_pemasukan,
           COALESCE(SUM(CASE WHEN t.tipe = 'pengeluaran' THEN t.nominal ELSE 0 END), 0) AS total_pengeluaran
         FROM kas_transaksi t WHERE 1=1 ${dateFilter()}`
      )
      .first<{ total_pemasukan: number; total_pengeluaran: number }>();

    // Saldo keseluruhan = semua waktu (tidak terpengaruh filter tanggal), saldo dompet juga
    const perDompet = await db
      .prepare(
        `SELECT d.id, d.nama, d.jenis, d.nomor_rekening,
           COALESCE((SELECT SUM(CASE WHEN t.tipe='pemasukan' THEN t.nominal ELSE -t.nominal END)
                     FROM kas_transaksi t WHERE t.dompet_id = d.id AND ${ACTIVE_ROW('t')}), 0) AS saldo
         FROM dompet d WHERE d.aktif = 1 ORDER BY d.urutan ASC`
      )
      .all<any>();

    const perPos = await db
      .prepare(
        `SELECT p.id, p.nama, p.tipe,
           COALESCE(SUM(t.nominal), 0) AS total
         FROM kas_pos p
         LEFT JOIN kas_transaksi t ON t.pos_id = p.id ${dateFilter('t')}
         WHERE p.aktif = 1
         GROUP BY p.id
         ORDER BY p.tipe ASC, p.urutan ASC`
      )
      .all<any>();

    const pemasukan = totals?.total_pemasukan || 0;
    const pengeluaran = totals?.total_pengeluaran || 0;

    return c.json({
      dari: dari || null,
      sampai: sampai || null,
      total_pemasukan: pemasukan,
      total_pengeluaran: pengeluaran,
      saldo: pemasukan - pengeluaran,
      per_dompet: perDompet.results || [],
      per_pos: perPos.results || [],
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil ringkasan: ' + err.message }, 500);
  }
});

/**
 * GET /api/keuangan/lpj
 * Laporan LPJ: rekap per pos + daftar transaksi dalam rentang tanggal
 */
keuanganRoutes.get('/lpj', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const dari = (c.req.query('dari') || '').replace(/'/g, '');
  const sampai = (c.req.query('sampai') || '').replace(/'/g, '');

  try {
    let where = `WHERE ${ACTIVE_ROW('t')}`;
    if (dari) where += ` AND t.tanggal >= '${dari}'`;
    if (sampai) where += ` AND t.tanggal <= '${sampai}'`;

    const rekap = await db
      .prepare(
        `SELECT p.id AS pos_id, p.nama AS pos_nama, p.tipe AS pos_tipe,
                COALESCE(SUM(t.nominal), 0) AS total, COUNT(t.id) AS jumlah
         FROM kas_transaksi t JOIN kas_pos p ON t.pos_id = p.id
         ${where}
         GROUP BY p.id ORDER BY p.tipe ASC, total DESC`
      )
      .all<any>();

    const transaksi = await db
      .prepare(
        `SELECT t.tanggal, t.tipe, t.nominal, t.keterangan, p.nama AS pos_nama, d.nama AS dompet_nama,
                g.pic_nama AS grup_pic, g.nomor_grup
         FROM kas_transaksi t
         LEFT JOIN kas_pos p ON t.pos_id = p.id
         LEFT JOIN dompet d ON t.dompet_id = d.id
         LEFT JOIN pendaftaran_grup g ON t.grup_id = g.id
         ${where}
         ORDER BY t.tanggal ASC, t.created_at ASC`
      )
      .all<any>();

    return c.json({
      dari: dari || null,
      sampai: sampai || null,
      rekap: rekap.results || [],
      transaksi: transaksi.results || [],
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal menyusun LPJ: ' + err.message }, 500);
  }
});
