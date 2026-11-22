/**
 * Database Initializer — Auto-create tabel Family Camp
 * Dipanggil satu kali saat server pertama kali menerima request.
 * Menggunakan CREATE TABLE IF NOT EXISTS sehingga aman dipanggil berulang.
 */

let initialized = false;

export async function ensureFamilyCampTables(db: D1Database): Promise<void> {
  if (initialized || !db) return;

  try {
    await db.batch([
      // 1. Tabel Pendaftaran Grup
      db.prepare(`
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
        )
      `),
      // 2. Tabel Anggota
      db.prepare(`
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
        )
      `),
      // 3. Tabel Add-on Items (Katalog)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS addon_items (
          id TEXT PRIMARY KEY,
          nama TEXT NOT NULL,
          deskripsi TEXT,
          harga INTEGER NOT NULL DEFAULT 0,
          stok INTEGER NOT NULL DEFAULT -1,
          aktif INTEGER NOT NULL DEFAULT 1,
          urutan INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 4. Tabel Pendaftaran Add-ons
      db.prepare(`
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
        )
      `),
      // 5. Tabel lama (backward compat)
      db.prepare(`
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
        )
      `),
      db.prepare(`CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        nama TEXT NOT NULL,
        role TEXT DEFAULT 'panitia',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`),
    ]);

    // Create indexes (batch doesn't support multiple statements per prepare)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_grup_status ON pendaftaran_grup(status)`,
      `CREATE INDEX IF NOT EXISTS idx_grup_pic_wa ON pendaftaran_grup(pic_whatsapp)`,
      `CREATE INDEX IF NOT EXISTS idx_grup_payment_token ON pendaftaran_grup(payment_token)`,
      `CREATE INDEX IF NOT EXISTS idx_anggota_grup_id ON anggota(grup_id)`,
      `CREATE INDEX IF NOT EXISTS idx_anggota_qr_token ON anggota(qr_token)`,
      `CREATE INDEX IF NOT EXISTS idx_addon_items_aktif ON addon_items(aktif)`,
      `CREATE INDEX IF NOT EXISTS idx_pendaftaran_addons_grup ON pendaftaran_addons(grup_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pendaftar_status ON pendaftar(status)`,
      `CREATE INDEX IF NOT EXISTS idx_pendaftar_wa ON pendaftar(no_whatsapp)`,
      `CREATE INDEX IF NOT EXISTS idx_pendaftar_qr_token ON pendaftar(qr_token)`,
    ];

    await db.batch(indexes.map((sql) => db.prepare(sql)));

    // Migration: pastikan kolom provinsi dan kota ada di pendaftaran_grup
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN provinsi TEXT`).run();
    } catch (e) {}
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN kota TEXT`).run();
    } catch (e) {}

    // Migration: pastikan kolom provinsi dan kota ada di anggota
    try {
      await db.prepare(`ALTER TABLE anggota ADD COLUMN provinsi TEXT`).run();
    } catch (e) {}
    try {
      await db.prepare(`ALTER TABLE anggota ADD COLUMN kota TEXT`).run();
    } catch (e) {}

    // Migration: pastikan tabel anggota mendukung opsi peran yang diperluas
    try {
      const tableInfo = await db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='anggota'`).first<{ sql: string }>();
      if (tableInfo && tableInfo.sql && !tableInfo.sql.includes('Kakek')) {
        await db.batch([
          db.prepare(`
            CREATE TABLE anggota_temp (
              id TEXT PRIMARY KEY,
              grup_id TEXT NOT NULL,
              nama TEXT NOT NULL,
              jenis_kelamin TEXT NOT NULL CHECK(jenis_kelamin IN ('Ikhwan', 'Akhwat')),
              peran TEXT NOT NULL DEFAULT 'Peserta' CHECK(peran IN ('Ayah', 'Ibu', 'Anak', 'Kakek', 'Nenek', 'Paman', 'Bibi', 'Saudara Kandung', 'Sepupu', 'Peserta')),
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
            )
          `),
          db.prepare(`INSERT INTO anggota_temp SELECT * FROM anggota`),
          db.prepare(`DROP TABLE anggota`),
          db.prepare(`ALTER TABLE anggota_temp RENAME TO anggota`),
          db.prepare(`CREATE INDEX IF NOT EXISTS idx_anggota_grup_id ON anggota(grup_id)`),
          db.prepare(`CREATE INDEX IF NOT EXISTS idx_anggota_qr_token ON anggota(qr_token)`),
        ]);
        console.log('[DB] Tabel anggota berhasil dimigrasi untuk mendukung opsi peran tambahan.');
      }
    } catch (migErr) {
      console.warn('[DB] Migrasi tabel anggota dilewati:', migErr);
    }

    // Seed default addon items jika masih kosong
    const existingAddon = await db.prepare(`SELECT COUNT(*) as count FROM addon_items`).first<{ count: number }>();
    if (!existingAddon || existingAddon.count === 0) {
      await db.batch([
        db.prepare(`
          INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan)
          VALUES ('addon_tenda_4p', 'Sewa Tenda Dome (Kapasitas 4 Orang)', 'Tenda dome double layer anti air, termasuk pasak dan tali pengencang.', 120000, 20, 1, 1)
        `),
        db.prepare(`
          INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan)
          VALUES ('addon_matras', 'Sewa Matras Spon Camping', 'Matras spon tebal 10mm untuk kenyamanan tidur di dalam tenda.', 15000, 50, 1, 2)
        `),
        db.prepare(`
          INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan)
          VALUES ('addon_sleeping_bag', 'Sewa Sleeping Bag Hangat', 'Kantong tidur hangat bahan polar tebal.', 25000, 40, 1, 3)
        `),
        db.prepare(`
          INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan)
          VALUES ('addon_lampu_tenda', 'Sewa Lampu Tenda LED Rechargeable', 'Lampu gantung LED portabel baterai tahan hingga 12 jam.', 20000, 30, 1, 4)
        `),
        db.prepare(`
          INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan)
          VALUES ('addon_kabel_rol', 'Sewa Kabel Rol Listrik Tenda (10m)', 'Kabel rol colokan 4 lubang untuk suplai listrik ke tenda.', 25000, 25, 1, 5)
        `),
      ]);
    }

    // Seed default rekening bank jika belum ada di app_settings
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rekening_bank', 'Bank Syariah Indonesia (BSI)')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rekening_nomor', '7123456789')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rekening_atas_nama', 'Panitia Family Camp Muslim Scene')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('kontak_panitia_wa', '081234567890')`),
    ]);

    initialized = true;
    console.log('[DB] Family Camp tables initialized successfully.');
  } catch (err) {
    console.error('[DB] Error initializing Family Camp tables:', err);
    // Don't set initialized = true so it retries next request
  }
}
