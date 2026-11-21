import { Hono } from 'hono';
import { authMiddleware } from '../middlewares/auth';

type Bindings = {
  DB: D1Database;
};

export const absensiRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * GET /api/absensi/stats
 * Rekap statistik pendaftaran & kehadiran untuk dashboard admin
 */
absensiRoutes.get('/stats', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({
      total: 0,
      menunggu: 0,
      dikonfirmasi: 0,
      ditolak: 0,
      hadir: 0,
      sudah_hadir: 0,
      belum_hadir: 0,
      persentase_kehadiran: 0,
    });
  }

  try {
    const stats = await db
      .prepare(
        `SELECT
           COUNT(*) as total,
           COALESCE(SUM(CASE WHEN status = 'menunggu' THEN 1 ELSE 0 END), 0) as menunggu,
           COALESCE(SUM(CASE WHEN status IN ('dikonfirmasi', 'hadir') THEN 1 ELSE 0 END), 0) as dikonfirmasi,
           COALESCE(SUM(CASE WHEN status = 'ditolak' THEN 1 ELSE 0 END), 0) as ditolak,
           COALESCE(SUM(CASE WHEN status = 'hadir' THEN 1 ELSE 0 END), 0) as sudah_hadir,
           COALESCE(SUM(CASE WHEN status = 'dikonfirmasi' THEN 1 ELSE 0 END), 0) as belum_hadir
         FROM pendaftar`
      )
      .first<{
        total: number;
        menunggu: number;
        dikonfirmasi: number;
        ditolak: number;
        sudah_hadir: number;
        belum_hadir: number;
      }>();

    const total = stats?.total || 0;
    const menunggu = stats?.menunggu || 0;
    const dikonfirmasi = stats?.dikonfirmasi || 0;
    const ditolak = stats?.ditolak || 0;
    const sudah_hadir = stats?.sudah_hadir || 0;
    const belum_hadir = stats?.belum_hadir || Math.max(0, dikonfirmasi - sudah_hadir);
    const persentase_kehadiran = dikonfirmasi > 0
      ? Math.min(100, Math.max(0, Math.round((sudah_hadir / dikonfirmasi) * 100)))
      : 0;

    return c.json({
      total,
      menunggu,
      dikonfirmasi,
      ditolak,
      hadir: sudah_hadir,
      sudah_hadir,
      belum_hadir,
      persentase_kehadiran,
    });
  } catch (err: any) {
    console.error('Error stats absensi:', err);
    return c.json({ error: 'Gagal memuat statistik: ' + err.message }, 500);
  }
});

/**
 * GET /api/absensi/stats-grup
 * Rekap statistik Family Camp untuk dashboard admin: total grup, anggota, & revenue
 */
absensiRoutes.get('/stats-grup', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({
      total_grup: 0,
      menunggu_pembayaran: 0,
      menunggu_verifikasi: 0,
      lunas: 0,
      ditolak: 0,
      total_anggota: 0,
      total_hadir: 0,
      total_revenue: 0,
    });
  }

  try {
    const grupStats = await db
      .prepare(
        `SELECT
           COUNT(*) as total_grup,
           COALESCE(SUM(CASE WHEN status = 'menunggu_pembayaran' THEN 1 ELSE 0 END), 0) as menunggu_pembayaran,
           COALESCE(SUM(CASE WHEN status = 'menunggu_verifikasi' THEN 1 ELSE 0 END), 0) as menunggu_verifikasi,
           COALESCE(SUM(CASE WHEN status = 'lunas' THEN 1 ELSE 0 END), 0) as lunas,
           COALESCE(SUM(CASE WHEN status = 'ditolak' THEN 1 ELSE 0 END), 0) as ditolak,
           COALESCE(SUM(jumlah_anggota), 0) as total_anggota,
           COALESCE(SUM(CASE WHEN status = 'lunas' THEN grand_total ELSE 0 END), 0) as total_revenue
         FROM pendaftaran_grup`
      )
      .first<{
        total_grup: number;
        menunggu_pembayaran: number;
        menunggu_verifikasi: number;
        lunas: number;
        ditolak: number;
        total_anggota: number;
        total_revenue: number;
      }>();

    const totalHadirRes = await db
      .prepare(`SELECT COUNT(*) as count FROM anggota WHERE status_hadir = 'hadir'`)
      .first<{ count: number }>();

    return c.json({
      total_grup: grupStats?.total_grup || 0,
      menunggu_pembayaran: grupStats?.menunggu_pembayaran || 0,
      menunggu_verifikasi: grupStats?.menunggu_verifikasi || 0,
      lunas: grupStats?.lunas || 0,
      ditolak: grupStats?.ditolak || 0,
      total_anggota: grupStats?.total_anggota || 0,
      total_hadir: totalHadirRes?.count || 0,
      total_revenue: grupStats?.total_revenue || 0,
    });
  } catch (err: any) {
    console.error('Error stats grup:', err);
    return c.json({ error: 'Gagal memuat statistik grup: ' + err.message }, 500);
  }
});

/**
 * POST /api/absensi/lookup
 * Mencari dan menampilkan preview data peserta berdasarkan token QR tanpa mengubah statusnya
 */
