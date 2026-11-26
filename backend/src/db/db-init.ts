/**
 * Database Initializer — Auto-create tabel Family Camp
 * Dipanggil satu kali saat server pertama kali menerima request.
 * Menggunakan CREATE TABLE IF NOT EXISTS sehingga aman dipanggil berulang.
 */

import { ambilNomorUrutGrup, formatNomorPeserta } from '../services/peserta-rules';

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
          nomor_peserta TEXT,
          nama TEXT NOT NULL,
          jenis_kelamin TEXT NOT NULL CHECK(jenis_kelamin IN ('Ikhwan', 'Akhwat')),
          peran TEXT NOT NULL DEFAULT 'Peserta' CHECK(peran IN ('Ayah', 'Ibu', 'Suami', 'Istri', 'Anak', 'Kakek', 'Nenek', 'Paman', 'Bibi', 'Saudara Kandung', 'Sepupu', 'Peserta', 'Ketua Rombongan')),
          usia INTEGER,
          ukuran_kaos TEXT,
          catatan_medis TEXT,
          provinsi TEXT,
          kota TEXT,
          is_gratis INTEGER NOT NULL DEFAULT 0,
          makan_dicover INTEGER NOT NULL DEFAULT 0,
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
          kategori TEXT NOT NULL DEFAULT 'satuan',
          fasilitas TEXT,
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
      // 6. Counter nomor peserta per prefix (K = keluarga, N = non-keluarga)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS peserta_counter (
          prefix TEXT PRIMARY KEY,
          urut_terakhir INTEGER NOT NULL DEFAULT 0
        )
      `),
      // 7. Dompet kas (tunai / rekening)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS dompet (
          id TEXT PRIMARY KEY,
          nama TEXT NOT NULL,
          jenis TEXT NOT NULL DEFAULT 'rekening' CHECK(jenis IN ('tunai', 'rekening')),
          nomor_rekening TEXT,
          atas_nama TEXT,
          aktif INTEGER NOT NULL DEFAULT 1,
          urutan INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 8. Pos kas (pemasukan & pengeluaran, bisa ditambah admin)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS kas_pos (
          id TEXT PRIMARY KEY,
          nama TEXT NOT NULL,
          tipe TEXT NOT NULL CHECK(tipe IN ('pemasukan', 'pengeluaran')),
          deskripsi TEXT,
          aktif INTEGER NOT NULL DEFAULT 1,
          urutan INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 9. Buku kas: pemasukan & pengeluaran (dengan jurnal pembalik)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS kas_transaksi (
          id TEXT PRIMARY KEY,
          tipe TEXT NOT NULL CHECK(tipe IN ('pemasukan', 'pengeluaran')),
          pos_id TEXT NOT NULL,
          dompet_id TEXT NOT NULL,
          nominal INTEGER NOT NULL,
          keterangan TEXT,
          grup_id TEXT,
          nota_url TEXT,
          reversal_of TEXT,
          dibatalkan INTEGER NOT NULL DEFAULT 0,
          tanggal TEXT NOT NULL,
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
      // 10. Log scan per anggota per sesi (check-in & 3x makan)
      db.prepare(`
        CREATE TABLE IF NOT EXISTS scan_log (
          id TEXT PRIMARY KEY,
          anggota_id TEXT NOT NULL,
          grup_id TEXT NOT NULL,
          sesi TEXT NOT NULL,
          scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          scanned_by TEXT,
          metode TEXT NOT NULL DEFAULT 'qr',
          catatan TEXT,
          UNIQUE(anggota_id, sesi)
        )
      `),
      // 11. Template pesan WhatsApp
      db.prepare(`
        CREATE TABLE IF NOT EXISTS wa_templates (
          id TEXT PRIMARY KEY,
          nama TEXT NOT NULL,
          body TEXT NOT NULL,
          aktif INTEGER NOT NULL DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
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
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_anggota_nomor_peserta ON anggota(nomor_peserta)`,
      `CREATE INDEX IF NOT EXISTS idx_kas_transaksi_dompet ON kas_transaksi(dompet_id)`,
      `CREATE INDEX IF NOT EXISTS idx_kas_transaksi_pos ON kas_transaksi(pos_id)`,
      `CREATE INDEX IF NOT EXISTS idx_kas_transaksi_grup ON kas_transaksi(grup_id)`,
      `CREATE INDEX IF NOT EXISTS idx_scan_log_anggota ON scan_log(anggota_id)`,
      `CREATE INDEX IF NOT EXISTS idx_scan_log_grup ON scan_log(grup_id)`,
    ];

    // Satu per satu agar indeks yang bergantung pada kolom hasil migrasi tidak menggagalkan batch.
    for (const sql of indexes) {
      try {
        await db.prepare(sql).run();
      } catch (e) { }
    }

    // Migration: pastikan kolom provinsi dan kota ada di pendaftaran_grup
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN provinsi TEXT`).run();
    } catch (e) { }
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN kota TEXT`).run();
    } catch (e) { }

    // Migration: pastikan kolom provinsi dan kota ada di anggota
    try {
      await db.prepare(`ALTER TABLE anggota ADD COLUMN provinsi TEXT`).run();
    } catch (e) { }
    try {
      await db.prepare(`ALTER TABLE anggota ADD COLUMN kota TEXT`).run();
    } catch (e) { }

    // Migration: nomor peserta & opsi cover makan untuk usia < 3 tahun
    try {
      await db.prepare(`ALTER TABLE anggota ADD COLUMN nomor_peserta TEXT`).run();
    } catch (e) { }
    try {
      await db.prepare(`ALTER TABLE anggota ADD COLUMN makan_dicover INTEGER NOT NULL DEFAULT 0`).run();
    } catch (e) { }

    // Migration: nominal yang benar-benar diterima & selisih tagihan
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN nominal_dibayar INTEGER`).run();
    } catch (e) { }
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN selisih_bayar INTEGER NOT NULL DEFAULT 0`).run();
    } catch (e) { }
    try {
      await db.prepare(`ALTER TABLE pendaftaran_grup ADD COLUMN nomor_grup TEXT`).run();
    } catch (e) { }

    // Migration: kategori & fasilitas add-on (paket vs satuan)
    try {
      await db.prepare(`ALTER TABLE addon_items ADD COLUMN kategori TEXT NOT NULL DEFAULT 'satuan'`).run();
    } catch (e) { }
    try {
      await db.prepare(`ALTER TABLE addon_items ADD COLUMN fasilitas TEXT`).run();
    } catch (e) { }
    // Backfill kategori paket dari id lama (addon_paket_*)
    try {
      await db
        .prepare(
          `UPDATE addon_items SET kategori = 'paket', fasilitas = COALESCE(fasilitas, '1 Tenda Dome|Matras Spon|Sleeping Bag Hangat|1 Lampu Tenda LED') WHERE id LIKE 'addon_paket_%' AND (kategori IS NULL OR kategori = 'satuan')`
        )
        .run();
    } catch (e) { }

    // Backfill nomor_peserta untuk anggota lama yang belum punya nomor
    try {
      const belumNomor = await db
        .prepare(
          `SELECT a.id, a.grup_id, g.tipe FROM anggota a JOIN pendaftaran_grup g ON g.id = a.grup_id
           WHERE a.nomor_peserta IS NULL ORDER BY a.created_at ASC`
        )
        .all<{ id: string; grup_id: string; tipe: string }>();
      const grupUrut = new Map<string, number>();
      for (const row of belumNomor.results || []) {
        if (!grupUrut.has(row.grup_id)) {
          grupUrut.set(row.grup_id, await ambilNomorUrutGrup(db, row.tipe));
        }
        const urutGrup = grupUrut.get(row.grup_id)!;
        const countRow = await db
          .prepare(`SELECT COUNT(*) as n FROM anggota WHERE grup_id = ? AND nomor_peserta IS NOT NULL`)
          .bind(row.grup_id)
          .first<{ n: number }>();
        const nomor = formatNomorPeserta(row.tipe, urutGrup, (countRow?.n || 0) + 1);
        await db.prepare(`UPDATE anggota SET nomor_peserta = ? WHERE id = ?`).bind(nomor, row.id).run();
      }
    } catch (backfillErr) {
      console.warn('[DB] Backfill nomor peserta dilewati:', backfillErr);
    }

    // Migration: pastikan tabel anggota mendukung peran diperluas + kolom nomor peserta & cover makan
    try {
      const tableInfo = await db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='anggota'`).first<{ sql: string }>();
      const needsRebuild =
        !!tableInfo?.sql &&
        (!tableInfo.sql.includes('Kakek') ||
          !tableInfo.sql.includes('Suami') ||
          !tableInfo.sql.includes('Istri') ||
          !tableInfo.sql.includes('Ketua Rombongan') ||
          !tableInfo.sql.includes('nomor_peserta') ||
          !tableInfo.sql.includes('makan_dicover'));

      if (needsRebuild) {
        await db.batch([
          db.prepare(`DROP TABLE IF EXISTS anggota_temp`),
          db.prepare(`
            CREATE TABLE anggota_temp (
              id TEXT PRIMARY KEY,
              grup_id TEXT NOT NULL,
              nomor_peserta TEXT,
              nama TEXT NOT NULL,
              jenis_kelamin TEXT NOT NULL CHECK(jenis_kelamin IN ('Ikhwan', 'Akhwat')),
              peran TEXT NOT NULL DEFAULT 'Peserta' CHECK(peran IN ('Ayah', 'Ibu', 'Suami', 'Istri', 'Anak', 'Kakek', 'Nenek', 'Paman', 'Bibi', 'Saudara Kandung', 'Sepupu', 'Peserta', 'Ketua Rombongan')),
              usia INTEGER,
              ukuran_kaos TEXT,
              catatan_medis TEXT,
              provinsi TEXT,
              kota TEXT,
              is_gratis INTEGER NOT NULL DEFAULT 0,
              makan_dicover INTEGER NOT NULL DEFAULT 0,
              qr_token TEXT UNIQUE,
              qr_code_url TEXT,
              status_hadir TEXT NOT NULL DEFAULT 'belum' CHECK(status_hadir IN ('belum', 'hadir')),
              attended_at DATETIME,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (grup_id) REFERENCES pendaftaran_grup(id) ON DELETE CASCADE
            )
          `),
          db.prepare(`
            INSERT INTO anggota_temp (
              id, grup_id, nomor_peserta, nama, jenis_kelamin, peran, usia, ukuran_kaos, catatan_medis,
              provinsi, kota, is_gratis, makan_dicover, qr_token, qr_code_url, status_hadir, attended_at, created_at
            )
            SELECT id, grup_id, nomor_peserta, nama, jenis_kelamin, peran, usia, ukuran_kaos, catatan_medis,
              provinsi, kota, is_gratis, makan_dicover, qr_token, qr_code_url, status_hadir, attended_at, created_at
            FROM anggota
          `),
          db.prepare(`DROP TABLE anggota`),
          db.prepare(`ALTER TABLE anggota_temp RENAME TO anggota`),
          db.prepare(`CREATE INDEX IF NOT EXISTS idx_anggota_grup_id ON anggota(grup_id)`),
          db.prepare(`CREATE INDEX IF NOT EXISTS idx_anggota_qr_token ON anggota(qr_token)`),
          db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_anggota_nomor_peserta ON anggota(nomor_peserta)`),
        ]);
        console.log('[DB] Tabel anggota berhasil dimigrasi (peran, nomor peserta, cover makan).');
      }
    } catch (migErr) {
      console.warn('[DB] Migrasi tabel anggota dilewati:', migErr);
    }

    // Seed awal item sewa (hanya jika belum ada). Setelah itu katalog sepenuhnya dikelola admin.
    try {
      const defaultAddonList = [
        { id: 'addon_paket_a', nama: 'Paket A', deskripsi: '1 Tenda + 4 Matras + 4 Sleeping Bag + 1 Lampu Tenda', harga: 120000, stok: 50, urutan: 1, kategori: 'paket', fasilitas: '1 Tenda Dome|4 Matras Spon|4 Sleeping Bag Hangat|1 Lampu Tenda LED' },
        { id: 'addon_paket_b', nama: 'Paket B', deskripsi: '1 Tenda + 3 Matras + 3 Sleeping Bag + 1 Lampu Tenda', harga: 110000, stok: 50, urutan: 2, kategori: 'paket', fasilitas: '1 Tenda Dome|3 Matras Spon|3 Sleeping Bag Hangat|1 Lampu Tenda LED' },
        { id: 'addon_paket_c', nama: 'Paket C', deskripsi: '1 Tenda + 2 Matras + 2 Sleeping Bag + 1 Lampu Tenda', harga: 100000, stok: 50, urutan: 3, kategori: 'paket', fasilitas: '1 Tenda Dome|2 Matras Spon|2 Sleeping Bag Hangat|1 Lampu Tenda LED' },
        { id: 'addon_satuan_tenda', nama: 'Tenda', deskripsi: 'Sewa tenda dome kapasitas 4 orang', harga: 70000, stok: 50, urutan: 4, kategori: 'satuan', fasilitas: '' },
        { id: 'addon_satuan_matras', nama: 'Matras', deskripsi: 'Sewa matras spon camping tebal', harga: 5000, stok: 100, urutan: 5, kategori: 'satuan', fasilitas: '' },
        { id: 'addon_satuan_sleeping_bag', nama: 'Sleeping Bag', deskripsi: 'Sewa kantong tidur / sleeping bag hangat', harga: 10000, stok: 100, urutan: 6, kategori: 'satuan', fasilitas: '' },
        { id: 'addon_satuan_lampu_tenda', nama: 'Lampu Tenda', deskripsi: 'Sewa lampu tenda LED gantung', harga: 7000, stok: 50, urutan: 7, kategori: 'satuan', fasilitas: '' },
      ];

      const addonCount = await db
        .prepare(`SELECT COUNT(*) as total FROM addon_items`)
        .first<{ total: number }>();

      // Katalog sudah pernah dibuat: jangan menimpa nama/harga/status yang diubah admin.
      if (addonCount?.total === 0) {
        for (const item of defaultAddonList) {
          await db
            .prepare(
              `INSERT INTO addon_items (id, nama, deskripsi, harga, stok, aktif, urutan, kategori, fasilitas)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING`
            )
            .bind(item.id, item.nama, item.deskripsi, item.harga, item.stok, item.urutan, item.kategori, item.fasilitas)
            .run();
        }
      }
    } catch (addonErr) {
      console.warn('[DB] Seed addon items error:', addonErr);
    }

    // Seed awal rekening bank (hanya jika belum diatur admin)
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rekening_bank', 'BCA Syariah')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rekening_nomor', '0680909090')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rekening_atas_nama', 'Yayasan Muslim Scene Official')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('kontak_panitia_wa', '081234567890')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('harga_per_orang', '200000')`),
      db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('nama_acara', 'Family Camp')`),
    ]);

    // Seed awal dompet kas
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO dompet (id, nama, jenis, nomor_rekening, atas_nama, aktif, urutan) VALUES ('dmp_tunai', 'Kas Tunai', 'tunai', NULL, NULL, 1, 1)`),
      db.prepare(`INSERT OR IGNORE INTO dompet (id, nama, jenis, nomor_rekening, atas_nama, aktif, urutan) VALUES ('dmp_bca_syariah', 'BCA Syariah', 'rekening', '0680909090', 'Yayasan Muslim Scene Official', 1, 2)`),
    ]);

    // Seed awal pos kas
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_pendaftaran', 'Pendaftaran', 'pemasukan', 'Pemasukan dari verifikasi pembayaran peserta', 1, 1)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_sponsori', 'Sponsori', 'pemasukan', 'Pemasukan dari sponsor kegiatan', 1, 2)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_donasi', 'Donasi', 'pemasukan', 'Pemasukan dari donatur', 1, 3)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_kelebihan_bayar', 'Kelebihan Bayar', 'pemasukan', 'Selisih lebih transfer peserta (titipan, bukan pendapatan)', 1, 4)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_konsumsi', 'Konsumsi', 'pengeluaran', 'Belanja bahan makanan, snack, dan minuman', 1, 1)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_perlengkapan', 'Perlengkapan', 'pengeluaran', 'Sewa tenda, alat camping, dan perlengkapan acara', 1, 2)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_operasional', 'Operasional', 'pengeluaran', 'Transportasi, komunikasi, dan biaya operasional lain', 1, 3)`),
      db.prepare(`INSERT OR IGNORE INTO kas_pos (id, nama, tipe, deskripsi, aktif, urutan) VALUES ('pos_lain_lain', 'Lain-lain', 'pengeluaran', 'Pengeluaran lain yang belum berkategori', 1, 4)`),
    ]);

    const WA_LUNAS_BODY = `بسم الله
السلام عليكم ورحمة الله وبركاته
Halo *{nama_pic}*,

Alhamdulillah, pembayaran *{nama_acara}* Anda telah kami verifikasi *LUNAS* ✅

Total Peserta: {jumlah_anggota} orang
Total Pembayaran: {total}

Silakan cek status pendaftaran dan unduh *ID/QR kehadiran* seluruh anggota melalui tautan berikut:
🔗 {link_status}

*Kode Akses Tiket:* {kode_akses}

Mohon tunjukkan QR Code masing-masing anggota kepada panitia saat registrasi di lokasi acara.

جزاكم الله خيرا
_Panitia {nama_acara}_`;

    // Seed awal template WhatsApp
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO wa_templates (id, nama, body, aktif) VALUES ('wa_undangan_bayar', 'Undangan / Simpan Link Pembayaran',
        'بسم الله
السلام عليكم ورحمة الله وبركاته
Halo *{nama_pic}*,

Terima kasih telah mendaftar *{nama_acara}*.

Total tagihan kelompok Anda: *{total}* untuk {jumlah_anggota} peserta.

Silakan lanjutkan pembayaran & simpan tautan berikut agar tidak hilang:
🔗 {link_pembayaran}

Setelah transfer, unggah bukti pembayaran pada tautan di atas.

Simpan pula *Kode Akses* Anda untuk mengecek status pendaftaran kapan saja:
🔎 {link_status}
*Kode Akses:* {kode_akses}

جزاكم الله خيرا
_Panitia {nama_acara}_', 1)`),
      db.prepare(`INSERT OR IGNORE INTO wa_templates (id, nama, body, aktif) VALUES ('wa_pengingat_bayar', 'Pengingat Tagihan',
        'بسم الله
السلام عليكم ورحمة الله وبركاته
Halo *{nama_pic}*,

Kami mengingatkan tagihan pendaftaran *{nama_acara}* sebesar *{total}* belum kami terima.

Silakan lakukan pembayaran melalui tautan berikut:
🔗 {link_pembayaran}

Jika sudah transfer, mohon unggah bukti pembayaran pada tautan tersebut.

Simpan pula *Kode Akses* Anda untuk mengecek status pendaftaran kapan saja:
🔎 {link_status}
*Kode Akses:* {kode_akses}

جزاكم الله خيرا
_Panitia {nama_acara}_', 1)`),
      db.prepare(`INSERT OR IGNORE INTO wa_templates (id, nama, body, aktif) VALUES ('wa_lunas', 'Konfirmasi Lunas & Link Cek Status', ?, 1)`).bind(WA_LUNAS_BODY),
    ]);

    // Migrasi ringan: pastikan template lunas memuat kode akses pada DB yang sudah ada.
    await db
      .prepare(
        `UPDATE wa_templates SET body = ? WHERE id = 'wa_lunas' AND (body IS NULL OR body NOT LIKE '%{kode_akses}%')`
      )
      .bind(WA_LUNAS_BODY)
      .run();

    // Migrasi ringan: pastikan template undangan & pengingat memuat kode akses (cek status mandiri).
    await db
      .prepare(
        `UPDATE wa_templates SET body = body || char(10) || char(10) || 'Simpan pula *Kode Akses* Anda untuk mengecek status pendaftaran kapan saja:' || char(10) || '🔎 {link_status}' || char(10) || '*Kode Akses:* {kode_akses}'
         WHERE id IN ('wa_undangan_bayar', 'wa_pengingat_bayar') AND (body IS NULL OR body NOT LIKE '%{kode_akses}%')`
      )
      .run();

    initialized = true;
    console.log('[DB] Family Camp tables initialized successfully.');
  } catch (err) {
    console.error('[DB] Error initializing Family Camp tables:', err);
    // Don't set initialized = true so it retries next request
  }
}
