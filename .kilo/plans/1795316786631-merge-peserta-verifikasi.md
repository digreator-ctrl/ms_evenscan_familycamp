# Rencana: Gabungkan Menu "Peserta" (Verifikasi + Data Individu) & Perbaiki Sinkronisasi Data Localhost

## Tujuan
1. Menyatukan halaman **Data Peserta** dan **Verifikasi** menjadi **satu menu "Peserta"** dengan dua tab.
2. Memastikan data pendaftaran dari FE Peserta di localhost muncul di FE Admin localhost.

## Keputusan Desain
- Bentuk gabungan: **satu route `/peserta`, dua tab**: `Verifikasi Grup` dan `Data Individu`.
- Logika tabel/aksi **tidak dicampur** — komponen `Verifikasi` dan `RiwayatScan` dipakai ulang sebagai isi tab.
- Detail grup tetap memakai `?id=` (perilaku Verifikasi saat ini).
- Detail individu dipindah dari `/riwayat-scan/:id` ke `/peserta/anggota/:id`.
- Role tetap: aksi verifikasi (konfirmasi/tolak/hapus/WA) untuk panitia & superadmin; tab Data Individu read-only.

## Task List

### A. FE Admin — Gabungkan Halaman
1. **`frontend/admin/src/pages/peserta.tsx` (baru)**
   - State `activeTab: 'verifikasi' | 'individu'`, inisialisasi awal dari query `?tab=`.
   - Render tab bar 2 tombol + kondisional `<Verifikasi />` / `<RiwayatScan />`.
   - Pastikan tab tidak ter-reset ketika Verifikasi memanggil `setSearchParams({ id })` (mis. simpan tab di local state, bukan bergantung pada URL setelah mount; atau ubah Verifikasi agar menyertakan `tab` saat setSearchParams).
2. **`frontend/admin/src/App.tsx`**
   - Tambah `<Route path="/peserta" element={<Peserta />} />`.
   - Tambah `<Route path="/peserta/anggota/:id" element={<RiwayatDetail />} />`.
   - Ubah `/verifikasi` → redirect ke `/peserta` (opsional `?tab=verifikasi`).
   - Ubah `/riwayat-scan` → redirect ke `/peserta?tab=individu`.
   - Ubah `/riwayat-scan/:id` → redirect ke `/peserta/anggota/:id`.
3. **`frontend/admin/src/pages/riwayat-scan.tsx`**
   - Ganti navigasi detail dari `/riwayat-scan/${id}` → `/peserta/anggota/${id}`.
4. **`frontend/admin/src/pages/riwayat-detail.tsx`**
   - Tombol/link "Kembali" → `/peserta?tab=individu`.
5. **`frontend/admin/src/components/Layout.tsx`**
   - Desktop: hapus item "Data Peserta" dan "Verification"; tambah satu item **"Peserta"** → `/peserta`.
   - Mobile dock: slot ke-2 menjadi **"Peserta"** → `/peserta`; slot ke-4 (bekas Verification) diisi **"Keuangan"** bila role `superadmin`/`bendahara`, jika tidak gunakan spacer kosong agar simetri 5 slot terjaga.
   - Penanda aktif harus mengenali `/peserta` dan `/peserta/anggota/*` (mis. `location.pathname.startsWith('/peserta')`).

### B. Localhost — Cara Menjalankan yang Benar & Sinkronisasi Data
1. **Cara yang disarankan (satu terminal di root proyek):**
   - `pnpm install`
   - `pnpm dev` (menjalankan sekaligus: backend `wrangler dev` di `:8787` + peserta `astro dev` di `:3001` + admin `vite` di `:3002`).
2. **Alternatif (tiga terminal terpisah):**
   - `pnpm dev:backend` (port 8787), `pnpm dev:peserta` (3001), `pnpm dev:admin` (3002).
3. **Yang salah / perlu dihindari:**
   - Menjalankan `pnpm dev` **di dalam satu folder paket** lalu berharap ketiganya jalan — hanya paket itu yang jalan.
   - Menjalankan backend dengan `--remote` atau backend hasil deploy sementara FE lokal → data masuk ke **D1 remote**, bukan D1 lokal, sehingga admin lokal kosong.
   - Membuka FE peserta lewat `preview`/build produksi (`.env.production` → worker remote) sementara admin dev (localhost) → beda database.
4. **Sumber kebenaran DB lokal:** `wrangler dev` memakai D1 lokal di `backend/.wrangler/state`. Semua yang menulis via `http://localhost:8787` masuk ke DB yang sama yang dibaca admin lokal.
5. **Hardening env (opsional tapi disarankan):**
   - Buat `frontend/peserta/.env.development` → `PUBLIC_API_URL=http://localhost:8787`.
   - Buat `frontend/admin/.env.development` → `VITE_API_URL=http://localhost:8787`.
   - (Saat ini sudah ada fallback ke `localhost:8787`, jadi ini hanya memperjelas dan mencegah salah konfigurasi.)
6. **Restart backend** agar memuat perbaikan terbaru `/api/absensi/stats` (kini mengirim `total`, `menunggu`, `dikonfirmasi`, `ditolak`, `hadir` + breakdown) sehingga angka Dashboard tidak lagi 0.

### C. Verifikasi & Validasi
- `tsc` backend & FE Admin bersih; `pnpm build:peserta` dan `pnpm build:admin` sukses; `wrangler deploy --dry-run` sukses.
- Cek D1 lokal: `cd backend` lalu `npx wrangler d1 execute evenscan-db --local --command "SELECT COUNT(*) FROM pendaftaran_grup"`.
- Uji manual:
  1. Daftar grup di `http://localhost:3001/daftar`.
  2. Buka admin `http://localhost:3002` → menu **Peserta** → tab **Verifikasi Grup**: grup baru muncul.
  3. Konfirmasi Lunas → pindah ke tab **Data Individu**: anggota muncul dengan nomor peserta & status sesi.
  4. Dashboard menampilkan total peserta > 0.

## Risiko & Catatan
- `Verifikasi` memakai `useSearchParams` untuk `id`; jaga agar `tab` tidak hilang/ter-reset (lihat A.1).
- Pastikan hanya ada **satu** proses `wrangler dev` di port 8787.
- `README.md` masih menyebut akun default `admin/admin123` (sudah dihapus pada Tahap 1) dan alur lama — perlu diperbarui terpisah di luar rencana ini.
- File `.env.development` tidak memengaruhi build produksi (yang tetap memakai `.env.production`).

## Pertanyaan Terbuka / Default
- Slot ke-4 mobile dock: default **spacer** untuk role non-finance (jaga simetri). Bila diinginkan, bisa diisi pintasan lain.

## File yang Disentuh
- Baru: `frontend/admin/src/pages/peserta.tsx`
- Ubah: `frontend/admin/src/App.tsx`, `frontend/admin/src/components/Layout.tsx`, `frontend/admin/src/pages/riwayat-scan.tsx`, `frontend/admin/src/pages/riwayat-detail.tsx`
- Opsional (env dev): `frontend/peserta/.env.development`, `frontend/admin/.env.development`
