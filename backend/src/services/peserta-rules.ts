/**
 * Aturan bisnis peserta Family Camp.
 *
 * Kategori usia (untuk statistik & laporan):
 *   Balita (1-5 th), Anak-Anak (6-10 th), Remaja (11-17 th), Dewasa (18-50 th), Lansia (51+ th)
 *
 * Biaya paket wajib:
 *   - Usia 1-5 tahun (0-5 th): GRATIS, tanpa fasilitas dan tanpa jatah makan.
 *   - Usia 6-10 tahun: Berbayar Rp 100.000, tetap mendapatkan fasilitas sebagaimana peserta pada umumnya.
 *   - Usia 11 tahun ke atas (Dewasa): Berbayar penuh Rp 200.000 dengan fasilitas lengkap.
 */

export const BIAYA_PER_ORANG_DEFAULT = 200000;
export const BIAYA_ANAK_DEFAULT = 100000;

export const KATEGORI_USIA = [
  { id: 'balita', label: 'Balita (1-5 th)', min: 0, max: 5 },
  { id: 'anak', label: 'Anak-Anak (6-10 th)', min: 6, max: 10 },
  { id: 'remaja', label: 'Remaja (11-17 th)', min: 11, max: 17 },
  { id: 'dewasa', label: 'Dewasa (18-50 th)', min: 18, max: 50 },
  { id: 'lansia', label: 'Lansia (51+ th)', min: 51, max: 200 },
] as const;

export type KategoriUsiaId = (typeof KATEGORI_USIA)[number]['id'];

export function getKategoriUsia(usia: number | null | undefined): KategoriUsiaId | 'tidak_diketahui' {
  if (usia === null || usia === undefined || isNaN(Number(usia))) return 'tidak_diketahui';
  const n = Number(usia);
  for (const k of KATEGORI_USIA) {
    if (n >= k.min && n <= k.max) return k.id;
  }
  return 'tidak_diketahui';
}

export function getKategoriUsiaLabel(usia: number | null | undefined): string {
  const id = getKategoriUsia(usia);
  const found = KATEGORI_USIA.find((k) => k.id === id);
  return found ? found.label : 'Tidak diketahui';
}

/**
 * Apakah anggota dihitung berbayar (menambah biaya paket wajib & mendapat fasilitas)?
 * - Usia <= 5 tahun gratis tanpa fasilitas.
 * - Usia >= 6 tahun berbayar (6-10 th: Rp 100rb, 11+ th: Rp 200rb) dan mendapat fasilitas.
 */
export function isBerbayar(usia: number | null | undefined, makanDicover?: boolean | number): boolean {
  const n = usia === null || usia === undefined || isNaN(Number(usia)) ? null : Number(usia);
  if (n === null) return true;
  if (n >= 6) return true;
  return Boolean(makanDicover);
}

/**
 * Apakah anggota mendapat jatah makan panitia (3x) & fasilitas.
 * Setara dengan status berbayar: anak 1-5 tahun gratis tanpa fasilitas.
 */
export function dapatJatahMakan(usia: number | null | undefined, makanDicover?: boolean | number): boolean {
  return isBerbayar(usia, makanDicover);
}

/**
 * Hitung biaya paket wajib dan ringkasan kategori peserta.
 * - Usia 11+ / Dewasa: hargaPerOrang (Rp 200.000)
 * - Usia 6-10 th / Anak: hargaAnak (Rp 100.000)
 * - Usia 1-5 th / Balita: Rp 0 (Gratis tanpa fasilitas)
 */
export function hitungBiayaWajib(
  anggota: { usia: number | null | undefined; makan_dicover?: boolean | number }[],
  hargaPerOrang: number = BIAYA_PER_ORANG_DEFAULT,
  hargaAnak: number = BIAYA_ANAK_DEFAULT
) {
  let jumlahBerbayarDewasa = 0;
  let jumlahBerbayarAnak = 0;
  let jumlahGratis = 0;
  let jumlahMakanDicover = 0;
  let totalBiayaWajib = 0;

  for (const a of anggota) {
    const n = a.usia === null || a.usia === undefined || isNaN(Number(a.usia)) ? null : Number(a.usia);
    if (n === null || n >= 11) {
      jumlahBerbayarDewasa++;
      totalBiayaWajib += hargaPerOrang;
    } else if (n >= 6 && n <= 10) {
      jumlahBerbayarAnak++;
      totalBiayaWajib += hargaAnak;
    } else {
      // Usia <= 5 tahun
      if (a.makan_dicover) {
        jumlahMakanDicover++;
        totalBiayaWajib += hargaAnak;
      } else {
        jumlahGratis++;
      }
    }
  }

  return {
    harga_per_orang: hargaPerOrang,
    harga_anak: hargaAnak,
    jumlah_berbayar_dewasa: jumlahBerbayarDewasa,
    jumlah_berbayar_anak: jumlahBerbayarAnak,
    jumlah_berbayar: jumlahBerbayarDewasa + jumlahBerbayarAnak + jumlahMakanDicover,
    jumlah_gratis: jumlahGratis,
    jumlah_makan_dicover: jumlahMakanDicover,
    biaya_wajib: totalBiayaWajib,
  };
}

/**
 * Membuat nomor peserta: K-001-01 (keluarga) atau N-001-01 (non-keluarga).
 */
export function formatNomorPeserta(tipe: string, urutGrup: number, urutAnggota: number): string {
  const prefix = tipe === 'keluarga' ? 'K' : 'N';
  const grup = String(urutGrup).padStart(3, '0');
  const anggota = String(urutAnggota).padStart(2, '0');
  return `${prefix}-${grup}-${anggota}`;
}

/**
 * Ambil nomor urut grup berikutnya secara atomik (harus dipanggil di dalam DB).
 * Menggunakan tabel peserta_counter per prefix (K/N).
 */
export async function ambilNomorUrutGrup(db: D1Database, tipe: string): Promise<number> {
  const prefix = tipe === 'keluarga' ? 'K' : 'N';

  await db
    .prepare(
      `INSERT INTO peserta_counter (prefix, urut_terakhir) VALUES (?, 0) ON CONFLICT(prefix) DO NOTHING`
    )
    .bind(prefix)
    .run();

  await db
    .prepare(`UPDATE peserta_counter SET urut_terakhir = urut_terakhir + 1 WHERE prefix = ?`)
    .bind(prefix)
    .run();

  const row = await db
    .prepare(`SELECT urut_terakhir FROM peserta_counter WHERE prefix = ?`)
    .bind(prefix)
    .first<{ urut_terakhir: number }>();

  return row?.urut_terakhir || 1;
}

export const SESI_MAKAN = [
  { id: 'checkin', label: 'Check-in Kehadiran' },
  { id: 'makan_sabtu_siang', label: 'Makan Sabtu Siang' },
  { id: 'makan_sabtu_malam', label: 'Makan Sabtu Malam' },
  { id: 'makan_ahad_pagi', label: 'Makan Ahad Pagi' },
] as const;

export type SesiScanId = (typeof SESI_MAKAN)[number]['id'];

export function isSesiScanValid(sesi: string): sesi is SesiScanId {
  return SESI_MAKAN.some((s) => s.id === sesi);
}

export function getSesiLabel(sesi: string): string {
  return SESI_MAKAN.find((s) => s.id === sesi)?.label || sesi;
}
