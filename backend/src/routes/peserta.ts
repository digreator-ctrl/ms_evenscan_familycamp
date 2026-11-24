import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { validatePendaftaran } from '../middlewares/validator';
import { StorageService } from '../services/storage';
import { QRGeneratorService } from '../services/qr-generator';
import {
  BIAYA_PER_ORANG_DEFAULT,
  formatNomorPeserta,
  ambilNomorUrutGrup,
  hitungBiayaWajib,
  isBerbayar,
  getKategoriUsia,
  getKategoriUsiaLabel,
} from '../services/peserta-rules';

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
};

export const pesertaRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * Helper untuk normalisasi nomor telepon
 */
function getPhoneVariants(phone: string): [string, string] {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('62')) {
    return [digits, '0' + digits.slice(2)];
  }
  if (digits.startsWith('0')) {
    return ['62' + digits.slice(1), digits];
  }
  return ['62' + digits, '0' + digits];
}

/**
 * Membuat kode akses sederhana & mudah diingat:
 * nama depan PIC + 4 digit terakhir nomor HP, mis. "ahmad1234".
 * Dibuat unik terhadap payment_token yang sudah ada.
 */
async function generateKodeAkses(db: D1Database, picNama: string, picWhatsapp: string): Promise<string> {
  const namaDepan =
    (picNama || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)[0] || 'peserta';
  const slug = namaDepan.slice(0, 15);
  const digits = (picWhatsapp || '').replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '0');
  const base = `${slug}${last4}`;

  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    const existing = await db
      .prepare(`SELECT id FROM pendaftaran_grup WHERE payment_token = ?`)
      .bind(candidate)
      .first();
    if (!existing) return candidate;
  }
  return `${base}${nanoid(4)}`;
}

/**
 * GET /api/peserta/config
 * Mengembalikan konfigurasi status kuota & pendaftaran publik
 */
pesertaRoutes.get('/config', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({
      pendaftaran_buka: true,
      kuota_status: 'Terbuka',
    });
  }

  try {
    const row = await db
      .prepare(`SELECT value FROM app_settings WHERE key = 'pendaftaran_buka'`)
      .first<{ value: string }>();

    const pendaftaran_buka = row ? row.value === 'true' || row.value === '1' : true;

    return c.json({
      pendaftaran_buka,
      kuota_status: pendaftaran_buka ? 'Terbuka' : 'Ditutup',
    });
  } catch (err) {
    return c.json({
      pendaftaran_buka: true,
      kuota_status: 'Terbuka',
    });
  }
});

/**
 * GET /api/peserta/cek-wa?wa=08xxxxxxxxxx
 * Mengecek apakah nomor WhatsApp PIC sudah pernah terdaftar (dipakai pada grup aktif).
 * Dipakai oleh form pendaftaran untuk validasi dini di langkah Tipe & PIC.
 */
pesertaRoutes.get('/cek-wa', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ terdaftar: false });
  }

  const wa = c.req.query('wa')?.trim();
  if (!wa) {
    return c.json({ error: 'Nomor WhatsApp wajib dikirim.' }, 400);
  }

  try {
    const [phone62, phone08] = getPhoneVariants(wa);
    const existing = await db
      .prepare(
        `SELECT id FROM pendaftaran_grup
         WHERE (
           replace(replace(replace(pic_whatsapp, ' ', ''), '-', ''), '+', '') IN (?, ?)
           OR pic_whatsapp IN (?, ?)
         )
         AND status != 'ditolak'
         LIMIT 1`
      )
      .bind(phone62, phone08, phone62, phone08)
      .first();

    return c.json({ terdaftar: Boolean(existing) });
  } catch (err) {
    console.warn('Pengecekan nomor WhatsApp dilewati:', err);
    return c.json({ terdaftar: false });
  }
});

/**
 * POST /api/peserta/daftar
 * Menerima formulir pendaftaran + file screenshot bukti
 */
