import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { authMiddleware, createAdminToken, getJwtSecret, requireRole, AdminJwtPayload } from '../middlewares/auth';
import { WALinkService, renderWaTemplate } from '../services/wa-link';
import { verifyPassword, hashPassword } from '../services/auth-helper';
import { StorageService } from '../services/storage';
import { getKategoriUsia, getKategoriUsiaLabel, isBerbayar, KATEGORI_USIA } from '../services/peserta-rules';

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
  PESERTA_BASE_URL?: string;
};

type Variables = {
  user: AdminJwtPayload;
  jwtPayload: AdminJwtPayload;
};

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * POST /api/admin/login
 * Login panitia/admin menggunakan username & password
 */
adminRoutes.post('/login', async (c) => {
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const username = (body.username as string)?.trim();
  const password = body.password as string;

  if (!username || !password) {
    return c.json({ error: 'Username dan password wajib diisi' }, 400);
  }

  let secret: string;
  try {
    secret = getJwtSecret(c);
  } catch (configErr: any) {
    console.error('[Auth] Konfigurasi JWT tidak valid:', configErr.message);
    return c.json({ error: 'Konfigurasi server tidak valid: JWT_SECRET belum diatur' }, 500);
  }

  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  try {
    const user = await db
      .prepare(`SELECT id, username, password_hash, nama, role FROM admin_users WHERE username = ?`)
      .bind(username)
      .first<{
        id: string;
        username: string;
        password_hash: string;
        nama: string;
        role: string;
      }>();

    if (!user) {
      return c.json({ error: 'Username atau password salah' }, 401);
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return c.json({ error: 'Username atau password salah' }, 401);
    }

    const token = await createAdminToken(
      {
        id: user.id,
        username: user.username,
        nama: user.nama,
        role: user.role,
      },
      secret
    );

    return c.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        nama: user.nama,
        role: user.role,
      },
    });
  } catch (err: any) {
    console.error('Error saat login admin:', err);
    return c.json({ error: 'Terjadi kesalahan sistem saat login: ' + err.message }, 500);
  }
});

/**
 * Route di bawah ini membutuhkan otentikasi admin
 */
adminRoutes.use('/*', authMiddleware);

/**
 * GET /api/admin/pendaftar
 * Mengambil daftar pendaftar dengan filter status dan pencarian
 */
