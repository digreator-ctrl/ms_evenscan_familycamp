# 🏕️ Master Plan: Revisi Pendaftaran Family Camp

> Transformasi form pendaftaran MS EvenScan dari pendaftaran individu menjadi sistem pendaftaran **Family Camp** multi-anggota dengan paket wajib, add-on opsional, dan konfirmasi pembayaran mandiri.

---

## 📊 Status Pengerjaan

| Tahap | Deskripsi | Status |
|-------|-----------|--------|
| **Tahap 1** | Penyesuaian Skema Database (D1) | ✅ Selesai |
| **Tahap 2** | Backend API Routes Baru | ✅ Selesai |
| **Tahap 3** | Redesain Frontend Peserta (`/daftar`) Multi-Step | ✅ Selesai |
| **Tahap 4** | Halaman Konfirmasi Pembayaran (`/pembayaran`) | ✅ Selesai |
| **Tahap 5** | Penyesuaian Dashboard Admin | ✅ Selesai |

---

## Tahap 1: Skema Database Baru

### Tabel Baru

#### `pendaftaran_grup` — Transaksi utama per grup/keluarga
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| `id` | TEXT PK | Contoh: `GRP_xxxx` |
| `tipe` | TEXT | `keluarga` / `non_keluarga` |
| `pic_nama` | TEXT | Nama penanggung jawab |
| `pic_whatsapp` | TEXT | No WA PIC (untuk link pembayaran) |
| `pic_email` | TEXT | Email opsional |
| `jumlah_anggota` | INTEGER | Total anggota terdaftar |
| `biaya_wajib` | INTEGER | 200000 × jumlah (usia ≥ 3 tahun) |
| `biaya_addon` | INTEGER | Total biaya add-on |
| `kode_unik` | INTEGER | 3 digit random (untuk identifikasi transfer) |
| `grand_total` | INTEGER | biaya_wajib + biaya_addon + kode_unik |
| `bukti_url` | TEXT | URL screenshot bukti transfer |
| `payment_token` | TEXT UNIQUE | Token akses halaman pembayaran |
| `status` | TEXT | `draft`, `menunggu_pembayaran`, `menunggu_verifikasi`, `lunas`, `ditolak` |
| `alasan_tolak` | TEXT | Alasan jika ditolak |
| `created_at` | DATETIME | Auto |
| `paid_at` | DATETIME | Waktu upload bukti |
| `confirmed_at` | DATETIME | Waktu dikonfirmasi admin |
| `confirmed_by` | TEXT | Admin yang konfirmasi |

#### `anggota` — Data individu setiap peserta
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| `id` | TEXT PK | Contoh: `MBR_xxxx` |
| `grup_id` | TEXT FK | → pendaftaran_grup.id |
| `nama` | TEXT | Nama lengkap |
| `jenis_kelamin` | TEXT | `Ikhwan` / `Akhwat` |
| `peran` | TEXT | `Ayah`, `Ibu`, `Anak`, `Peserta` |
| `usia` | INTEGER | Usia (tahun) |
| `ukuran_kaos` | TEXT | S/M/L/XL/XXL (opsional) |
| `catatan_medis` | TEXT | Alergi / kondisi khusus (opsional) |
| `is_gratis` | INTEGER | 1 jika usia < 3 tahun (gratis) |
| `qr_token` | TEXT UNIQUE | QR unik per anggota |
| `qr_code_url` | TEXT | URL QR code |
| `status_hadir` | TEXT | `belum` / `hadir` |
| `attended_at` | DATETIME | Waktu scan kehadiran |
| `created_at` | DATETIME | Auto |

#### `addon_items` — Daftar barang add-on (dikelola Admin)
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| `id` | TEXT PK | Contoh: `ADDON_xxxx` |
| `nama` | TEXT | "Sewa Tenda Dome 4 Orang" |
| `deskripsi` | TEXT | Keterangan item |
| `harga` | INTEGER | Harga per unit (Rp) |
| `stok` | INTEGER | -1 = unlimited |
| `aktif` | INTEGER | 1 = tampil di form |
| `urutan` | INTEGER | Sorting order |
| `created_at` | DATETIME | Auto |

#### `pendaftaran_addons` — Item add-on yang dipilih per grup
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| `id` | TEXT PK | Auto |
| `grup_id` | TEXT FK | → pendaftaran_grup.id |
| `addon_id` | TEXT FK | → addon_items.id |
| `nama_item` | TEXT | Nama saat dipesan (snapshot) |
| `qty` | INTEGER | Jumlah unit |
| `harga_satuan` | INTEGER | Harga per unit saat dipesan (snapshot) |
| `subtotal` | INTEGER | qty × harga_satuan |

