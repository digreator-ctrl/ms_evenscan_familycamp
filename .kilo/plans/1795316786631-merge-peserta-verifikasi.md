# Rencana: Redesign Dashboard Admin — Tab Ringkasan (Pembayaran, Peserta, Kehadiran & Konsumsi)

## Tujuan
Mengganti Dashboard scroll-panjang menjadi **Dashboard bertab 3** yang ringkas, dengan ringkasan lengkap sesuai kebutuhan panitia, tanpa memotong data ke halaman baru yang terpisah.

## Keputusan Desain (disepakati)
- Bentuk: **1 halaman `/` (Dashboard) dengan 3 tab** + strip KPI tipis di atas. Tab disimpan di URL (`/?tab=pembayaran|peserta|kehadiran`) agar bisa refresh/bookmark.
- Urutan tab:
  1. **Pembayaran & Grup**
  2. **Peserta**
  3. **Kehadiran & Konsumsi**
- **Nominal**: tampilkan **Tagihan** (`SUM grand_total`) per status + **Diterima** (`SUM nominal_dibayar`) untuk status lunas (dan selisihnya).
- **Jatah makan**: peserta yang berhak = **sudah membayar (grup `lunas`) DAN berjatah makan**. Balita gratis tanpa cover **dikecualikan** dan ditampilkan terpisah sebagai "tanpa jatah".
- **Persentase kehadiran**: tampilkan **dua basis** — hadir ÷ semua terdaftar, dan hadir ÷ peserta lunas.

## Asumsi (akan dicatat di UI; mudah diubah)
- Sumber "hadir/check-in" = `anggota.status_hadir = 'hadir'` (konsisten dengan halaman Data Individu).
- "Terdaftar" = seluruh anggota pada grup **selain** status `ditolak`.
- Gender DB: `Ikhwan`/`Akhwat` (dinormalisasi ke `ikhwan`/`akhwat`; fallback `L/P`).
- Kategori usia: `balita 0-5`, `anak 6-10`, `remaja 11-17`, `dewasa 18-50`, `lansia 51+`, plus `tidak_diketahui`.

## Backend — Endpoint Baru `GET /api/absensi/dashboard`
Tambahkan di `backend/src/routes/absensi.ts` (sudah di balik `authMiddleware`). Jangan hapus `/stats` & `/stats-grup` (biarkan untuk kompatibilitas).

### Sumber data
- `pendaftaran_grup` (status, grand_total, nominal_dibayar) → agregasi per status via SQL `GROUP BY status`.
- `anggota` JOIN `pendaftaran_grup` (usia, jenis_kelamin, is_gratis, makan_dicover, status_hadir, grup_status).
- `scan_log` (sesi) → hitung distinct `anggota_id` per sesi.

### Bentuk respons
```jsonc
{
  "pembayaran": {
    "menunggu_pembayaran": { "jumlah_grup": 0, "tagihan": 0, "diterima": 0 },
    "menunggu_verifikasi": { "jumlah_grup": 0, "tagihan": 0, "diterima": 0 },
    "lunas":                { "jumlah_grup": 0, "tagihan": 0, "diterima": 0, "kurang": 0, "lebih": 0 },
    "ditolak":              { "jumlah_grup": 0, "tagihan": 0, "diterima": 0 },
    "total":                { "jumlah_grup": 0, "tagihan": 0, "diterima": 0 }
  },
  "peserta": {
    "terdaftar": {
      "total": 0,
      "gender": { "ikhwan": 0, "akhwat": 0, "tidak_diketahui": 0 },
      "per_kategori": {
        "balita": { "total": 0, "ikhwan": 0, "akhwat": 0 },
        "anak":   { "total": 0, "ikhwan": 0, "akhwat": 0 },
        "remaja": { "total": 0, "ikhwan": 0, "akhwat": 0 },
        "dewasa": { "total": 0, "ikhwan": 0, "akhwat": 0 },
        "lansia": { "total": 0, "ikhwan": 0, "akhwat": 0 },
        "tidak_diketahui": { "total": 0, "ikhwan": 0, "akhwat": 0 }
      }
    },
    "hadir": { "total": 0, "gender": { }, "per_kategori": { } }
  },
  "konsumsi": {
    "total_berjatah": 0,
    "tanpa_jatah": 0,
    "sesi": {
      "makan_sabtu_siang": { "sudah": 0, "belum": 0, "total": 0, "persentase": 0 },
      "makan_sabtu_malam": { "sudah": 0, "belum": 0, "total": 0, "persentase": 0 },
      "makan_ahad_pagi":   { "sudah": 0, "belum": 0, "total": 0, "persentase": 0 }
    }
  },
  "persentase_kehadiran": { "terhadap_semua_terdaftar": 0, "terhadap_lunas": 0 },
  "generated_at": "ISO"
}
```