adminRoutes.get('/pendaftar', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const status = c.req.query('status');
  const search = c.req.query('search')?.trim();

  try {
    let sql = `SELECT id, nama, email, no_whatsapp, instansi, jenis_kelamin, nip, domisili, alasan, screenshot_url, qr_code_url, qr_token, status, alasan_tolak, wa_terkirim, created_at, confirmed_at, attended_at, confirmed_by, wa_sent_by FROM pendaftar WHERE 1=1`;
    const params: any[] = [];

    if (status && status !== 'semua') {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (search) {
      sql += ` AND (nama LIKE ? OR no_whatsapp LIKE ? OR instansi LIKE ? OR COALESCE(nip, '') LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status === 'hadir') {
      sql += ` ORDER BY attended_at DESC, created_at DESC`;
    } else if (status === 'dikonfirmasi') {
      sql += ` ORDER BY COALESCE(confirmed_at, created_at) DESC`;
    } else {
      sql += ` ORDER BY COALESCE(attended_at, confirmed_at, created_at) DESC`;
    }

    const stmt = db.prepare(sql);
    const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

    const data = result.results || [];

    c.header('x-total-count', String(data.length));
    return c.json({
      data,
      total: data.length,
    });
  } catch (err: any) {
    console.error('Error list pendaftar:', err);
    return c.json({ error: 'Gagal mengambil data pendaftar: ' + err.message }, 500);
  }
});

/**
 * GET /api/admin/pendaftar/:id
 * Detail pendaftar tertentu
 */
adminRoutes.get('/pendaftar/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  try {
    const record = await db
      .prepare(`SELECT * FROM pendaftar WHERE id = ?`)
      .bind(id)
      .first();

    if (!record) {
      return c.json({ error: 'Pendaftar tidak ditemukan' }, 404);
    }

    return c.json({ data: record });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil detail pendaftar: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/admin/pendaftar/:id/konfirmasi
 * Konfirmasi pendaftar: Generate QR token unik, ubah status, buat link WhatsApp
 */
adminRoutes.patch('/pendaftar/:id/konfirmasi', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  try {
    const pendaftar = await db
      .prepare(`SELECT * FROM pendaftar WHERE id = ?`)
      .bind(id)
      .first<{
        id: string;
        nama: string;
        no_whatsapp: string;
        qr_token: string | null;
        status: string;
        jenis_kelamin?: string;
        nip?: string;
        instansi?: string;
      }>();

    if (!pendaftar) {
      return c.json({ error: 'Pendaftar tidak ditemukan' }, 404);
    }

    // Token QR unik untuk validasi scan absensi
    const qrToken = pendaftar.qr_token || 'qr_' + nanoid(12);
    const qrCodeUrl = `/api/peserta/qr/${qrToken}`;

    const user = c.get('user');
    const confirmedBy = user?.nama || user?.username || 'Panitia';

    await db
      .prepare(
        `UPDATE pendaftar
         SET status = 'dikonfirmasi',
             qr_token = ?,
             qr_code_url = ?,
             confirmed_at = CURRENT_TIMESTAMP,
             confirmed_by = ?
         WHERE id = ?`
      )
      .bind(qrToken, qrCodeUrl, confirmedBy, id)
      .run();

    // Buat link wa.me
    const siteUrl = c.req.header('Origin') || 'http://localhost:3001';
    const waUrl = WALinkService.generateLink({
      phoneNumber: pendaftar.no_whatsapp,
      namaPeserta: pendaftar.nama,
      jenisKelamin: pendaftar.jenis_kelamin,
      nip: pendaftar.nip || pendaftar.instansi,
      siteUrl,
    });

    return c.json({
      success: true,
      message: 'Pendaftar berhasil dikonfirmasi',
      qr_token: qrToken,
      qr_code_url: qrCodeUrl,
      wa_url: waUrl,
    });
  } catch (err: any) {
    console.error('Error konfirmasi:', err);
    return c.json({ error: 'Gagal mengonfirmasi pendaftar: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/admin/pendaftar/:id/tolak
 * Menolak pendaftar dengan alasan tertentu
 */
adminRoutes.patch('/pendaftar/:id/tolak', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const alasan = (body.alasan as string)?.trim() || 'Data tidak memenuhi syarat';

  try {
    await db
      .prepare(
        `UPDATE pendaftar
         SET status = 'ditolak',
             alasan_tolak = ?
         WHERE id = ?`
      )
      .bind(alasan, id)
      .run();

    return c.json({
      success: true,
      message: 'Pendaftar telah ditolak',
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal menolak pendaftar: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/admin/pendaftar/:id/mark-wa-sent
 * Menandai bahwa link WA sudah dibuka/dikirim oleh panitia
 */
adminRoutes.patch('/pendaftar/:id/mark-wa-sent', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  try {
    const user = c.get('user');
    const waSentBy = user?.nama || user?.username || 'Panitia';

    await db
      .prepare(`UPDATE pendaftar SET wa_terkirim = 1, wa_sent_by = ? WHERE id = ?`)
      .bind(waSentBy, id)
      .run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: 'Gagal update status WA: ' + err.message }, 500);
  }
});

/**
 * DELETE /api/admin/pendaftar/:id
 * Menghapus data pendaftar dan membersihkan file screenshot di R2 jika ada
 */
adminRoutes.delete('/pendaftar/:id', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const id = c.req.param('id');
  const storage = new StorageService(c.env.STORAGE);

  try {
    const record = await db
      .prepare(`SELECT id, nama, screenshot_url FROM pendaftar WHERE id = ?`)
      .bind(id)
      .first<{ id: string; nama: string; screenshot_url: string | null }>();

    if (!record) {
      return c.json({ error: 'Data pendaftar tidak ditemukan' }, 404);
    }

    // Bersihkan file di R2 jika ada
    if (record.screenshot_url) {
      try {
        const match = record.screenshot_url.match(/\/api\/peserta\/screenshot\/(.+)$/);
        if (match) {
          const key = decodeURIComponent(match[1]);
          await storage.delete(key);
        }
      } catch (fileErr) {
        console.warn('Gagal menghapus file R2:', fileErr);
      }
    }

    // Hapus dari database D1
    await db.prepare(`DELETE FROM pendaftar WHERE id = ?`).bind(id).run();

    return c.json({
      success: true,
      message: `Pendaftar ${record.nama} berhasil dihapus`,
    });
  } catch (err: any) {
    console.error('Error saat menghapus pendaftar:', err);
    return c.json({ error: 'Gagal menghapus pendaftar: ' + err.message }, 500);
  }
});

/**
 * GET /api/admin/me
 * Mendapatkan profil admin yang sedang login
 */
adminRoutes.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Tidak terotentikasi' }, 401);
  }
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      nama: user.nama,
      role: user.role,
    },
  });
});

/**
 * GET /api/admin/users
 * Mendapatkan daftar admin/pengguna (Khusus Superadmin)
 */
adminRoutes.get('/users', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser || currentUser.role !== 'superadmin') {
    return c.json({ error: 'Akses terbatas hanya untuk Superadmin' }, 403);
  }

  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  try {
    const result = await db
      .prepare(`SELECT id, username, nama, role, created_at FROM admin_users ORDER BY created_at DESC`)
      .all();
    return c.json({ users: result.results || [] });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil daftar pengguna: ' + err.message }, 500);
  }
});

/**
 * POST /api/admin/users
 * Menambahkan admin/pengguna baru (Khusus Superadmin)
 */
adminRoutes.post('/users', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser || currentUser.role !== 'superadmin') {
    return c.json({ error: 'Akses terbatas hanya untuk Superadmin' }, 403);
  }

  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const username = (body.username as string)?.trim().toLowerCase();
  const password = body.password as string;
  const nama = (body.nama as string)?.trim();
  const role = (body.role as string)?.trim().toLowerCase() || 'panitia';

  if (!username || !password || !nama) {
    return c.json({ error: 'Nama, username, dan password wajib diisi' }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: 'Password minimal 6 karakter' }, 400);
  }

  if (!role || role.length < 2) {
    return c.json({ error: 'Role wajib diisi (minimal 2 karakter)' }, 400);
  }

  try {
    const existing = await db
      .prepare(`SELECT id FROM admin_users WHERE username = ?`)
      .bind(username)
      .first();

    if (existing) {
      return c.json({ error: 'Username sudah digunakan' }, 400);
    }

    const id = 'usr_' + nanoid(10);
    const passwordHash = await hashPassword(password);

    await db
      .prepare(
        `INSERT INTO admin_users (id, username, password_hash, nama, role)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, username, passwordHash, nama, role)
      .run();

    return c.json(
      {
        success: true,
        message: 'Pengguna berhasil ditambahkan',
        user: { id, username, nama, role },
      },
      201
    );
  } catch (err: any) {
    return c.json({ error: 'Gagal menambahkan pengguna: ' + err.message }, 500);
  }
});