pesertaRoutes.post('/daftar', validatePendaftaran, async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  // Validasi apakah pendaftaran dibuka oleh admin superadmin
  try {
    const configRow = await db
      .prepare(`SELECT value FROM app_settings WHERE key = 'pendaftaran_buka'`)
      .first<{ value: string }>();
    if (configRow && (configRow.value === 'false' || configRow.value === '0')) {
      return c.json(
        {
          error: 'Pendaftaran saat ini telah ditutup karena kuota acara telah terpenuhi.',
          code: 'REGISTRATION_CLOSED',
        },
        403
      );
    }
  } catch (err) {
    // Abaikan jika tabel belum ada atau terjadi kendala query
  }

  const storage = new StorageService(c.env.STORAGE);
  const body = await c.req.parseBody();

  const nama = (body['nama'] as string).trim();
  const email = ((body['email'] as string) || '').trim();
  const no_whatsapp = (body['no_whatsapp'] as string).trim();
  const jenis_kelamin = ((body['jenis_kelamin'] as string) || '').trim();
  const nip = ((body['nip'] as string) || '').trim();
  const domisili = ((body['domisili'] as string) || '').trim();
  const alasan = ((body['alasan'] as string) || '').trim();
  const instansi = ((body['instansi'] as string) || (nip ? `${jenis_kelamin ? jenis_kelamin + ' | ' : ''}NIP: ${nip}${domisili ? ' | ' + domisili : ''}` : '')).trim();
  const screenshot = body['screenshot'] as File;

  // Cek duplikasi pendaftaran aktif (status 'menunggu', 'dikonfirmasi', atau 'hadir')
  const [phone62, phone08] = getPhoneVariants(no_whatsapp);
  try {
    const existing = await db
      .prepare(
        `SELECT id, nama, status FROM pendaftar 
         WHERE (no_whatsapp = ? OR no_whatsapp = ?) 
           AND status != 'ditolak'
         LIMIT 1`
      )
      .bind(phone62, phone08)
      .first<{ id: string; nama: string; status: string }>();

    if (existing) {
      if (existing.status === 'menunggu') {
        return c.json(
          {
            success: true,
            id: existing.id,
            nama: existing.nama,
            message: 'Pendaftaran Anda sudah kami terima sebelumnya dan sedang dalam antrean verifikasi panitia.',
          },
          200
        );
      }
      if (existing.status === 'dikonfirmasi' || existing.status === 'hadir') {
        return c.json(
          {
            error: 'Nomor WhatsApp ini sudah terdaftar dan statusnya telah dikonfirmasi. Silakan buka menu Cek Tiket untuk melihat QR Code Anda.',
          },
          409
        );
      }
    }
  } catch (checkErr) {
    console.warn('Pengecekan duplikasi pendaftar dilewati:', checkErr);
  }

  const id = 'reg_' + nanoid(10);

  // Ambil ekstensi file
  const mime = screenshot.type;
  let ext = 'jpg';
  if (mime === 'image/png') ext = 'png';
  else if (mime === 'image/webp') ext = 'webp';

  const storageKey = `screenshots/${id}.${ext}`;

  try {
    // 1. Upload screenshot ke R2
    const fileBuffer = await screenshot.arrayBuffer();
    await storage.upload(storageKey, fileBuffer, mime);

    // URL screenshot (relatif ke API agar bisa diakses lewat /api/peserta/screenshot/:key)
    const screenshotUrl = `/api/peserta/screenshot/${encodeURIComponent(storageKey)}`;

    // 2. Simpan record ke Cloudflare D1
    try {
      await db
        .prepare(
          `INSERT INTO pendaftar (id, nama, email, no_whatsapp, instansi, jenis_kelamin, nip, domisili, alasan, screenshot_url, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'menunggu')`
        )
        .bind(id, nama, email, no_whatsapp, instansi, jenis_kelamin, nip, domisili, alasan, screenshotUrl)
        .run();
    } catch {
      // Fallback jika skema database lokal belum menambahkan kolom baru
      await db
        .prepare(
          `INSERT INTO pendaftar (id, nama, email, no_whatsapp, instansi, screenshot_url, status)
           VALUES (?, ?, ?, ?, ?, ?, 'menunggu')`
        )
        .bind(id, nama, email, no_whatsapp, instansi, screenshotUrl)
        .run();
    }

    return c.json(
      {
        success: true,
        id,
        nama,
        message: 'Pendaftaran Anda berhasil dikirim dan sedang menunggu verifikasi panitia.',
      },
      201
    );
  } catch (err: any) {
    console.error('Error saat pendaftaran:', err);
    return c.json({ error: 'Gagal memproses pendaftaran: ' + err.message }, 500);
  }
});

/**
 * GET /api/peserta/status?nip=...&wa4=...
 * Atau fallback: ?wa=08xxxxxxxx
 * Cek status pendaftaran dan akses QR Code mandiri
 */