### Logika hitung
- **Pembayaran**: `SELECT status, COUNT(*) grup, SUM(grand_total) tagihan, SUM(nominal_dibayar) diterima FROM pendaftaran_grup GROUP BY status`. `kurang = tagihan - diterima` (jika negatif → `lebih`).
- **Peserta terdaftar**: iterasi semua anggota (grup != 'ditolak'); hitung gender & kategori via `getKategoriUsia`.
- **Hadir**: subset `status_hadir === 'hadir'`; struktur breakdown sama.
- **Konsumsi**:
  - `peserta_lunas = anggota WHERE grup_status='lunas'`.
  - `total_berjatah = count(peserta_lunas WHERE isBerbayar(usia, makan_dicover))` (pakai helper `dapatJatahMakan`).
  - `tanpa_jatah = count(peserta_lunas WHERE !dapatJatahMakan(...))`.
  - per sesi: `sudah = COUNT(DISTINCT anggota_id) scan_log WHERE sesi=?` (anggota lunas & berjatah); `belum = total_berjatah - sudah`; `persentase = round(sudah/total_berjatah*100)`.
- **Persentase kehadiran**:
  - `terhadap_semua_terdaftar = round(hadir.total / peserta.terdaftar.total * 100)`.
  - `terhadap_lunas = round(hadir.total / count(peserta lunas) * 100)`.
- Guard pembagian nol (0 jika denominator 0). Semua nilai default 0 bila DB kosong/gagal (kembalikan struktur kosong, bukan error).

## FE Admin — Rewrite `frontend/admin/src/pages/dashboard.tsx`
- Fetch hanya `GET /api/absensi/dashboard` (dengan `Authorization: Bearer`). Polling ringan (mis. 15 detik) + refresh manual + label "Diperbarui: HH:mm".
- **Strip KPI atas** (selalu tampil): Total Peserta, Total Grup, Hadir (check-in), % Kehadiran (2 angka: vs terdaftar / vs lunas).
- **Tab 1 — Pembayaran & Grup**:
  - Kartu per status: `Menunggu Bayar`, `Menunggu Verifikasi`, `Lunas (Terverifikasi)`.
  - Tiap kartu: jumlah grup, Tagihan, Diterima (khusus lunas: + Kurang/Lebih).
  - Baris ringkas `Ditolak` (terpisah, abu-abu) dan `Total`.
- **Tab 2 — Peserta**:
  - Blok `Terdaftar`: kartu total + Ikhwan + Akhwat; tabel matriks `Kategori × (Ikhwan, Akhwat, Total)`.
  - Blok `Hadir (Check-in)`: struktur sama.
- **Tab 3 — Kehadiran & Konsumsi**:
  - Ringkasan check-in + dua persentase kehadiran (progress bar).
  - Info `Total berjatah makan` dan `Tanpa jatah (balita gratis)`.
  - Tiga kartu sesi makan (Sabtu Siang, Sabtu Malam, Ahad Pagi): `Sudah / Belum / Total` + progress bar %.
- Utilitas di file: `formatRupiah`, `StatCard`, `MatrixRow`, `ProgressBar`.
- Tab state disinkronkan ke `useSearchParams` (`tab`); default `pembayaran`.
- Hapus sisa section lama yang tak dipakai (sudah tak ada). Pertahankan styling sesuai tema (`#06305d`).

## Saran Tambahan (opsional, disertakan bila mudah)
- Tampilkan `Kurang/Lebih bayar` pada kartu Lunas (karena kita menampilkan Tagihan + Diterima).
- Tampilkan `Ditolak` terpisah agar tidak mengacaukan 3 status utama.
- Label jelas "persentase konsumsi dihitung dari peserta lunas & berjatah makan".
- (Nanti) filter per hari/sesi bila acara multi-hari — di luar scope sekarang.

## Validasi
- `tsc` backend & admin bersih; `wrangler deploy --dry-run` sukses; `npm run build` admin sukses.
- Uji hitung silang dengan halaman **Data Individu**: total terdaftar, hitungan ikhwan/akhwat, dan jumlah hadir harus sama.
- Uji edge case: DB kosong (semua 0, tanpa error), grup ditolak (tidak masuk "terdaftar"), balita gratis tanpa cover (masuk `tanpa_jatah`, bukan `belum makan`), pembayaran kurang/lebih.
- Uji navigasi tab via URL (refresh tetap di tab yang sama).

## File yang Disentuh
- `backend/src/routes/absensi.ts` (endpoint baru `/dashboard`; tanpa mengubah `/stats`, `/stats-grup`).
- `frontend/admin/src/pages/dashboard.tsx` (rewrite bertab; hanya konsumsi endpoint baru).

## Catatan
- Tidak ada perubahan skema DB/migrasi.
- Endpoint lama tetap ada; pembersihan bisa dilakukan terpisah setelah Dashboard baru stabil.