/**
 * DELETE /api/admin/users/:id
 * Menghapus admin/pengguna (Khusus Superadmin)
 */
adminRoutes.delete('/users/:id', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser || currentUser.role !== 'superadmin') {
    return c.json({ error: 'Akses terbatas hanya untuk Superadmin' }, 403);
  }

  const id = c.req.param('id');
  if (id === currentUser.id || id === 'admin_master') {
    return c.json({ error: 'Tidak dapat menghapus akun Anda sendiri atau akun master' }, 400);
  }

  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  try {
    await db.prepare(`DELETE FROM admin_users WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: 'Pengguna berhasil dihapus' });
  } catch (err: any) {
    return c.json({ error: 'Gagal menghapus pengguna: ' + err.message }, 500);
  }
});

/**
 * GET /api/admin/settings/pendaftaran
 * Mendapatkan status buka/tutup pendaftaran peserta (Khusus Superadmin)
 */
adminRoutes.get('/settings/pendaftaran', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser || currentUser.role !== 'superadmin') {
    return c.json({ error: 'Akses terbatas hanya untuk Superadmin' }, 403);
  }

  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  try {
    const row = await db
      .prepare(`SELECT value, updated_at FROM app_settings WHERE key = 'pendaftaran_buka'`)
      .first<{ value: string; updated_at?: string }>();

    const pendaftaran_buka = row ? row.value === 'true' || row.value === '1' : true;

    return c.json({
      success: true,
      pendaftaran_buka,
      updated_at: row?.updated_at || null,
    });
  } catch (err: any) {
    return c.json({
      success: true,
      pendaftaran_buka: true,
      updated_at: null,
    });
  }
});

/**
 * PATCH /api/admin/settings/pendaftaran
 * Mengubah status buka/tutup pendaftaran peserta (Khusus Superadmin)
 */
adminRoutes.patch('/settings/pendaftaran', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser || currentUser.role !== 'superadmin') {
    return c.json({ error: 'Akses terbatas hanya untuk Superadmin' }, 403);
  }

  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const pendaftaran_buka = Boolean(body.pendaftaran_buka);

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('pendaftaran_buka', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .bind(pendaftaran_buka ? 'true' : 'false')
      .run();

    return c.json({
      success: true,
      message: `Pendaftaran berhasil ${pendaftaran_buka ? 'dibuka' : 'ditutup'}`,
      pendaftaran_buka,
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal memperbarui status pendaftaran: ' + err.message }, 500);
  }
});

// =========================================================================
// ENDPOINT ADMIN: Kelola Grup Pendaftar Family Camp & Add-on
// =========================================================================

/**
 * GET /api/admin/grup
 * Mengambil daftar pendaftaran grup Family Camp
 */
adminRoutes.get('/grup', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const status = c.req.query('status');
  const search = c.req.query('search')?.trim();

  try {
    let sql = `SELECT * FROM pendaftaran_grup WHERE 1=1`;
    const params: any[] = [];

    if (status && status !== 'semua') {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (search) {
      sql += ` AND (pic_nama LIKE ? OR pic_whatsapp LIKE ? OR id LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY created_at DESC`;

    const stmt = db.prepare(sql);
    const result = params.length > 0 ? await stmt.bind(...params).all<any>() : await stmt.all<any>();
    const groups = result.results || [];

    // Sertakan preview anggota ringkas
    const enriched = [];
    for (const g of groups) {
      const anggotaRes = await db
        .prepare(`SELECT id, nama, peran, jenis_kelamin, usia, is_gratis, qr_token, status_hadir FROM anggota WHERE grup_id = ?`)
        .bind(g.id)
        .all();
      enriched.push({
        ...g,
        anggota: anggotaRes.results || [],
      });
    }

    c.header('x-total-count', String(enriched.length));
    return c.json({
      data: enriched,
      total: enriched.length,
    });
  } catch (err: any) {
    console.error('Error list pendaftaran grup:', err);
    return c.json({ error: 'Gagal mengambil data pendaftaran grup: ' + err.message }, 500);
  }
});
/**
 * GET /api/admin/grup/:id
 * Detail pendaftaran grup beserta seluruh anggota dan add-on yang dipilih
 */
adminRoutes.get('/grup/:id', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const id = c.req.param('id');

  try {
    const grup = await db.prepare(`SELECT * FROM pendaftaran_grup WHERE id = ?`).bind(id).first<any>();
    if (!grup) {
      return c.json({ error: 'Pendaftaran grup tidak ditemukan' }, 404);
    }

    const anggotaRes = await db
      .prepare(`SELECT * FROM anggota WHERE grup_id = ? ORDER BY created_at ASC`)
      .bind(id)
      .all();

    const addonsRes = await db
      .prepare(`SELECT * FROM pendaftaran_addons WHERE grup_id = ?`)
      .bind(id)
      .all();

    return c.json({
      data: {
        ...grup,
        anggota: anggotaRes.results || [],
        addons: addonsRes.results || [],
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil detail grup: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/admin/grup/:id/konfirmasi
 * Konfirmasi pendaftaran grup: set lunas, generate QR token semua anggota,
 * dan catat pemasukan kas otomatis (idempotent).
 *
 * Body (opsional):
 *   - nominal_dibayar: nominal uang yang benar-benar diterima (default = grand_total)
 *   - dompet_id: dompet tujuan (default = dmp_bca_syariah / dompet rekening aktif pertama)
 *
 * Aturan selisih:
 *   - nominal > 0 & < grand_total: pemasukan sebesar nominal, status tetap lunas,
 *     selisih negatif (kekurangan) disimpan di selisih_bayar.
 *   - nominal > grand_total: pendaftaran sebesar grand_total, kelebihannya dicatat
 *     ke pos "Kelebihan Bayar".
 */
adminRoutes.patch('/grup/:id/konfirmasi', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const id = c.req.param('id');
  const user = c.get('user');
  const confirmedBy = user?.nama || user?.username || 'Panitia';
  const body = await c.req.json().catch(() => ({}));

  try {
    const grup = await db
      .prepare(`SELECT * FROM pendaftaran_grup WHERE id = ?`)
      .bind(id)
      .first<any>();

    if (!grup) {
      return c.json({ error: 'Pendaftaran grup tidak ditemukan' }, 404);
    }

    if (grup.status === 'lunas') {
      return c.json({ error: 'Grup sudah berstatus LUNAS. Gunakan Batalkan Lunas bila perlu perubahan.' }, 409);
    }

    const grandTotal = Number(grup.grand_total) || 0;
    let nominalDibayar =
      body.nominal_dibayar !== undefined && body.nominal_dibayar !== null && body.nominal_dibayar !== ''
        ? parseInt(body.nominal_dibayar, 10)
        : grandTotal;

    if (!Number.isFinite(nominalDibayar) || nominalDibayar <= 0) {
      return c.json({ error: 'Nominal diterima harus angka lebih dari 0' }, 400);
    }

    // Dompet tujuan
    let dompetId: string | undefined = (body.dompet_id as string)?.trim() || undefined;
    if (!dompetId) {
      const d = await db
        .prepare(`SELECT id FROM dompet WHERE aktif = 1 AND jenis = 'rekening' ORDER BY urutan ASC LIMIT 1`)
        .first<{ id: string }>();
      dompetId = d?.id;
    }
    if (!dompetId) {
      return c.json({ error: 'Belum ada dompet rekening aktif. Atur dompet pada menu Keuangan.' }, 400);
    }
    const dompetTujuanId = dompetId;
    const dompet = await db.prepare(`SELECT id, nama FROM dompet WHERE id = ?`).bind(dompetTujuanId).first<any>();
    if (!dompet) {
      return c.json({ error: 'Dompet tujuan tidak ditemukan' }, 400);
    }

    const posPendaftaran = await db.prepare(`SELECT id FROM kas_pos WHERE id = 'pos_pendaftaran'`).first<{ id: string }>();
    const posKelebihan = await db.prepare(`SELECT id FROM kas_pos WHERE id = 'pos_kelebihan_bayar'`).first<{ id: string }>();

    if (!posPendaftaran?.id || !posKelebihan?.id) {
      return c.json({ error: 'Pos kas "Pendaftaran" / "Kelebihan Bayar" tidak ditemukan.' }, 500);
    }

    const selisih = nominalDibayar - grandTotal;
    const nominalPendaftaran = selisih > 0 ? grandTotal : nominalDibayar;
    const nominalKelebihan = selisih > 0 ? selisih : 0;
    const tanggal = new Date().toISOString().slice(0, 10);

    // 1. Update status grup menjadi 'lunas'
    await db
      .prepare(
        `UPDATE pendaftaran_grup
         SET status = 'lunas',
             nominal_dibayar = ?,
             selisih_bayar = ?,
             confirmed_at = CURRENT_TIMESTAMP,
             confirmed_by = ?
         WHERE id = ?`
      )
      .bind(nominalDibayar, selisih, confirmedBy, id)
      .run();

    // 2. Catat pemasukan kas. Baris yang sudah dibalik (memiliki reversal) diabaikan
    //    sehingga konfirmasi ulang setelah batal-lunas mencatat baris baru dengan benar.
    const existingKas = await db
      .prepare(
        `SELECT id FROM kas_transaksi
         WHERE grup_id = ? AND reversal_of IS NULL
           AND id NOT IN (SELECT reversal_of FROM kas_transaksi WHERE reversal_of IS NOT NULL)
         LIMIT 1`
      )
      .bind(id)
      .first<{ id: string }>();

    if (!existingKas) {
      const kasId = 'kas_' + nanoid(10);
      const kat = grup.pic_nama || grup.nomor_grup || id;
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO kas_transaksi (id, tipe, pos_id, dompet_id, nominal, keterangan, grup_id, tanggal, created_by)
             VALUES (?, 'pemasukan', ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            kasId,
            posPendaftaran.id,
            dompetTujuanId,
            nominalPendaftaran,
            `Pendaftaran ${grup.nomor_grup || ''} - ${kat}`.trim(),
            id,
            tanggal,
            confirmedBy
          ),
      ];
      if (nominalKelebihan > 0) {
        statements.push(
          db
            .prepare(
              `INSERT INTO kas_transaksi (id, tipe, pos_id, dompet_id, nominal, keterangan, grup_id, tanggal, created_by)
               VALUES (?, 'pemasukan', ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              'kas_' + nanoid(10),
              posKelebihan.id,
              dompetTujuanId,
              nominalKelebihan,
              `Kelebihan bayar ${grup.nomor_grup || ''} - ${kat}`.trim(),
              id,
              tanggal,
              confirmedBy
            )
        );
      }
      await db.batch(statements);
    }

    // 3. Generate QR token untuk setiap anggota jika belum punya
    const anggotaRes = await db
      .prepare(`SELECT id, nama, peran, qr_token FROM anggota WHERE grup_id = ?`)
      .bind(id)
      .all<any>();

    const anggotaList = anggotaRes.results || [];
    for (const a of anggotaList) {
      if (!a.qr_token) {
        const qrToken = 'qr_' + nanoid(12);
        const qrCodeUrl = `/api/peserta/qr/${qrToken}`;
        await db
          .prepare(`UPDATE anggota SET qr_token = ?, qr_code_url = ? WHERE id = ?`)
          .bind(qrToken, qrCodeUrl, a.id)
          .run();
      }
    }

    // 4. Link cek status untuk PIC (halaman status ada di FE Peserta)
    const cleanPhone = WALinkService.normalizePhoneNumber(grup.pic_whatsapp);
    const pesertaUrl = (c.env.PESERTA_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
    const linkTiket = `${pesertaUrl}/status?wa=${encodeURIComponent(grup.pic_whatsapp)}`;

    let pesanWa: string;
    const tpl = await db.prepare(`SELECT body FROM wa_templates WHERE id = 'wa_lunas' AND aktif = 1`).first<{ body: string }>();
    if (tpl?.body) {
      pesanWa = renderWaTemplate(tpl.body, {
        nama_pic: grup.pic_nama || '',
        nama_acara: 'Family Camp',
        total: `Rp ${grandTotal.toLocaleString('id-ID')}`,
        jumlah_anggota: String(grup.jumlah_anggota ?? anggotaList.length),
        nomor_grup: grup.nomor_grup || '',
        link_status: linkTiket,
        link_pembayaran: linkTiket,
      });
    } else {
      pesanWa = `بسم الله
السلام عليكم ورحمة الله وبركاته
Halo *${grup.pic_nama}*,

Alhamdulillah, pendaftaran *Family Camp* Anda telah *BERHASIL DIKONFIRMASI & LUNAS* ✅

Total Peserta: ${grup.jumlah_anggota} orang
Total Pembayaran: Rp ${grandTotal.toLocaleString('id-ID')}

Silakan cek status pendaftaran dan unduh ID/QR kehadiran seluruh anggota melalui tautan berikut:
🔗 ${linkTiket}

جزاكم الله خيرا`;
    }

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(pesanWa)}`;

    return c.json({
      success: true,
      message: 'Pendaftaran grup berhasil dikonfirmasi, kas tercatat, dan QR tiket telah diterbitkan',
      wa_url: waUrl,
      nominal_dibayar: nominalDibayar,
      selisih_bayar: selisih,
      dompet: dompet.nama,
    });
  } catch (err: any) {
    console.error('Error konfirmasi grup:', err);
    return c.json({ error: 'Gagal mengonfirmasi grup: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/admin/grup/:id/batal-lunas
 * Batalkan konfirmasi LUNAS: status kembali ke menunggu_verifikasi dan
 * seluruh pemasukan kas terkait grup dicatat sebagai jurnal pembalik.
 */
adminRoutes.patch('/grup/:id/batal-lunas', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const id = c.req.param('id');
  const user = c.get('user');
  const actor = user?.nama || user?.username || 'Panitia';

  try {
    const grup = await db.prepare(`SELECT * FROM pendaftaran_grup WHERE id = ?`).bind(id).first<any>();
    if (!grup) return c.json({ error: 'Pendaftaran grup tidak ditemukan' }, 404);
    if (grup.status !== 'lunas') {
      return c.json({ error: 'Grup tidak dalam status LUNAS.' }, 400);
    }

    // Pulihkan status grup
    await db
      .prepare(
        `UPDATE pendaftaran_grup
         SET status = 'menunggu_verifikasi', confirmed_at = NULL, confirmed_by = NULL
         WHERE id = ?`
      )
      .bind(id)
      .run();

    // Buat jurnal pembalik untuk setiap pemasukan aktif terkait grup ini
    const rows = await db
      .prepare(
        `SELECT * FROM kas_transaksi
         WHERE grup_id = ? AND dibatalkan = 0 AND reversal_of IS NULL
           AND id NOT IN (SELECT reversal_of FROM kas_transaksi WHERE reversal_of IS NOT NULL)`
      )
      .bind(id)
      .all<any>();

    const existing = rows.results || [];
    const tanggal = new Date().toISOString().slice(0, 10);
    const stmts: D1PreparedStatement[] = [];
    for (const t of existing) {
      // Jurnal pembalik bertipe berkebalikan; baris asli tetap aktif sehingga
      // keduanya saling menihilkan di laporan (tidak dihitung ganda).
      const tipeBalik = t.tipe === 'pemasukan' ? 'pengeluaran' : 'pemasukan';
      stmts.push(
        db
          .prepare(
            `INSERT INTO kas_transaksi (id, tipe, pos_id, dompet_id, nominal, keterangan, grup_id, reversal_of, tanggal, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            'kas_' + nanoid(10),
            tipeBalik,
            t.pos_id,
            t.dompet_id,
            t.nominal,
            `Pembatalan lunas: ${t.keterangan || t.id}`,
            id,
            t.id,
            tanggal,
            actor
          )
      );
    }
    if (stmts.length) await db.batch(stmts);

    return c.json({ success: true, message: 'Konfirmasi lunas dibatalkan dan jurnal pembalik dicatat.' });
  } catch (err: any) {
    return c.json({ error: 'Gagal membatalkan lunas: ' + err.message }, 500);
  }
});