pesertaRoutes.get('/status', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const kode = c.req.query('kode')?.trim();
  let nip = c.req.query('nip')?.trim();
  let wa4 = c.req.query('wa4')?.trim();
  const wa = c.req.query('wa')?.trim();

  // Jika parameter 'kode' diberikan (gabungan NIP + 4 digit terakhir nomor WA)
  if (kode) {
    const cleanKode = kode.replace(/[()]/g, '').trim();
    if (cleanKode.length >= 5) {
      wa4 = cleanKode.slice(-4);
      nip = cleanKode.slice(0, -4).trim();
    }
  }

  if (!nip && !wa4 && !wa) {
    return c.json({ error: 'Parameter kode akses tiket (?kode=...) atau NIP & 4 digit WhatsApp diperlukan' }, 400);
  }

  try {
    let record: {
      id: string;
      nama: string;
      email: string;
      no_whatsapp: string;
      instansi: string;
      nip?: string;
      status: string;
      qr_token: string | null;
      alasan_tolak: string | null;
      created_at: string;
      confirmed_at: string | null;
      attended_at: string | null;
    } | null = null;

    if (nip && wa4) {
      const nipParam = nip.toUpperCase();
      const wa4Digits = wa4.replace(/\D/g, '');

      if (wa4Digits.length !== 4) {
        return c.json({ error: '4 digit nomor WhatsApp harus berupa 4 angka' }, 400);
      }

      // Pencocokan ketat: nomor WA harus utuh (setelah dinormalisasi), bukan hanya 4 digit terakhir.
      record = await db
        .prepare(
          `SELECT id, nama, email, no_whatsapp, instansi, nip, status, qr_token, alasan_tolak, created_at, confirmed_at, attended_at
           FROM pendaftar
           WHERE (
             UPPER(COALESCE(nip, '')) = ?
             OR UPPER(instansi) LIKE ?
           )
           AND (
             replace(replace(replace(no_whatsapp, ' ', ''), '-', ''), '+', '') IN (?, ?)
             OR no_whatsapp IN (?, ?)
           )
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .bind(
          nipParam,
          `%NIP: ${nipParam}%`,
          ...[0, 1, 2, 3].map(() => wa4Digits)
        )
        .first();
    } else if (wa) {
      // Fallback kompatibilitas dengan nomor WA utuh
      const [var1, var2] = getPhoneVariants(wa);
      record = await db
        .prepare(
          `SELECT id, nama, email, no_whatsapp, instansi, nip, status, qr_token, alasan_tolak, created_at, confirmed_at, attended_at
           FROM pendaftar
           WHERE no_whatsapp = ? OR no_whatsapp = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .bind(var1, var2)
        .first();
    } else if (nip && !wa4) {
      return c.json({ error: 'Harap masukkan juga 4 digit terakhir nomor WhatsApp terdaftar' }, 400);
    } else if (!nip && wa4) {
      return c.json({ error: 'Harap masukkan NIP terdaftar Anda' }, 400);
    }

    if (!record) {
      return c.json({ error: 'Data pendaftar dengan NIP dan 4 digit terakhir nomor WhatsApp tersebut tidak ditemukan' }, 404);
    }

    return c.json({
      id: record.id,
      nama: record.nama,
      email: record.email,
      no_whatsapp: record.no_whatsapp,
      instansi: record.instansi,
      nip: record.nip,
      status: record.status,
      qr_token: record.qr_token,
      alasan_tolak: record.alasan_tolak,
      created_at: record.created_at,
      confirmed_at: record.confirmed_at,
      attended_at: record.attended_at,
    });
  } catch (err: any) {
    console.error('Error cek status:', err);
    return c.json({ error: 'Gagal mengambil status: ' + err.message }, 500);
  }
});

/**
 * GET /api/peserta/qr/:token
 * Menghasilkan & mengirimkan file gambar QR code kehadiran peserta (PNG / SVG murni)
 */
