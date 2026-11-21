-- ============================================================
-- MIGRASI: Tabel-tabel Family Camp
-- Tanggal: 2026-11-21
-- Deskripsi: Menambahkan tabel pendaftaran grup, anggota,
--            addon items, dan pendaftaran addons
-- ============================================================

-- 1. Tabel Pendaftaran Grup (Transaksi utama per keluarga/kelompok)
CREATE TABLE IF NOT EXISTS pendaftaran_grup (
    id TEXT PRIMARY KEY,
    tipe TEXT NOT NULL CHECK(tipe IN ('keluarga', 'non_keluarga')),
    pic_nama TEXT NOT NULL,
    pic_whatsapp TEXT NOT NULL,
    pic_email TEXT,
    jumlah_anggota INTEGER NOT NULL DEFAULT 1,
    biaya_wajib INTEGER NOT NULL DEFAULT 0,
    biaya_addon INTEGER NOT NULL DEFAULT 0,
    kode_unik INTEGER NOT NULL DEFAULT 0,
    grand_total INTEGER NOT NULL DEFAULT 0,
    bukti_url TEXT,
    payment_token TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'menunggu_pembayaran', 'menunggu_verifikasi', 'lunas', 'ditolak')),
    alasan_tolak TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    confirmed_at DATETIME,
    confirmed_by TEXT
);

-- 2. Tabel Anggota (Data individu setiap peserta dalam grup)
CREATE TABLE IF NOT EXISTS anggota (
    id TEXT PRIMARY KEY,
    grup_id TEXT NOT NULL,
    nama TEXT NOT NULL,
    jenis_kelamin TEXT NOT NULL CHECK(jenis_kelamin IN ('Ikhwan', 'Akhwat')),
    peran TEXT NOT NULL DEFAULT 'Peserta' CHECK(peran IN ('Ayah', 'Ibu', 'Anak', 'Peserta')),
    usia INTEGER,
    ukuran_kaos TEXT,
    catatan_medis TEXT,
    is_gratis INTEGER NOT NULL DEFAULT 0,
    qr_token TEXT UNIQUE,
    qr_code_url TEXT,
    status_hadir TEXT NOT NULL DEFAULT 'belum' CHECK(status_hadir IN ('belum', 'hadir')),
    attended_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (grup_id) REFERENCES pendaftaran_grup(id) ON DELETE CASCADE
);

-- 3. Tabel Add-on Items (Katalog barang/jasa tambahan, dikelola Admin)
CREATE TABLE IF NOT EXISTS addon_items (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    deskripsi TEXT,
    harga INTEGER NOT NULL DEFAULT 0,
    stok INTEGER NOT NULL DEFAULT -1,
    aktif INTEGER NOT NULL DEFAULT 1,
    urutan INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabel Pendaftaran Add-ons (Item yang dipilih per grup)
CREATE TABLE IF NOT EXISTS pendaftaran_addons (
    id TEXT PRIMARY KEY,
    grup_id TEXT NOT NULL,
    addon_id TEXT NOT NULL,
    nama_item TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    harga_satuan INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (grup_id) REFERENCES pendaftaran_grup(id) ON DELETE CASCADE,
    FOREIGN KEY (addon_id) REFERENCES addon_items(id)
);

-- ============================================================
-- INDEKS untuk performa query
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_grup_status ON pendaftaran_grup(status);
CREATE INDEX IF NOT EXISTS idx_grup_pic_wa ON pendaftaran_grup(pic_whatsapp);
CREATE INDEX IF NOT EXISTS idx_grup_payment_token ON pendaftaran_grup(payment_token);
CREATE INDEX IF NOT EXISTS idx_anggota_grup_id ON anggota(grup_id);
CREATE INDEX IF NOT EXISTS idx_anggota_qr_token ON anggota(qr_token);
CREATE INDEX IF NOT EXISTS idx_addon_items_aktif ON addon_items(aktif);
CREATE INDEX IF NOT EXISTS idx_pendaftaran_addons_grup ON pendaftaran_addons(grup_id);