/**
 * PATCH /api/admin/grup/:id/tolak
 * Tolak pendaftaran grup dengan alasan tertentu
 */
adminRoutes.patch('/grup/:id/tolak', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const alasan = (body.alasan as string)?.trim() || 'Bukti transfer tidak valid atau belum sesuai';

  try {
    await db
      .prepare(
        `UPDATE pendaftaran_grup
         SET status = 'ditolak',
             alasan_tolak = ?
         WHERE id = ?`
      )
      .bind(alasan, id)
      .run();

    return c.json({
      success: true,
      message: 'Pendaftaran grup telah ditolak',
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal menolak pendaftaran grup: ' + err.message }, 500);
  }
});

/**
 * DELETE /api/admin/grup/:id
 * Hapus data grup, anggota, dan addons
 */
adminRoutes.delete('/grup/:id', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const id = c.req.param('id');
  const storage = new StorageService(c.env.STORAGE);

  try {
    const grup = await db
      .prepare(`SELECT id, pic_nama, bukti_url FROM pendaftaran_grup WHERE id = ?`)
      .bind(id)
      .first<{ id: string; pic_nama: string; bukti_url: string | null }>();

    if (!grup) {
      return c.json({ error: 'Pendaftaran grup tidak ditemukan' }, 404);
    }

    if (grup.bukti_url) {
      try {
        const match = grup.bukti_url.match(/\/api\/peserta\/screenshot\/(.+)$/);
        if (match) {
          const key = decodeURIComponent(match[1]);
          await storage.delete(key);
        }
      } catch (fileErr) {}
    }

    await db.prepare(`DELETE FROM pendaftaran_addons WHERE grup_id = ?`).bind(id).run();
    await db.prepare(`DELETE FROM anggota WHERE grup_id = ?`).bind(id).run();
    await db.prepare(`DELETE FROM pendaftaran_grup WHERE id = ?`).bind(id).run();

    return c.json({
      success: true,
      message: `Pendaftaran grup ${grup.pic_nama} berhasil dihapus`,
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal menghapus pendaftaran grup: ' + err.message }, 500);
  }
});

/**
 * CRUD ADD-ON ITEMS (Kelola Katalog Barang Sewa)
 */

// GET /api/admin/addon-items (Semua item termasuk non-aktif)
adminRoutes.get('/addon-items', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  try {
    const result = await db
      .prepare(`SELECT * FROM addon_items ORDER BY urutan ASC, created_at ASC`)
      .all();
    return c.json({ data: result.results || [] });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil add-on: ' + err.message }, 500);
  }
});

// POST /api/admin/addon-items (Tambah item baru)
adminRoutes.post('/addon-items', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const body = await c.req.json().catch(() => ({}));
  const nama = (body.nama as string)?.trim();
  const deskripsi = ((body.deskripsi as string) || '').trim();
  const harga = parseInt(body.harga, 10);
  const stok = body.stok !== undefined ? parseInt(body.stok, 10) : -1;
  const aktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : 1;
  const urutan = body.urutan !== undefined ? parseInt(body.urutan, 10) : 0;

  if (!nama) {
    return c.json({ error: 'Nama item add-on wajib diisi' }, 400);
  }
  if (isNaN(harga) || harga < 0) {
    return c.json({ error: 'Harga item wajib berupa angka positif' }, 400);
  }

  const id = 'addon_' + nanoid(8);

  try {
    await db
      .prepare(
        `INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, nama, deskripsi, harga, stok, aktif, urutan)
      .run();

    return c.json({
      success: true,
      message: 'Item add-on berhasil ditambahkan',
      data: { id, nama, deskripsi, harga, stok, aktif, urutan },
    }, 201);
  } catch (err: any) {
    return c.json({ error: 'Gagal menambahkan add-on: ' + err.message }, 500);
  }
});

// PATCH /api/admin/addon-items/:id (Edit item)
adminRoutes.patch('/addon-items/:id', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  try {
    const existing = await db.prepare(`SELECT * FROM addon_items WHERE id = ?`).bind(id).first<any>();
    if (!existing) {
      return c.json({ error: 'Item add-on tidak ditemukan' }, 404);
    }

    const nama = body.nama !== undefined ? (body.nama as string).trim() : existing.nama;
    const deskripsi = body.deskripsi !== undefined ? (body.deskripsi as string).trim() : existing.deskripsi;
    const harga = body.harga !== undefined ? parseInt(body.harga, 10) : existing.harga;
    const stok = body.stok !== undefined ? parseInt(body.stok, 10) : existing.stok;
    const aktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : existing.aktif;
    const urutan = body.urutan !== undefined ? parseInt(body.urutan, 10) : existing.urutan;

    await db
      .prepare(
        `UPDATE addon_items
         SET nama = ?, deskripsi = ?, harga = ?, stok = ?, aktif = ?, urutan = ?
         WHERE id = ?`
      )
      .bind(nama, deskripsi, harga, stok, aktif, urutan, id)
      .run();

    return c.json({
      success: true,
      message: 'Item add-on berhasil diperbarui',
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal memperbarui add-on: ' + err.message }, 500);
  }
});

// DELETE /api/admin/addon-items/:id (Hapus item)
adminRoutes.delete('/addon-items/:id', async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: 'Database tidak terhubung' }, 500);

  const id = c.req.param('id');

  try {
    await db.prepare(`DELETE FROM addon_items WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: 'Item add-on berhasil dihapus' });
  } catch (err: any) {
    return c.json({ error: 'Gagal menghapus add-on: ' + err.message }, 500);
  }
});

