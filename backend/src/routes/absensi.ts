import { Hono } from 'hono';
import { authMiddleware, AdminJwtPayload } from '../middlewares/auth';
import {
  getKategoriUsia,
  getKategoriUsiaLabel,
  isBerbayar,
  KATEGORI_USIA,
  SESI_MAKAN,
  isSesiScanValid,
  getSesiLabel,
} from '../services/peserta-rules';

type Bindings = {
  DB: D1Database;
};

type Variables = {
  user: AdminJwtPayload;
};

export const absensiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Seluruh endpoint absensi (statistik, lookup QR, scan presensi) hanya untuk admin terautentikasi.
absensiRoutes.use('/*', authMiddleware);

/**
 * GET /api/absensi/stats
 * Rekap statistik pendaftaran & kehadiran Family Camp untuk dashboard admin
 *
 * Statistik meliputi:
 * - Total anggota peserta
 * - Breakdown kategori usia (balita, anak, remaja, dewasa, lansia)
 * - Breakdown jenis kelamin (L/P)
 * - Breakdown status bayar (berbayar/gratis)
 * - Status grup (lunas, menunggu_verifikasi, menunggu_pembayaran)
 * - Kehadiran check-in & makan (dari scan_log)
 */
absensiRoutes.get('/stats', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({
      total_anggota: 0,
      breakdown_usia: {},
      breakdown_gender: { L: 0, P: 0, tidak_diketahui: 0 },
      breakdown_bayar: { berbayar: 0, gratis: 0 },
      breakdown_grup_status: {},
      kehadiran: {},
      persentase_checkin: 0,
    });
  }

  try {
    // 1. Statistik dasar anggota
    const anggotaRes = await db
      .prepare(`SELECT a.usia, a.jenis_kelamin, a.is_gratis, a.makan_dicover, a.status_hadir, g.status as grup_status
                FROM anggota a
                JOIN pendaftaran_grup g ON a.grup_id = g.id`)
      .all<any>();
    const anggotaList = anggotaRes.results || [];

    // Hitung breakdown
    const breakdownUsia: Record<string, number> = {
      balita: 0,
      anak: 0,
      remaja: 0,
      dewasa: 0,
      lansia: 0,
      tidak_diketahui: 0,
    };
    const breakdownGender: Record<string, number> = { L: 0, P: 0, tidak_diketahui: 0 };
    const breakdownBayar = { berbayar: 0, gratis: 0 };
    const breakdownGrupStatus: Record<string, number> = {
      lunas: 0,
      menunggu_verifikasi: 0,
      menunggu_pembayaran: 0,
      ditolak: 0,
    };

    let totalHadir = 0;
    let totalDariGrupLunas = 0;

    for (const a of anggotaList) {
      // Usia
      const kat = getKategoriUsia(a.usia);
      breakdownUsia[kat] = (breakdownUsia[kat] || 0) + 1;

      // Gender (DB menyimpan 'Ikhwan'/'Akhwat'; dukung juga 'L'/'P')
      const jk = String(a.jenis_kelamin || '').toLowerCase();
      const g = jk === 'ikhwan' || jk === 'l' ? 'L' : jk === 'akhwat' || jk === 'p' ? 'P' : 'tidak_diketahui';
      breakdownGender[g] = (breakdownGender[g] || 0) + 1;

      // Bayar
      if (a.is_gratis) {
        breakdownBayar.gratis++;
      } else {
        breakdownBayar.berbayar++;
      }

      // Grup status
      const gs = a.grup_status || 'menunggu_pembayaran';
      breakdownGrupStatus[gs] = (breakdownGrupStatus[gs] || 0) + 1;

      // Kehadiran (hanya hitung grup lunas)
      if (gs === 'lunas') {
        totalDariGrupLunas++;
        if (a.status_hadir === 'hadir') {
          totalHadir++;
        }
      }
    }

    // 2. Statistik scan per sesi dari scan_log
    const kehadiran: Record<string, { hadir: number; total: number; persentase: number }> = {};

    for (const sesi of SESI_MAKAN) {
      const scanRes = await db
        .prepare(`
          SELECT COUNT(DISTINCT sl.anggota_id) as hadir
          FROM scan_log sl
          JOIN anggota a ON sl.anggota_id = a.id
          JOIN pendaftaran_grup g ON a.grup_id = g.id
          WHERE sl.sesi = ? AND g.status = 'lunas'
        `)
        .bind(sesi.id)
        .first<{ hadir: number }>();

      const hadir = scanRes?.hadir || 0;
      kehadiran[sesi.id] = {
        hadir,
        total: totalDariGrupLunas,
        persentase: totalDariGrupLunas > 0 ? Math.round((hadir / totalDariGrupLunas) * 100) : 0,
      };
    }

    const persentaseCheckin = kehadiran['checkin']?.persentase || 0;

    return c.json({
      total_anggota: anggotaList.length,
      total_grup_lunas: totalDariGrupLunas,
      breakdown_usia: breakdownUsia,
      breakdown_gender: breakdownGender,
      breakdown_bayar: breakdownBayar,
      breakdown_grup_status: breakdownGrupStatus,
      kehadiran,
      persentase_checkin: persentaseCheckin,
      sudah_hadir: totalHadir,
      belum_hadir: totalDariGrupLunas - totalHadir,
      // Backward compatibility untuk Dashboard lama
      total: anggotaList.length,
      menunggu: breakdownGrupStatus.menunggu_verifikasi || 0,
      dikonfirmasi: totalDariGrupLunas,
      ditolak: breakdownGrupStatus.ditolak || 0,
      hadir: totalHadir,
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
 *
 * Response menyertakan:
 * - Informasi peserta lengkap (nomor_peserta, nama, peran, usia, kategori_usia, jenis_kelamin)
 * - Info grup (nomor_grup, PIC, status)
 * - Catatan medis (jika ada)
 * - Status jatah makan
 * - Riwayat scan per sesi
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
        `SELECT a.id, a.nama, a.nomor_peserta, a.peran, a.jenis_kelamin, a.usia, a.ukuran_kaos,
                a.catatan_medis, a.is_gratis, a.makan_dicover, a.status_hadir, a.qr_token, a.attended_at,
                g.id as grup_id, g.nomor_grup, g.tipe as grup_tipe, g.pic_nama, g.pic_whatsapp, g.status as grup_status
         FROM anggota a
         JOIN pendaftaran_grup g ON a.grup_id = g.id
         WHERE a.qr_token = ?`
      )
      .bind(token)
      .first<any>();

    if (member) {
      // Ambil riwayat scan per sesi
      const scanLogRes = await db
        .prepare(`SELECT sesi, scanned_at, scanned_by FROM scan_log WHERE anggota_id = ? ORDER BY scanned_at ASC`)
        .bind(member.id)
        .all<any>();

      const scanHistory: Record<string, { scanned: boolean; scanned_at?: string; scanned_by?: string }> = {};
      for (const sesi of SESI_MAKAN) {
        const log = (scanLogRes.results || []).find((s: any) => s.sesi === sesi.id);
        scanHistory[sesi.id] = log
          ? { scanned: true, scanned_at: log.scanned_at, scanned_by: log.scanned_by }
          : { scanned: false };
      }

      const kategoriUsia = getKategoriUsia(member.usia);
      const kategoriUsiaLabel = getKategoriUsiaLabel(member.usia);
      const dapatMakan = isBerbayar(member.usia, member.makan_dicover);

      return c.json({
        success: true,
        data: {
          id: member.id,
          nomor_peserta: member.nomor_peserta,
          nama: member.nama,
          peran: member.peran,
          jenis_kelamin: member.jenis_kelamin,
          usia: member.usia,
          kategori_usia: kategoriUsia,
          kategori_usia_label: kategoriUsiaLabel,
          ukuran_kaos: member.ukuran_kaos,
          catatan_medis: member.catatan_medis,
          is_gratis: Boolean(member.is_gratis),
          makan_dicover: Boolean(member.makan_dicover),
          dapat_jatah_makan: dapatMakan,
          status_hadir: member.status_hadir || 'belum_hadir',
          attended_at: member.attended_at,
          qr_token: member.qr_token,
          // Info grup
          grup_id: member.grup_id,
          nomor_grup: member.nomor_grup,
          grup_tipe: member.grup_tipe,
          grup: `${member.grup_tipe === 'keluarga' ? 'Keluarga' : 'Grup'} ${member.pic_nama} (${member.nomor_grup})`,
          pic_nama: member.pic_nama,
          pic_whatsapp: member.pic_whatsapp,
          grup_status: member.grup_status,
          // Riwayat scan
          scan_history: scanHistory,
          sesi_tersedia: SESI_MAKAN.map((s) => ({ id: s.id, label: s.label })),
          tipe: 'familycamp_anggota',
        },
      });
    }

    // 2. QR tidak terdaftar pada tabel anggota Family Camp
    return c.json({ error: 'QR Code tidak terdaftar / tidak valid!' }, 404);
  } catch (err: any) {
    return c.json({ error: 'Gagal mencari data QR: ' + err.message }, 500);
  }
});

