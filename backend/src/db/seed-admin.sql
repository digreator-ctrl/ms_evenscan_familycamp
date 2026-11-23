-- Seed admin lokal (DEV ONLY)
-- Username: admin
-- Password: admin123
-- Hash = sha256('admin123' + ':ms_salt_2026')
INSERT OR IGNORE INTO admin_users (id, username, password_hash, nama, role)
VALUES (
  'usr_admin_dev',
  'admin',
  '25d43cfed763219ab13ea0884e05f6389845ffd3aa6b48d777343d8ca83e148c',
  'Admin Dev',
  'superadmin'
);