pesertaRoutes.get('/qr/:token', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const token = c.req.param('token');
  if (!token) {
    return c.json({ error: 'Token tidak valid' }, 400);
  }

  try {
    let record = await db
      .prepare(`SELECT a.id, a.nama, g.status as grup_status, a.qr_token 
                FROM anggota a 
                JOIN pendaftaran_grup g ON a.grup_id = g.id 
                WHERE a.qr_token = ?`)
      .bind(token)
      .first<{ id: string; nama: string; grup_status: string; qr_token: string }>();

    if (record) {
      if (record.grup_status !== 'lunas') {
        return c.json({ error: 'Status pembayaran grup belum lunas' }, 403);
      }
    } else {
      const legacyRecord = await db
        .prepare(`SELECT id, nama, status, qr_token FROM pendaftar WHERE qr_token = ?`)
        .bind(token)
        .first<{ id: string; nama: string; status: string; qr_token: string }>();

      if (!legacyRecord || (legacyRecord.status !== 'dikonfirmasi' && legacyRecord.status !== 'hadir')) {
        return c.json({ error: 'QR Code tidak ditemukan atau belum disetujui panitia' }, 404);
      }
    }

    const format = c.req.query('format') || 'png';

    if (format === 'svg') {
      const svgString = await QRGeneratorService.generateSVG(token);
      return new Response(svgString, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Content-Disposition': `inline; filename="qr-${token}.svg"`,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Generate gambar PNG murni (pure JS, tanpa canvas)
    const pngBytes = await QRGeneratorService.generatePNG(token);

    return new Response(pngBytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Content-Disposition': `inline; filename="qr-${token}.png"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    console.error('Error generate QR:', err);
    // Fallback otomatis ke SVG jika terjadi kendala
    try {
      const svgFallback = await QRGeneratorService.generateSVG(token);
      return new Response(svgFallback, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Content-Disposition': `inline; filename="qr-${token}.svg"`,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      return c.json({ error: 'Gagal memproses QR code: ' + err.message }, 500);
    }
  }
});

/**
 * GET /api/peserta/screenshot/:key
 * Mengambil file gambar bukti screenshot yang tersimpan di Cloudflare R2
 */
pesertaRoutes.get('/screenshot/:key{.+}', async (c) => {
  const storage = new StorageService(c.env.STORAGE);
  const key = c.req.param('key');

  try {
    const file = await storage.get(key);
    if (!file) {
      return c.json({ error: 'File screenshot tidak ditemukan di storage' }, 404);
    }

    const contentType = file.httpMetadata?.contentType || 'image/jpeg';

    return new Response(file.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    console.error('Error mengambil file R2:', err);
    return c.json({ error: 'Gagal memuat gambar: ' + err.message }, 500);
  }
});

// =========================================================================
// ENDPOINT FAMILY CAMP: Pendaftaran Grup, Add-on, Pembayaran & Tiket
// =========================================================================

/**
 * GET /api/peserta/addon-items
 * Mengambil daftar item add-on/sewa yang aktif untuk ditampilkan di formulir
 */
pesertaRoutes.get('/addon-items', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ data: [] });
  }

  try {
    const result = await db
      .prepare(`SELECT id, nama, deskripsi, harga, stok, aktif, urutan, kategori, fasilitas FROM addon_items WHERE aktif = 1 ORDER BY urutan ASC, created_at ASC`)
      .all<any>();
    const data = (result.results || []).map((item: any) => ({
      ...item,
      kategori: item.kategori === 'paket' ? 'paket' : 'satuan',
      fasilitas: item.fasilitas
        ? String(item.fasilitas)
            .split('|')
            .map((f: string) => f.trim())
            .filter(Boolean)
        : [],
    }));
    return c.json({ data });
  } catch (err: any) {
    console.error('Error get addon items:', err);
    return c.json({ error: 'Gagal mengambil data add-on: ' + err.message }, 500);
  }
});

/**
 * POST /api/peserta/daftar-grup
 * Menerima pendaftaran grup (keluarga/non-keluarga), menghitung biaya paket wajib + add-on,
 * dan menghasilkan token pembayaran unik.
 */
