/**
 * Aturan bisnis peserta Family Camp.
 *
 * Kategori usia (untuk statistik & laporan):
 *   Balita  0-5, Anak-Anak 6-10, Remaja 11-17, Dewasa 18-50, Lansia 51+
 *
 * Biaya paket wajib:
 *   - Usia < 3 tahun (0, 1, 2) GRATIS, tanpa fasilitas, jatah makan dicover orang tua.
 *   - Anggota usia < 3 boleh di-"cover panitia" (makan_dicover = 1):
 *     menjadi berbayar penuh Rp 200.000 dan mendapat fasilitas lengkap.
 *   - Usia >= 3 tahun berbayar penuh Rp 200.000 (termasuk balita 3-5 tahun).
 */

export const BIAYA_PER_ORANG_DEFAULT = 200000;

export const KATEGORI_USIA = [
  { id: 'balita', label: 'Balita (0-5 th)', min: 0, max: 5 },
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
 * Apakah anggota dihitung berbayar (menambah biaya paket wajib)?
 * Usia < 3 hanya berbayar jika dicover panitia.
 */
export function isBerbayar(usia: number | null | undefined, makanDicover?: boolean | number): boolean {
  const n = usia === null || usia === undefined || isNaN(Number(usia)) ? null : Number(usia);
  if (n === null) return true;
  if (n >= 3) return true;
  return Boolean(makanDicover);
}

/**
 * Apakah anggota mendapat jatah makan panitia (3x).
 * Setara dengan status berbayar: gratis tanpa cover = makan dicover orang tua.
 */
export function dapatJatahMakan(usia: number | null | undefined, makanDicover?: boolean | number): boolean {
  return isBerbayar(usia, makanDicover);
}

/**
 * Hitung biaya paket wajib dan ringkasan kategori peserta.
 */
export function hitungBiayaWajib(
  anggota: { usia: number | null | undefined; makan_dicover?: boolean | number }[],
  hargaPerOrang: number = BIAYA_PER_ORANG_DEFAULT
) {
  let jumlahBerbayar = 0;
  let jumlahGratis = 0;
  let jumlahMakanDicover = 0;

  for (const a of anggota) {
    if (isBerbayar(a.usia, a.makan_dicover)) {
      jumlahBerbayar++;
    } else {
      jumlahGratis++;
      if (a.makan_dicover) jumlahMakanDicover++;
    }
  }

  return {
    harga_per_orang: hargaPerOrang,
    jumlah_berbayar: jumlahBerbayar,
    jumlah_gratis: jumlahGratis,
    jumlah_makan_dicover: jumlahMakanDicover,
    biaya_wajib: jumlahBerbayar * hargaPerOrang,
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