absensiRoutes.post('/lookup', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const token = (body.token as string)?.trim();

  if (!token) {
    return c.json({ error: 'Kode token QR wajib dikirim' }, 400);
  }

  try {
    // 1. Cek tabel Anggota Family Camp
    const member = await db
      .prepare(
        `SELECT a.id, a.nama, a.peran, a.jenis_kelamin, a.usia, a.ukuran_kaos, a.status_hadir, a.qr_token, a.attended_at,
                g.id as grup_id, g.tipe as grup_tipe, g.pic_nama, g.pic_whatsapp, g.status as grup_status
         FROM anggota a
         JOIN pendaftaran_grup g ON a.grup_id = g.id
         WHERE a.qr_token = ?`
      )
      .bind(token)
      .first<any>();

    if (member) {
      return c.json({
        success: true,
        data: {
          id: member.id,
          nama: member.nama,
          peran: member.peran,
          instansi: `${member.grup_tipe === 'keluarga' ? 'Keluarga' : 'Grup'} - PIC: ${member.pic_nama} (${member.peran})`,
          no_whatsapp: member.pic_whatsapp,
          status: member.grup_status === 'lunas' ? (member.status_hadir === 'hadir' ? 'hadir' : 'dikonfirmasi') : member.grup_status,
          qr_token: member.qr_token,
          attended_at: member.attended_at,
          tipe: 'familycamp_anggota',
        },
      });
    }

    // 2. Fallback: Cek tabel pendaftar (legacy)
    const pendaftar = await db
      .prepare(
        `SELECT id, nama, email, no_whatsapp, instansi, status, qr_token, attended_at, created_at, confirmed_at, screenshot_url
         FROM pendaftar
         WHERE qr_token = ?`
      )
      .bind(token)
      .first<any>();

    if (!pendaftar) {
      return c.json({ error: 'QR Code tidak terdaftar / tidak valid!' }, 404);
    }

    return c.json({
      success: true,
      data: pendaftar,
    });
  } catch (err: any) {
    return c.json({ error: 'Gagal mencari data QR: ' + err.message }, 500);
  }
});

/**
 * POST /api/absensi/scan
 * Validasi QR code kehadiran saat di-scan oleh kamera HP panitia
 */
absensiRoutes.post('/scan', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const token = (body.token as string)?.trim();

  if (!token) {
    return c.json({ error: 'Kode token QR wajib dikirim' }, 400);
  }

  try {
    // 1. Cek tabel Anggota Family Camp
    const member = await db
      .prepare(
        `SELECT a.id, a.nama, a.peran, a.status_hadir, a.attended_at,
                g.id as grup_id, g.tipe as grup_tipe, g.pic_nama, g.pic_whatsapp, g.status as grup_status
         FROM anggota a
         JOIN pendaftaran_grup g ON a.grup_id = g.id
         WHERE a.qr_token = ?`
      )
      .bind(token)
      .first<any>();

    if (member) {
      if (member.grup_status !== 'lunas') {
        return c.json(
          {
            error: `Status pendaftaran grup belum lunas (${member.grup_status}).`,
            nama: member.nama,
            status: member.grup_status,
          },
          400
        );
      }

      if (member.status_hadir === 'hadir') {
        return c.json(
          {
            error: `Peserta ${member.nama} (${member.peran}) sudah tercatat hadir sebelumnya!`,
            nama: member.nama,
            instansi: `${member.grup_tipe === 'keluarga' ? 'Keluarga' : 'Grup'} - PIC: ${member.pic_nama}`,
            attended_at: member.attended_at,
            status: 'hadir',
          },
          409
        );
      }

      const now = new Date().toISOString();
      await db
        .prepare(
          `UPDATE anggota
           SET status_hadir = 'hadir',
               attended_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(member.id)
        .run();

      return c.json({
        success: true,
        message: `Presensi Berhasil: Selamat Datang, ${member.nama} (${member.peran})!`,
        nama: member.nama,
        instansi: `${member.grup_tipe === 'keluarga' ? 'Keluarga' : 'Grup'} ${member.pic_nama}`,
        attended_at: now,
        status: 'hadir',
      });
    }

    // 2. Fallback: Cek tabel pendaftar (legacy)
    const pendaftar = await db
      .prepare(
        `SELECT id, nama, no_whatsapp, instansi, status, qr_token, attended_at
         FROM pendaftar
         WHERE qr_token = ?`
      )
      .bind(token)
      .first<{
        id: string;
        nama: string;
        no_whatsapp: string;
        instansi: string;
        status: string;
        qr_token: string;
        attended_at: string | null;
      }>();

    if (!pendaftar) {
      return c.json({ error: 'QR Code tidak terdaftar / tidak valid!' }, 404);
    }

    if (pendaftar.status === 'menunggu') {
      return c.json(
        {
          error: 'Pendaftar belum dikonfirmasi oleh panitia.',
          nama: pendaftar.nama,
          status: pendaftar.status,
        },
        400
      );
    }

    if (pendaftar.status === 'ditolak') {
      return c.json(
        {
          error: 'Status pendaftaran ditolak oleh panitia.',
          nama: pendaftar.nama,
          status: pendaftar.status,
        },
        400
      );
    }

    if (pendaftar.status === 'hadir') {
      return c.json(
        {
          error: 'Peserta sudah tercatat hadir sebelumnya!',
          nama: pendaftar.nama,
          instansi: pendaftar.instansi,
          attended_at: pendaftar.attended_at,
          status: 'hadir',
        },
        409
      );
    }

    // Status 'dikonfirmasi' -> Ubah status menjadi 'hadir'
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE pendaftar
         SET status = 'hadir',
             attended_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(pendaftar.id)
      .run();

    return c.json({
      success: true,
      message: `Presensi Berhasil: Selamat Datang, ${pendaftar.nama}!`,
      nama: pendaftar.nama,
      instansi: pendaftar.instansi,
      attended_at: now,
      status: 'hadir',
    });
  } catch (err: any) {
    console.error('Error scan kehadiran:', err);
    return c.json({ error: 'Gagal memproses validasi kehadiran: ' + err.message }, 500);
  }
});