pesertaRoutes.post('/daftar-grup', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  // Cek kuota pendaftaran dibuka
  try {
    const configRow = await db
      .prepare(`SELECT value FROM app_settings WHERE key = 'pendaftaran_buka'`)
      .first<{ value: string }>();
    if (configRow && (configRow.value === 'false' || configRow.value === '0')) {
      return c.json(
        {
          error: 'Pendaftaran saat ini telah ditutup karena kuota acara telah terpenuhi.',
          code: 'REGISTRATION_CLOSED',
        },
        403
      );
    }
  } catch (err) { }

  const body = await c.req.json().catch(() => ({}));
  const tipe = body.tipe === 'keluarga' ? 'keluarga' : 'non_keluarga';
  const pic_nama = (body.pic_nama as string)?.trim();
  const pic_whatsapp = (body.pic_whatsapp as string)?.trim();
  const pic_email = ((body.pic_email as string) || '').trim();
  const pic_provinsi = ((body.pic_provinsi || body.provinsi || '') as string).trim();
  const pic_kota = ((body.pic_kota || body.kota || '') as string).trim();
  const anggotaList = Array.isArray(body.anggota) ? body.anggota : [];
  const addonsSelected = Array.isArray(body.addons) ? body.addons : [];

  if (!pic_nama || pic_nama.length < 2) {
    return c.json({ error: 'Nama penanggung jawab (PIC) wajib diisi minimal 2 karakter.' }, 400);
  }

  if (!pic_whatsapp || pic_whatsapp.length < 9) {
    return c.json({ error: 'Nomor WhatsApp PIC wajib diisi (minimal 9 digit).' }, 400);
  }

  if (anggotaList.length === 0) {
    return c.json({ error: 'Minimal 1 anggota wajib didaftarkan.' }, 400);
  }

  if (tipe === 'keluarga' && anggotaList.length < 2) {
    return c.json({ error: 'Pendaftaran kategori Keluarga minimal terdiri dari 2 peserta.' }, 400);
  }

  // Validasi setiap anggota
  for (let i = 0; i < anggotaList.length; i++) {
    const m = anggotaList[i];
    if (!m.nama || m.nama.trim().length < 2) {
      return c.json({ error: `Nama anggota ke-${i + 1} wajib diisi minimal 2 karakter.` }, 400);
    }
    if (!m.jenis_kelamin || !['Ikhwan', 'Akhwat'].includes(m.jenis_kelamin)) {
      return c.json({ error: `Jenis kelamin anggota ke-${i + 1} (${m.nama}) wajib dipilih (Ikhwan/Akhwat).` }, 400);
    }
  }

  // Cek duplikasi nomor WhatsApp PIC (satu nomor hanya untuk satu pendaftaran aktif)
  try {
    const [phone62, phone08] = getPhoneVariants(pic_whatsapp);
    const existing = await db
      .prepare(
        `SELECT id, pic_nama, status FROM pendaftaran_grup
         WHERE (
           replace(replace(replace(pic_whatsapp, ' ', ''), '-', ''), '+', '') IN (?, ?)
           OR pic_whatsapp IN (?, ?)
         )
         AND status != 'ditolak'
         LIMIT 1`
      )
      .bind(phone62, phone08, phone62, phone08)
      .first<{ id: string; pic_nama: string; status: string }>();

    if (existing) {
      return c.json(
        {
          error: 'Nomor WhatsApp sudah pernah digunakan mendaftar. Silakan gunakan nomor WhatsApp lain yang belum terdaftar.',
          code: 'DUPLICATE_WHATSAPP',
        },
        409
      );
    }
  } catch (err) {
    console.warn('Pengecekan duplikasi nomor WhatsApp dilewati:', err);
  }

  // Harga per orang dapat diatur admin (app_settings.harga_per_orang)
  let hargaPerOrang = BIAYA_PER_ORANG_DEFAULT;
  try {
    const hargaRow = await db
      .prepare(`SELECT value FROM app_settings WHERE key = 'harga_per_orang'`)
      .first<{ value: string }>();
    const parsed = parseInt(hargaRow?.value || '', 10);
    if (!isNaN(parsed) && parsed > 0) hargaPerOrang = parsed;
  } catch (err) {}

  const DAFTAR_PERAN_VALID = ['Ayah', 'Ibu', 'Anak', 'Kakek', 'Nenek', 'Paman', 'Bibi', 'Saudara Kandung', 'Sepupu', 'Peserta', 'Ketua Rombongan'];

  // Nomor urut grup (K/N) untuk nomor peserta
  let urutGrup = 1;
  try {
    urutGrup = await ambilNomorUrutGrup(db, tipe);
  } catch (counterErr) {
    console.warn('Gagal mengambil nomor urut grup:', counterErr);
  }
  const nomorGrup = `${tipe === 'keluarga' ? 'K' : 'N'}-${String(urutGrup).padStart(3, '0')}`;

  const sanitizedAnggota: {
    id: string;
    nomor_peserta: string;
    nama: string;
    jenis_kelamin: string;
    peran: string;
    usia: number | null;
    ukuran_kaos: string | null;
    catatan_medis: string | null;
    is_gratis: number;
    makan_dicover: number;
    provinsi: string | null;
    kota: string | null;
  }[] = anggotaList.map((m: any, idx: number) => {
    const parsedUsia = typeof m.usia === 'number' ? m.usia : parseInt(m.usia, 10);
    const usiaNum = isNaN(parsedUsia) ? null : parsedUsia;
    // Opsi cover panitia hanya berlaku untuk usia di bawah 3 tahun
    const makanDicover = usiaNum !== null && usiaNum < 3 && Boolean(m.makan_dicover);
    const berbayar = isBerbayar(usiaNum, makanDicover);

    let defaultPeran = 'Peserta';
    if (tipe === 'keluarga') {
      defaultPeran = m.peran && DAFTAR_PERAN_VALID.includes(m.peran) ? m.peran : (idx === 0 ? 'Ayah' : 'Anak');
    } else {
      defaultPeran = m.peran && DAFTAR_PERAN_VALID.includes(m.peran) ? m.peran : (idx === 0 && anggotaList.length > 1 ? 'Ketua Rombongan' : 'Peserta');
    }

    const provAnggota = (m.provinsi || '').trim() || pic_provinsi || null;
    const kotaAnggota = (m.kota || '').trim() || pic_kota || null;

    return {
      id: 'mbr_' + nanoid(10),
      nomor_peserta: formatNomorPeserta(tipe, urutGrup, idx + 1),
      nama: m.nama.trim(),
      jenis_kelamin: m.jenis_kelamin,
      peran: defaultPeran,
      usia: usiaNum,
      ukuran_kaos: (m.ukuran_kaos || '').trim() || null,
      catatan_medis: (m.catatan_medis || '').trim() || null,
      is_gratis: berbayar ? 0 : 1,
      makan_dicover: makanDicover ? 1 : 0,
      provinsi: provAnggota,
      kota: kotaAnggota,
    };
  });

  const ringkasanBiaya = hitungBiayaWajib(
    sanitizedAnggota.map((a) => ({ usia: a.usia, makan_dicover: a.makan_dicover })),
    hargaPerOrang
  );
  const jumlahAnggotaBerbayar = ringkasanBiaya.jumlah_berbayar;
  const jumlahBalitaGratis = ringkasanBiaya.jumlah_gratis;
  const jumlahMakanDicover = ringkasanBiaya.jumlah_makan_dicover;
  const biaya_wajib = ringkasanBiaya.biaya_wajib;

  // Hitung biaya add-on dari database
  let biaya_addon = 0;
  const processedAddons: { addon_id: string; nama_item: string; qty: number; harga_satuan: number; subtotal: number }[] = [];

  if (addonsSelected.length > 0) {
    try {
      const allAddonsRes = await db.prepare(`SELECT id, nama, harga FROM addon_items WHERE aktif = 1`).all<{ id: string; nama: string; harga: number }>();
      const addonMap = new Map((allAddonsRes.results || []).map((item) => [item.id, item]));

      for (const sel of addonsSelected) {
        const item = addonMap.get(sel.addon_id);
        const qty = parseInt(sel.qty, 10);
        if (item && qty > 0) {
          const subtotal = item.harga * qty;
          biaya_addon += subtotal;
          processedAddons.push({
            addon_id: item.id,
            nama_item: item.nama,
            qty,
            harga_satuan: item.harga,
            subtotal,
          });
        }
      }
    } catch (err: any) {
      console.warn('Gagal memproses add-on items:', err);
    }
  }

  // Tidak menggunakan kode unik transfer (nominal bersih)
  const kode_unik = 0;
  const grand_total = biaya_wajib + biaya_addon;

  const grupId = 'grp_' + nanoid(10);
  const paymentToken = await generateKodeAkses(db, pic_nama, pic_whatsapp);

  try {
    // 1. Simpan Pendaftaran Grup
    await db
      .prepare(
        `INSERT INTO pendaftaran_grup (
          id, tipe, pic_nama, pic_whatsapp, pic_email, provinsi, kota,
          jumlah_anggota, biaya_wajib, biaya_addon, kode_unik, grand_total,
          payment_token, status, nomor_grup
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'menunggu_pembayaran', ?)`
      )
      .bind(
        grupId,
        tipe,
        pic_nama,
        pic_whatsapp,
        pic_email,
        pic_provinsi || null,
        pic_kota || null,
        sanitizedAnggota.length,
        biaya_wajib,
        biaya_addon,
        kode_unik,
        grand_total,
        paymentToken,
        nomorGrup
      )
      .run();

    // 2. Simpan Anggota
    for (const ang of sanitizedAnggota) {
      await db
        .prepare(
          `INSERT INTO anggota (
            id, grup_id, nomor_peserta, nama, jenis_kelamin, peran, usia, ukuran_kaos, catatan_medis, is_gratis, makan_dicover, provinsi, kota
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          ang.id,
          grupId,
          ang.nomor_peserta,
          ang.nama,
          ang.jenis_kelamin,
          ang.peran,
          ang.usia,
          ang.ukuran_kaos,
          ang.catatan_medis,
          ang.is_gratis,
          ang.makan_dicover,
          ang.provinsi,
          ang.kota
        )
        .run();
    }

    // 3. Simpan Add-ons
    for (const add of processedAddons) {
      await db
        .prepare(
          `INSERT INTO pendaftaran_addons (
            id, grup_id, addon_id, nama_item, qty, harga_satuan, subtotal
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          'paddon_' + nanoid(10),
          grupId,
          add.addon_id,
          add.nama_item,
          add.qty,
          add.harga_satuan,
          add.subtotal
        )
        .run();
    }

    return c.json(
      {
        success: true,
        grup_id: grupId,
        nomor_grup: nomorGrup,
        payment_token: paymentToken,
        payment_url: `/pembayaran?token=${paymentToken}`,
        rincian: {
          tipe,
          pic_nama,
          pic_whatsapp,
          jumlah_anggota: sanitizedAnggota.length,
          jumlah_anggota_berbayar: jumlahAnggotaBerbayar,
          jumlah_balita_gratis: jumlahBalitaGratis,
          jumlah_makan_dicover: jumlahMakanDicover,
          harga_per_orang: hargaPerOrang,
          nomor_peserta: sanitizedAnggota.map((a) => ({ nomor: a.nomor_peserta, nama: a.nama })),
          biaya_wajib,
          biaya_addon,
          kode_unik,
          grand_total,
        },
        message: 'Data pendaftaran berhasil disimpan. Silakan lanjutkan ke pembayaran.',
      },
      201
    );
  } catch (err: any) {
    console.error('Error simpan pendaftaran grup:', err);
    return c.json({ error: 'Gagal memproses pendaftaran: ' + err.message }, 500);
  }
});