### Kebijakan Usia
- Usia **≥ 3 tahun**: dikenakan biaya wajib Rp 200.000
- Usia **< 3 tahun** (balita): **GRATIS** (otomatis `is_gratis = 1`)

### Kode Unik Transfer
- 3 digit acak (001–999) ditambahkan ke grand total
- Contoh: Total Rp 600.000 → Transfer Rp 600.287
- Tujuan: Mempermudah pencocokan mutasi rekening

---

## Tahap 2: Backend API Routes

### Routes Baru (Peserta)
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| `POST` | `/api/peserta/daftar-grup` | Submit pendaftaran grup + anggota |
| `GET` | `/api/peserta/addon-items` | Ambil daftar add-on aktif |
| `POST` | `/api/peserta/checkout` | Hitung total + pilih addon → dapat payment_token |
| `GET` | `/api/peserta/pembayaran/:token` | Ambil detail invoice via token |
| `POST` | `/api/peserta/pembayaran/:token/upload` | Upload bukti transfer |
| `GET` | `/api/peserta/status-grup` | Cek status grup via WA |

### Routes Baru (Admin)
| Method | Endpoint | Keterangan |
|--------|----------|------------|
| `GET` | `/api/admin/grup` | List semua grup pendaftar |
| `GET` | `/api/admin/grup/:id` | Detail 1 grup + anggota + addon |
| `PATCH` | `/api/admin/grup/:id/konfirmasi` | Approve + generate QR semua anggota |
| `PATCH` | `/api/admin/grup/:id/tolak` | Tolak pendaftaran grup |
| `GET` | `/api/admin/addon-items` | CRUD list add-on items |
| `POST` | `/api/admin/addon-items` | Tambah item add-on baru |
| `PATCH` | `/api/admin/addon-items/:id` | Edit item add-on |
| `DELETE` | `/api/admin/addon-items/:id` | Hapus item add-on |

---

## Tahap 3: Frontend Peserta — Multi-Step Form (`/daftar`)

### Step 1: Pilih Tipe Pendaftaran
- 2 kartu: **"Keluarga"** vs **"Non-Keluarga (Perorangan/Kelompok)"**

### Step 2: Biodata Anggota (Dinamis)
- Anggota pertama = PIC (wajib isi No. WhatsApp & Email)
- Tombol **"+ Tambah Anggota"**
- Jika tipe Keluarga → dropdown Peran (Ayah/Ibu/Anak)
- Jika tipe Non-Keluarga → semua berperan "Peserta"
- Field per anggota: Nama, Jenis Kelamin, Usia, Ukuran Kaos, Catatan Medis

### Step 3: Paket & Add-on
- Kalkulasi otomatis: `Rp 200.000 × anggota_berbayar`
- Info: anggota balita (< 3 tahun) GRATIS
- Daftar add-on dinamis (dari database) dengan kontrol qty (+/-)
- Running total real-time

### Step 4: Ringkasan & Konfirmasi
- Rekap: daftar anggota, paket, add-on, kode unik, grand total
- Tombol "Daftar & Lanjut ke Pembayaran"
- Redirect → `/pembayaran?token=XXXX`

---

## Tahap 4: Halaman Pembayaran (`/pembayaran`)

- Diakses via link unik: `/pembayaran?token=XXXX`
- Menampilkan invoice: rincian anggota, add-on, kode unik, grand total
- Info rekening bank / QRIS panitia + tombol "Salin Nomor Rekening"
- Form upload bukti transfer (kompresi client-side)
- Tombol **"Simpan Link ke WhatsApp Saya"** (buka wa.me ke nomor sendiri berisi link)
- Bisa diakses ulang kapan saja via `/status` dengan masukkan No. WA

---

## Tahap 5: Penyesuaian Dashboard Admin

- Halaman verifikasi menampilkan data **per grup** (bukan per individu)
- Detail grup: semua anggota + peran + item add-on
- Tombol konfirmasi: approve → generate QR untuk **semua anggota** sekaligus
- Halaman baru: **Kelola Add-on** (CRUD item sewa/tambahan + harga + stok)
- Statistik dashboard: total grup, total anggota, total revenue

---

> [!IMPORTANT]
> Tabel lama `pendaftar` **TETAP DIPERTAHANKAN** (tidak dihapus) untuk backward compatibility.
> Tabel-tabel baru ditambahkan di samping tabel lama.