/**
 * POST /api/absensi/scan
 * Validasi QR code kehadiran saat di-scan oleh kamera HP panitia
 *
 * Body:
 *   - token: QR token peserta
 *   - sesi: 'checkin' | 'makan_sabtu_siang' | 'makan_sabtu_malam' | 'makan_ahad_pagi' (default: checkin)
 *
 * Flow:
 *   1. Validasi sesi dan token
 *   2. Cek apakah peserta sudah scan sesi ini sebelumnya
 *   3. Jika belum, catat ke scan_log
 *   4. Jika sesi = checkin dan belum pernah hadir, update status_hadir & attended_at
 */
absensiRoutes.post('/scan', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json({ error: 'Database D1 tidak terhubung' }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const token = (body.token as string)?.trim();
  const sesi = (body.sesi as string)?.trim() || 'checkin';
  const user = c.get('user');
  const scannedBy = user?.nama || user?.username || 'Panitia';

  if (!token) {
    return c.json({ error: 'Kode token QR wajib dikirim' }, 400);
  }

  if (!isSesiScanValid(sesi)) {
    return c.json({
      error: `Sesi "${sesi}" tidak valid. Pilih: ${SESI_MAKAN.map((s) => s.id).join(', ')}`,
    }, 400);
  }

  const sesiLabel = getSesiLabel(sesi);

  try {
    // 1. Cek tabel Anggota Family Camp
    const member = await db
      .prepare(
        `SELECT a.id, a.nama, a.nomor_peserta, a.peran, a.usia, a.jenis_kelamin, a.is_gratis, a.makan_dicover,
                a.catatan_medis, a.status_hadir, a.attended_at,
                g.id as grup_id, g.nomor_grup, g.tipe as grup_tipe, g.pic_nama, g.pic_whatsapp, g.status as grup_status
         FROM anggota a
         JOIN pendaftaran_grup g ON a.grup_id = g.id
         WHERE a.qr_token = ?`
      )
      .bind(token)
      .first<any>();

    if (member) {
      // Validasi status grup
      if (member.grup_status !== 'lunas') {
        return c.json(
          {
            error: `Status pendaftaran grup belum lunas (${member.grup_status}).`,
            nama: member.nama,
            nomor_peserta: member.nomor_peserta,
            status: member.grup_status,
          },
          400
        );
      }

      // Validasi jatah makan: peserta gratis tanpa cover tidak dapat jatah makan
      if (sesi !== 'checkin' && member.is_gratis && !member.makan_dicover) {
        return c.json(
          {
            error: `Peserta ${member.nama} (usia ${member.usia} th) tidak mendapat jatah makan. Status: Gratis tanpa fasilitas.`,
            nama: member.nama,
            nomor_peserta: member.nomor_peserta,
            is_gratis: true,
            makan_dicover: false,
          },
          400
        );
      }

      // Cek apakah sudah scan sesi ini sebelumnya
      const existingScan = await db
        .prepare(`SELECT id, scanned_at FROM scan_log WHERE anggota_id = ? AND sesi = ?`)
        .bind(member.id, sesi)
        .first<{ id: string; scanned_at: string }>();

      if (existingScan) {
        return c.json(
          {
            error: `Peserta ${member.nama} sudah tercatat untuk ${sesiLabel} pada ${existingScan.scanned_at}`,
            nama: member.nama,
            nomor_peserta: member.nomor_peserta,
            peran: member.peran,
            grup: `${member.grup_tipe === 'keluarga' ? 'Keluarga' : 'Grup'} ${member.pic_nama}`,
            sesi,
            sesi_label: sesiLabel,
            scanned_at: existingScan.scanned_at,
            status: 'sudah_scan',
          },
          409
        );
      }

      const now = new Date().toISOString();

      // Insert scan log
      const scanLogId = 'scan_' + crypto.randomUUID().slice(0, 12);
      await db
        .prepare(
          `INSERT INTO scan_log (id, anggota_id, grup_id, sesi, scanned_at, scanned_by)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`
        )
        .bind(scanLogId, member.id, member.grup_id, sesi, scannedBy)
        .run();

      // Jika check-in dan belum pernah hadir, update status_hadir
      if (sesi === 'checkin' && member.status_hadir !== 'hadir') {
        await db
          .prepare(
            `UPDATE anggota
             SET status_hadir = 'hadir',
                 attended_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .bind(member.id)
          .run();
      }

      const kategoriUsiaLabel = getKategoriUsiaLabel(member.usia);

      return c.json({
        success: true,
        message: sesi === 'checkin'
          ? `✅ Check-in Berhasil: Selamat Datang, ${member.nama}!`
          : `✅ ${sesiLabel} tercatat untuk ${member.nama}`,
        nama: member.nama,
        nomor_peserta: member.nomor_peserta,
        peran: member.peran,
        usia: member.usia,
        kategori_usia: kategoriUsiaLabel,
        jenis_kelamin: member.jenis_kelamin,
        catatan_medis: member.catatan_medis,
        is_gratis: Boolean(member.is_gratis),
        grup: `${member.grup_tipe === 'keluarga' ? 'Keluarga' : 'Grup'} ${member.pic_nama} (${member.nomor_grup})`,
        pic_nama: member.pic_nama,
        pic_whatsapp: member.pic_whatsapp,
        sesi,
        sesi_label: sesiLabel,
        scanned_at: now,
        status: 'berhasil',
      });
    }

    // 2. QR tidak terdaftar pada tabel anggota Family Camp
    return c.json({ error: 'QR Code tidak terdaftar / tidak valid!' }, 404);
  } catch (err: any) {
    console.error('Error scan kehadiran:', err);
    return c.json({ error: 'Gagal memproses validasi kehadiran: ' + err.message }, 500);
  }
});