/**
 * GET /api/peserta/pembayaran/:token
 * Mengambil detail invoice lengkap untuk halaman konfirmasi pembayaran
 */
pesertaRoutes.get('/pembayaran/:token', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const token = c.req.param('token');
  if (!token) {
    return c.json({ error: 'Token pembayaran tidak valid' }, 400);
  }

  try {
    const grup = await db
      .prepare(`SELECT * FROM pendaftaran_grup WHERE payment_token = ?`)
      .bind(token)
      .first<any>();

    if (!grup) {
      return c.json({ error: 'Data pembayaran tidak ditemukan atau link sudah tidak berlaku' }, 404);
    }

    // Ambil data anggota
    const anggotaRes = await db
      .prepare(`SELECT id, nama, jenis_kelamin, peran, usia, ukuran_kaos, catatan_medis, is_gratis, qr_token, status_hadir, provinsi, kota FROM anggota WHERE grup_id = ? ORDER BY created_at ASC`)
      .bind(grup.id)
      .all();

    // Ambil data addons
    const addonsRes = await db
      .prepare(`SELECT id, nama_item, qty, harga_satuan, subtotal FROM pendaftaran_addons WHERE grup_id = ?`)
      .bind(grup.id)
      .all();

    // Ambil rekening bank & kontak panitia dari app_settings
    const settingsRes = await db.prepare(`SELECT key, value FROM app_settings`).all<{ key: string; value: string }>();
    const settingsMap = new Map((settingsRes.results || []).map((s) => [s.key, s.value]));

    const bank_info = {
      bank: settingsMap.get('rekening_bank') || 'BCA Syariah',
      nomor_rekening: settingsMap.get('rekening_nomor') || '0680909090',
      atas_nama: settingsMap.get('rekening_atas_nama') || 'Yayasan Muslim Scene Official',
      kontak_panitia_wa: settingsMap.get('kontak_panitia_wa') || '081234567890',
    };

    const namaAcara = settingsMap.get('nama_acara') || 'Family Camp';
    const tplUndangan = await db
      .prepare(`SELECT body, aktif FROM wa_templates WHERE id = 'wa_undangan_bayar'`)
      .first<{ body: string; aktif: number }>();

    const fallbackUndangan = `بسم الله
السلام عليكم ورحمة الله وبركاته
Halo *{nama_pic}*,

Terima kasih telah mendaftar *{nama_acara}*.

Total tagihan kelompok Anda: *{total}* untuk {jumlah_anggota} peserta.

Silakan lanjutkan pembayaran & simpan tautan berikut agar tidak hilang:
🔗 {link_pembayaran}

Setelah transfer, unggah bukti pembayaran pada tautan di atas.

جزاكم الله خيرا
_Panitia {nama_acara}_`;

    return c.json({
      success: true,
      data: {
        grup,
        anggota: anggotaRes.results || [],
        addons: addonsRes.results || [],
        bank_info,
        nama_acara: namaAcara,
        wa_undangan_body: tplUndangan?.aktif ? tplUndangan.body : fallbackUndangan,
      },
    });
  } catch (err: any) {
    console.error('Error get pembayaran:', err);
    return c.json({ error: 'Gagal mengambil data pembayaran: ' + err.message }, 500);
  }
});

