import { Hono } from 'hono';
import { authMiddleware, AdminJwtPayload } from '../middlewares/auth';
import {
  getKategoriUsia,
  getKategoriUsiaLabel,
  isBerbayar,
  dapatJatahMakan,
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
 * GET /api/absensi/dashboard
 * Ringkasan dashboard admin bertab: pembayaran & grup, peserta, kehadiran & konsumsi.
 *
 * Aturan hitung:
 * - "Terdaftar" = anggota pada grup selain 'ditolak' (dan 'draft' dianggap belum terdaftar).
 * - "Hadir" = anggota terdaftar dengan status_hadir = 'hadir'.
 * - Konsumsi hanya menghitung peserta grup 'lunas' yang berjatah makan (dapatJatahMakan).
 */
type GenderKey = 'ikhwan' | 'akhwat' | 'tidak_diketahui';

interface KategoriBreakdown {
  total: number;
  ikhwan: number;
  akhwat: number;
}

interface PesertaBreakdown {
  total: number;
  gender: Record<GenderKey, number>;
  per_kategori: Record<string, KategoriBreakdown>;
}

const KATEGORI_DASHBOARD = [...KATEGORI_USIA.map((k) => k.id), 'tidak_diketahui'];

function normalizeGender(jenisKelamin: unknown): GenderKey {
  const jk = String(jenisKelamin ?? '').trim().toLowerCase();
  if (jk === 'ikhwan' || jk === 'l') return 'ikhwan';
  if (jk === 'akhwat' || jk === 'p') return 'akhwat';
  return 'tidak_diketahui';
}

function buatBreakdownPeserta(): PesertaBreakdown {
  const per_kategori: Record<string, KategoriBreakdown> = {};
  for (const id of KATEGORI_DASHBOARD) {
    per_kategori[id] = { total: 0, ikhwan: 0, akhwat: 0 };
  }
  return {
    total: 0,
    gender: { ikhwan: 0, akhwat: 0, tidak_diketahui: 0 },
    per_kategori,
  };
}

function tambahKeBreakdown(target: PesertaBreakdown, usia: unknown, gender: GenderKey): void {
  const kategori = getKategoriUsia(usia === null || usia === undefined ? null : Number(usia));
  const row = target.per_kategori[kategori] || (target.per_kategori[kategori] = { total: 0, ikhwan: 0, akhwat: 0 });

  target.total++;
  target.gender[gender]++;
  row.total++;
  if (gender === 'ikhwan') row.ikhwan++;
  if (gender === 'akhwat') row.akhwat++;
}

function dashboardKosong() {
  return {
    pembayaran: {
      menunggu_pembayaran: { jumlah_grup: 0, tagihan: 0, diterima: 0 },
      menunggu_verifikasi: { jumlah_grup: 0, tagihan: 0, diterima: 0 },
      lunas: { jumlah_grup: 0, tagihan: 0, diterima: 0, kurang: 0, lebih: 0 },
      ditolak: { jumlah_grup: 0, tagihan: 0, diterima: 0 },
      total: { jumlah_grup: 0, tagihan: 0, diterima: 0 },
    },
    peserta: {
      terdaftar: buatBreakdownPeserta(),
      hadir: buatBreakdownPeserta(),
    },
    konsumsi: {
      total_berjatah: 0,
      tanpa_jatah: 0,
      sesi: Object.fromEntries(
        SESI_MAKAN.filter((s) => s.id !== 'checkin').map((s) => [
          s.id,
          { sudah: 0, belum: 0, total: 0, persentase: 0 },
        ])
      ) as Record<string, { sudah: number; belum: number; total: number; persentase: number }>,
    },
    persentase_kehadiran: { terhadap_semua_terdaftar: 0, terhadap_lunas: 0 },
    generated_at: new Date().toISOString(),
  };
}

absensiRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB;
  if (!db) {
    return c.json(dashboardKosong());
  }

  try {
    const hasil = dashboardKosong();

    // Query independen dijalankan paralel agar tidak menambah latensi D1 berganda.
    const [grupRes, anggotaRes, scanRes] = await Promise.all([
      db
        .prepare(
          `SELECT status,
                  COUNT(*) as jumlah_grup,
                  COALESCE(SUM(grand_total), 0) as tagihan,
                  COALESCE(SUM(CASE WHEN status = 'lunas'
                                    THEN COALESCE(nominal_dibayar, grand_total, 0)
                                    ELSE COALESCE(nominal_dibayar, 0) END), 0) as diterima
           FROM pendaftaran_grup
           GROUP BY status`
        )
        .all<{ status: string; jumlah_grup: number; tagihan: number; diterima: number }>(),
      db
        .prepare(
          `SELECT a.id, a.usia, a.jenis_kelamin, a.makan_dicover, a.status_hadir, g.status as grup_status
           FROM anggota a
           JOIN pendaftaran_grup g ON a.grup_id = g.id`
        )
        .all<{
          id: string;
          usia: number | null;
          jenis_kelamin: string | null;
          makan_dicover: number | null;
          status_hadir: string | null;
          grup_status: string | null;
        }>(),
      db
        .prepare(
          `SELECT DISTINCT sl.sesi, sl.anggota_id
           FROM scan_log sl
           JOIN anggota a ON sl.anggota_id = a.id
           JOIN pendaftaran_grup g ON a.grup_id = g.id
           WHERE g.status = 'lunas'`
        )
        .all<{ sesi: string; anggota_id: string }>(),
    ]);

    // 1. Pembayaran & grup per status

    const statusUtama = ['menunggu_pembayaran', 'menunggu_verifikasi', 'lunas', 'ditolak'] as const;
    let totalGrup = 0;
    let totalTagihan = 0;
    let totalDiterima = 0;

    for (const row of grupRes.results || []) {
      const status = String(row.status || '');
      // 'draft' dianggap pendaftaran yang belum jadi; tidak dihitung pada rekap.
      if (status === 'draft') continue;

      const jumlah = Number(row.jumlah_grup) || 0;
      const tagihan = Number(row.tagihan) || 0;
      const diterima = Number(row.diterima) || 0;

      totalGrup += jumlah;
      totalTagihan += tagihan;
      totalDiterima += diterima;

      if ((statusUtama as readonly string[]).includes(status)) {
        const target = hasil.pembayaran[status as (typeof statusUtama)[number]] as any;
        target.jumlah_grup = jumlah;
        target.tagihan = tagihan;
        target.diterima = diterima;
      }
    }

    hasil.pembayaran.lunas.kurang = Math.max(hasil.pembayaran.lunas.tagihan - hasil.pembayaran.lunas.diterima, 0);
    hasil.pembayaran.lunas.lebih = Math.max(hasil.pembayaran.lunas.diterima - hasil.pembayaran.lunas.tagihan, 0);
    hasil.pembayaran.total = { jumlah_grup: totalGrup, tagihan: totalTagihan, diterima: totalDiterima };

    // 2. Peserta terdaftar & hadir
    const jatahMap = new Map<string, boolean>();
    let totalLunas = 0;
    let hadirLunas = 0;

    for (const a of anggotaRes.results || []) {
      const grupStatus = String(a.grup_status || '');

      if (grupStatus === 'lunas') {
        totalLunas++;
        jatahMap.set(a.id, dapatJatahMakan(a.usia, Boolean(a.makan_dicover)));
        if (dapatJatahMakan(a.usia, Boolean(a.makan_dicover))) {
          hasil.konsumsi.total_berjatah++;
        } else {
          hasil.konsumsi.tanpa_jatah++;
        }
        if (a.status_hadir === 'hadir') {
          hadirLunas++;
        }
      }

      // 'ditolak' & 'draft' bukan peserta terdaftar.
      if (grupStatus === 'ditolak' || grupStatus === 'draft') continue;

      const gender = normalizeGender(a.jenis_kelamin);
      tambahKeBreakdown(hasil.peserta.terdaftar, a.usia, gender);
      if (a.status_hadir === 'hadir') {
        tambahKeBreakdown(hasil.peserta.hadir, a.usia, gender);
      }
    }

    // 3. Scan konsumsi per sesi makan (peserta lunas & berjatah makan)
    const scanPerSesi = new Map<string, Set<string>>();
    for (const row of scanRes.results || []) {
      const set = scanPerSesi.get(row.sesi) || new Set<string>();
      if (jatahMap.get(row.anggota_id)) set.add(row.anggota_id);
      scanPerSesi.set(row.sesi, set);
    }

    for (const sesi of Object.keys(hasil.konsumsi.sesi)) {
      const sudah = scanPerSesi.get(sesi)?.size || 0;
      const total = hasil.konsumsi.total_berjatah;
      hasil.konsumsi.sesi[sesi] = {
        sudah,
        belum: Math.max(total - sudah, 0),
        total,
        persentase: total > 0 ? Math.round((sudah / total) * 100) : 0,
      };
    }

    // 4. Persentase kehadiran
    hasil.persentase_kehadiran.terhadap_semua_terdaftar =
      hasil.peserta.terdaftar.total > 0
        ? Math.round((hasil.peserta.hadir.total / hasil.peserta.terdaftar.total) * 100)
        : 0;
    hasil.persentase_kehadiran.terhadap_lunas =
      totalLunas > 0 ? Math.round((hadirLunas / totalLunas) * 100) : 0;

    return c.json(hasil);
  } catch (err: any) {
    console.error('Error dashboard absensi:', err);
    return c.json(dashboardKosong());
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
