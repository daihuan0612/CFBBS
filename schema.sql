DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS nonces;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS categories;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user', -- 'user' or 'admin'
  verified INTEGER DEFAULT 0,
  verification_token TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER DEFAULT 0,
  reset_token TEXT,
  reset_token_expires INTEGER, -- Timestamp
  pending_email TEXT,
  email_change_token TEXT,
  avatar_url TEXT,
  nickname TEXT,
  email_notifications INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category_id INTEGER,
  is_pinned INTEGER DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_id INTEGER,
  author_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  jti TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO settings (key, value) VALUES ('turnstile_enabled', '0');

-- Insert some dummy data
-- Admin user (admin@adysec.com / Admin@123)
-- Hash for 'Admin@123': ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f
INSERT INTO users (email, username, password, role, verified, nickname) VALUES
('admin@adysec.com', 'Admin', 'e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7', 'admin', 1, 'System Admin'),
('alice@example.com', 'Alice', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'user', 1, 'Alice Wonderland'),
('bob@example.com', 'Bob', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'user', 0, NULL);

INSERT INTO categories (name) VALUES ('General'), ('Tech'), ('Random');

INSERT INTO posts (author_id, title, content, category_id) VALUES (1, 'Welcome to CForum', 'This is an official announcement from the admin.', 1);
INSERT INTO posts (author_id, title, content, category_id) VALUES (2, 'Hello World', 'This is the first post by Alice!', 2);

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_resend', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_manual_verify', '0');

-- ========== 二次开发新增表 ==========

DROP TABLE IF EXISTS invitation_codes;
DROP TABLE IF EXISTS password_history;
DROP TABLE IF EXISTS temp_passwords;
DROP TABLE IF EXISTS encrypted_attachments;
DROP TABLE IF EXISTS user_watermarks;

CREATE TABLE IF NOT EXISTS invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  used_by INTEGER DEFAULT NULL,
  used_at TIMESTAMP DEFAULT NULL,
  expires_at INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_active ON invitation_codes(is_active);

CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);

CREATE TABLE IF NOT EXISTS temp_passwords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  temp_password TEXT NOT NULL,
  temp_password_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  is_used INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_temp_passwords_user ON temp_passwords(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_passwords_expires ON temp_passwords(expires_at);

CREATE TABLE IF NOT EXISTS encrypted_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER NOT NULL,
  link_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extract_code TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  is_encrypted INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_encrypted_attachments_post ON encrypted_attachments(post_id);

CREATE TABLE IF NOT EXISTS user_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  watermark_data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 二次开发新增系统设置项
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_only', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('encrypted_attachments_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_likes', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_bookmarks', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_comments', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_posts', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('watermark_enabled', '1');
