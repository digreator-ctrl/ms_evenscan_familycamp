-- ============================================================
-- MS EvenScan Family Camp — Schema Lengkap
-- ============================================================

-- Tabel pendaftar (LEGACY — backward compatibility)
CREATE TABLE IF NOT EXISTS pendaftar (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    email TEXT,
    no_whatsapp TEXT NOT NULL,
    instansi TEXT,
    jenis_kelamin TEXT,
    nip TEXT,
    domisili TEXT,
    alasan TEXT,
    screenshot_url TEXT,
    qr_code_url TEXT,
    qr_token TEXT UNIQUE,
    status TEXT DEFAULT 'menunggu' CHECK(status IN ('menunggu', 'dikonfirmasi', 'ditolak', 'hadir')),
    alasan_tolak TEXT,
    wa_terkirim INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME,
    attended_at DATETIME,
    confirmed_by TEXT,
    wa_sent_by TEXT
);

-- Tabel admin users
CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nama TEXT NOT NULL,
    role TEXT DEFAULT 'panitia',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabel konfigurasi aplikasi & sistem
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABEL BARU: Family Camp
-- ============================================================

-- 1. Pendaftaran Grup (Transaksi utama per keluarga/kelompok)
CREATE TABLE IF NOT EXISTS pendaftaran_grup (
    id TEXT PRIMARY KEY,
    tipe TEXT NOT NULL CHECK(tipe IN ('keluarga', 'non_keluarga')),
    pic_nama TEXT NOT NULL,
    pic_whatsapp TEXT NOT NULL,
    pic_email TEXT,
    provinsi TEXT,
    kota TEXT,
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

-- 2. Anggota (Data individu setiap peserta dalam grup)
CREATE TABLE IF NOT EXISTS anggota (
    id TEXT PRIMARY KEY,
    grup_id TEXT NOT NULL,
    nama TEXT NOT NULL,
    jenis_kelamin TEXT NOT NULL CHECK(jenis_kelamin IN ('Ikhwan', 'Akhwat')),
    peran TEXT NOT NULL DEFAULT 'Peserta' CHECK(peran IN ('Ayah', 'Ibu', 'Anak', 'Kakek', 'Nenek', 'Paman', 'Bibi', 'Saudara Kandung', 'Sepupu', 'Peserta')),
    usia INTEGER,
    ukuran_kaos TEXT,
    catatan_medis TEXT,
    provinsi TEXT,
    kota TEXT,
    is_gratis INTEGER NOT NULL DEFAULT 0,
    qr_token TEXT UNIQUE,
    qr_code_url TEXT,
    status_hadir TEXT NOT NULL DEFAULT 'belum' CHECK(status_hadir IN ('belum', 'hadir')),
    attended_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (grup_id) REFERENCES pendaftaran_grup(id) ON DELETE CASCADE
);

-- 3. Add-on Items (Katalog barang/jasa tambahan, dikelola Admin)
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

-- 4. Pendaftaran Add-ons (Item yang dipilih per grup)
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
-- INDEKS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pendaftar_status ON pendaftar(status);
CREATE INDEX IF NOT EXISTS idx_pendaftar_wa ON pendaftar(no_whatsapp);
CREATE INDEX IF NOT EXISTS idx_pendaftar_qr_token ON pendaftar(qr_token);
CREATE INDEX IF NOT EXISTS idx_grup_status ON pendaftaran_grup(status);
CREATE INDEX IF NOT EXISTS idx_grup_pic_wa ON pendaftaran_grup(pic_whatsapp);
CREATE INDEX IF NOT EXISTS idx_grup_payment_token ON pendaftaran_grup(payment_token);
CREATE INDEX IF NOT EXISTS idx_anggota_grup_id ON anggota(grup_id);
CREATE INDEX IF NOT EXISTS idx_anggota_qr_token ON anggota(qr_token);
CREATE INDEX IF NOT EXISTS idx_addon_items_aktif ON addon_items(aktif);
CREATE INDEX IF NOT EXISTS idx_pendaftaran_addons_grup ON pendaftaran_addons(grup_id);