/**
 * POST /api/peserta/pembayaran/:token/upload
 * Menerima unggahan file screenshot bukti transfer untuk pembayaran grup
 */
pesertaRoutes.post('/pembayaran/:token/upload', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const token = c.req.param('token');
  if (!token) {
    return c.json({ error: 'Token pembayaran tidak valid' }, 400);
  }

  const grup = await db
    .prepare(`SELECT id, status FROM pendaftaran_grup WHERE payment_token = ?`)
    .bind(token)
    .first<{ id: string; status: string }>();

  if (!grup) {
    return c.json({ error: 'Data pendaftaran tidak ditemukan' }, 404);
  }

  const storage = new StorageService(c.env.STORAGE);
  const body = await c.req.parseBody();
  const bukti = body['bukti'] as File;

  if (!bukti || typeof bukti === 'string') {
    return c.json({ error: 'File bukti transfer wajib diunggah.' }, 400);
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  if (!allowedTypes.includes(bukti.type)) {
    return c.json({ error: 'Format bukti transfer harus JPG, PNG, atau WEBP.' }, 400);
  }

  if (bukti.size > 5 * 1024 * 1024) {
    return c.json({ error: 'Ukuran file bukti maksimal 5MB.' }, 400);
  }

  let ext = 'jpg';
  if (bukti.type === 'image/png') ext = 'png';
  else if (bukti.type === 'image/webp') ext = 'webp';

  const storageKey = `bukti-grup/${grup.id}.${ext}`;

  try {
    const fileBuffer = await bukti.arrayBuffer();
    await storage.upload(storageKey, fileBuffer, bukti.type);

    const buktiUrl = `/api/peserta/screenshot/${encodeURIComponent(storageKey)}`;

    await db
      .prepare(
        `UPDATE pendaftaran_grup
         SET bukti_url = ?,
             status = 'menunggu_verifikasi',
             paid_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(buktiUrl, grup.id)
      .run();

    return c.json({
      success: true,
      message: 'Bukti transfer berhasil diunggah. Panitia akan segera memverifikasi pembayaran Anda.',
      bukti_url: buktiUrl,
      status: 'menunggu_verifikasi',
    });
  } catch (err: any) {
    console.error('Error upload bukti pembayaran:', err);
    return c.json({ error: 'Gagal mengunggah bukti: ' + err.message }, 500);
  }
});

/**
 * GET /api/peserta/status-grup
 * Cek status pendaftaran dan tiket grup berdasarkan nomor WhatsApp PIC
 */
pesertaRoutes.get('/status-grup', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const wa = c.req.query('wa')?.trim();
  const token = c.req.query('token')?.trim();

  if (!wa && !token) {
    return c.json({ error: 'Nomor WhatsApp atau Token Pembayaran diperlukan.' }, 400);
  }

  try {
    let sql = `SELECT * FROM pendaftaran_grup WHERE 1=1`;
    const params: any[] = [];

    if (token) {
      sql += ` AND payment_token = ?`;
      params.push(token);
    } else if (wa) {
      // Cocokkan nomor utuh saja (format 62xxx atau 0xxx). Tidak ada pencocokan sebagian.
      const variants = getPhoneVariants(wa);
      if (variants[0].length < 10) {
        return c.json({ error: 'Nomor WhatsApp harus lengkap, minimal 10 digit.' }, 400);
      }
      sql += ` AND (pic_whatsapp = ? OR pic_whatsapp = ?)`;
      params.push(variants[0], variants[1]);
    }

    sql += ` ORDER BY created_at DESC LIMIT 5`;

    const grupRes = await db.prepare(sql).bind(...params).all<any>();
    const groups = grupRes.results || [];

    if (groups.length === 0) {
      return c.json({ error: 'Data pendaftaran dengan nomor WhatsApp tersebut tidak ditemukan.' }, 404);
    }

    // Ambil anggota untuk setiap grup (lengkap dengan nomor peserta, kategori usia, & log scan)
    const enrichedGroups = [];
    for (const g of groups) {
      const anggota = await db
        .prepare(
          `SELECT id, nomor_peserta, nama, peran, jenis_kelamin, usia, is_gratis, makan_dicover,
                  qr_token, status_hadir, attended_at, provinsi, kota
           FROM anggota WHERE grup_id = ? ORDER BY nomor_peserta ASC`
        )
        .bind(g.id)
        .all<any>();

      const anggotaList = anggota.results || [];

      // Ambil log scan per anggota (status check-in & jatah makan)
      const ids = anggotaList.map((a: any) => a.id);
      const scanByAnggota: Record<string, Record<string, string>> = {};
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const scanRes = await db
          .prepare(`SELECT anggota_id, sesi, scanned_at FROM scan_log WHERE anggota_id IN (${placeholders})`)
          .bind(...ids)
          .all<any>();
        for (const row of scanRes.results || []) {
          if (!scanByAnggota[row.anggota_id]) scanByAnggota[row.anggota_id] = {};
          scanByAnggota[row.anggota_id][row.sesi] = row.scanned_at;
        }
      }

      const enrichedAnggota = anggotaList.map((a: any) => ({
        ...a,
        kategori_usia: getKategoriUsia(a.usia),
        kategori_usia_label: getKategoriUsiaLabel(a.usia),
        scan_sesi: scanByAnggota[a.id] || {},
      }));

      enrichedGroups.push({
        ...g,
        anggota: enrichedAnggota,
      });
    }

    return c.json({
      success: true,
      data: enrichedGroups,
    });
  } catch (err: any) {
    console.error('Error get status grup:', err);
    return c.json({ error: 'Gagal mengambil status: ' + err.message }, 500);
  }
});

/**
 * GET /api/peserta/:id
 * Detail data pendaftar legacy by ID (Diposisikan di paling bawah agar tidak memotong rute spesifik)
 */
pesertaRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const id = c.req.param('id');
  const record = await db
    .prepare(
      `SELECT id, nama, email, no_whatsapp, instansi, screenshot_url, qr_token, status, created_at
       FROM pendaftar WHERE id = ?`
    )
    .bind(id)
    .first();

  if (!record) {
    return c.json({ error: 'Data pendaftar tidak ditemukan' }, 404);
  }

  return c.json(record);
});