// =========================================================================
// ENDPOINT ADMIN: Data Peserta (Anggota) Family Camp
// =========================================================================

/**
 * GET /api/admin/anggota
 * Mengambil daftar seluruh anggota/peserta Family Camp dengan filter dan pencarian
 *
 * Query params:
 *   - status_hadir: 'hadir' | 'belum_hadir' | 'semua' (default: semua)
 *   - kategori_usia: 'balita' | 'anak' | 'remaja' | 'dewasa' | 'lansia' | 'semua'
 *   - jenis_kelamin: 'L' | 'P' | 'semua'
 *   - is_gratis: '1' | '0' | 'semua'
 *   - grup_status: 'lunas' | 'menunggu_verifikasi' | 'menunggu_pembayaran' | 'ditolak' | 'semua'
 *   - search: pencarian nama, nomor peserta, PIC
 *   - page: nomor halaman (default 1)
 *   - limit: jumlah per halaman (default 50, max 200)
 */
adminRoutes.get('/anggota', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  // Parse query params
  const statusHadir = c.req.query('status_hadir') || 'semua';
  const kategoriUsia = c.req.query('kategori_usia') || 'semua';
  const jenisKelamin = c.req.query('jenis_kelamin') || 'semua';
  const isGratis = c.req.query('is_gratis') || 'semua';
  const grupStatus = c.req.query('grup_status') || 'semua';
  const search = c.req.query('search')?.trim();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  try {
    // Build query dengan filter
    let sql = `
      SELECT
        a.id,
        a.nama,
        a.nomor_peserta,
        a.peran,
        a.jenis_kelamin,
        a.usia,
        a.ukuran_kaos,
        a.catatan_medis,
        a.is_gratis,
        a.makan_dicover,
        a.qr_token,
        a.qr_code_url,
        a.status_hadir,
        a.attended_at,
        a.created_at,
        g.id as grup_id,
        g.nomor_grup,
        g.tipe as grup_tipe,
        g.pic_nama,
        g.pic_whatsapp,
        g.status as grup_status
      FROM anggota a
      JOIN pendaftaran_grup g ON a.grup_id = g.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // Filter: status hadir
    if (statusHadir === 'hadir') {
      sql += ` AND a.status_hadir = 'hadir'`;
    } else if (statusHadir === 'belum_hadir') {
      sql += ` AND (a.status_hadir IS NULL OR a.status_hadir = 'belum_hadir')`;
    }

    // Filter: kategori usia
    if (kategoriUsia && kategoriUsia !== 'semua') {
      const kat = KATEGORI_USIA.find((k) => k.id === kategoriUsia);
      if (kat) {
        sql += ` AND a.usia >= ? AND a.usia <= ?`;
        params.push(kat.min, kat.max);
      }
    }

    // Filter: jenis kelamin
    if (jenisKelamin && jenisKelamin !== 'semua') {
      sql += ` AND a.jenis_kelamin = ?`;
      params.push(jenisKelamin);
    }

    // Filter: is_gratis
    if (isGratis === '1') {
      sql += ` AND a.is_gratis = 1`;
    } else if (isGratis === '0') {
      sql += ` AND (a.is_gratis = 0 OR a.is_gratis IS NULL)`;
    }

    // Filter: grup_status
    if (grupStatus && grupStatus !== 'semua') {
      sql += ` AND g.status = ?`;
      params.push(grupStatus);
    }

    // Filter: search
    if (search) {
      sql += ` AND (
        a.nama LIKE ? OR
        a.nomor_peserta LIKE ? OR
        g.pic_nama LIKE ? OR
        g.pic_whatsapp LIKE ? OR
        g.nomor_grup LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const countSql = `SELECT COUNT(*) as total FROM anggota a JOIN pendaftaran_grup g ON a.grup_id = g.id WHERE 1=1` +
      sql.split('WHERE 1=1')[1].split('ORDER BY')[0];
    const countStmt = db.prepare(countSql.replace(/LIMIT \d+ OFFSET \d+/g, ''));
    const countResult = params.length > 0
      ? await countStmt.bind(...params).first<{ total: number }>()
      : await countStmt.first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add ordering and pagination
    sql += ` ORDER BY g.nomor_grup ASC, a.nomor_peserta ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = db.prepare(sql);
    const result = params.length > 0 ? await stmt.bind(...params).all<any>() : await stmt.all<any>();
    const data = result.results || [];

    // Enrich data dengan kategori_usia_label + status scan per sesi
    const ids = data.map((a: any) => a.id);
    const scanByAnggota: Record<string, Record<string, boolean>> = {};
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const scanRes = await db
        .prepare(`SELECT anggota_id, sesi FROM scan_log WHERE anggota_id IN (${placeholders})`)
        .bind(...ids)
        .all<any>();
      for (const row of scanRes.results || []) {
        if (!scanByAnggota[row.anggota_id]) scanByAnggota[row.anggota_id] = {};
        scanByAnggota[row.anggota_id][row.sesi] = true;
      }
    }

    const enrichedData = data.map((a: any) => ({
      ...a,
      kategori_usia: getKategoriUsia(a.usia),
      kategori_usia_label: getKategoriUsiaLabel(a.usia),
      scan_sesi: scanByAnggota[a.id] || {},
    }));

    c.header('x-total-count', String(total));
    return c.json({
      data: enrichedData,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('Error list anggota:', err);
    return c.json({ error: 'Gagal mengambil data anggota: ' + err.message }, 500);
  }
});

/**
 * GET /api/admin/anggota/:id
 * Detail anggota/peserta beserta info grup dan scan log
 */
adminRoutes.get('/anggota/:id', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database tidak terhubung' }, 500);
  }

  const id = c.req.param('id');

  try {
    const anggota = await db
      .prepare(`
        SELECT
          a.*,
          g.id as grup_id,
          g.nomor_grup,
          g.tipe as grup_tipe,
          g.pic_nama,
          g.pic_whatsapp,
          g.status as grup_status,
          g.grand_total as grup_total
        FROM anggota a
        JOIN pendaftaran_grup g ON a.grup_id = g.id
        WHERE a.id = ?
      `)
      .bind(id)
      .first<any>();

    if (!anggota) {
      return c.json({ error: 'Anggota tidak ditemukan' }, 404);
    }

    // Ambil scan log jika ada
    const scanLogRes = await db
      .prepare(`SELECT * FROM scan_log WHERE anggota_id = ? ORDER BY scanned_at DESC`)
      .bind(id)
      .all<any>();

    return c.json({
      data: {
        ...anggota,
        kategori_usia: getKategoriUsia(anggota.usia),
        kategori_usia_label: getKategoriUsiaLabel(anggota.usia),
        scan_log: scanLogRes.results || [],
      },
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal mengambil detail anggota: ' + err.message }, 500);
  }
});
