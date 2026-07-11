-- CForum 二次开发: 新增表结构
-- 执行: wrangler d1 migrations apply cforum-db

-- ========== 1. 邀请码表 ==========
CREATE TABLE IF NOT EXISTS invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,       -- 管理员用户ID
  used_by INTEGER DEFAULT NULL,       -- 使用用户ID
  used_at TIMESTAMP DEFAULT NULL,
  expires_at INTEGER NOT NULL,        -- 过期时间戳 (ms)
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_active ON invitation_codes(is_active);

-- ========== 2. 密码历史表 ==========
CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);

-- ========== 3. 临时密码表（管理员重置用）==========
CREATE TABLE IF NOT EXISTS temp_passwords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  temp_password TEXT NOT NULL,        -- 明文临时密码（展示给管理员）
  temp_password_hash TEXT NOT NULL,   -- 哈希（供用户登录用）
  expires_at INTEGER NOT NULL,        -- 24h过期时间戳 (ms)
  is_used INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,        -- 管理员ID
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_temp_passwords_user ON temp_passwords(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_passwords_expires ON temp_passwords(expires_at);

-- ========== 4. 加密网盘附件表（仅存链接，无文件存储）==========
CREATE TABLE IF NOT EXISTS encrypted_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER NOT NULL,
  link_url TEXT NOT NULL,             -- 网盘链接URL
  file_name TEXT NOT NULL,            -- 显示名称
  extract_code TEXT DEFAULT '',       -- 提取码
  password_hash TEXT DEFAULT '',      -- 访问密码哈希（空=无密码）
  is_encrypted INTEGER DEFAULT 0,    -- 是否加密标识
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_encrypted_attachments_post ON encrypted_attachments(post_id);

-- ========== 5. 用户水印表 ==========
CREATE TABLE IF NOT EXISTS user_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  watermark_data TEXT NOT NULL,       -- 水印元数据
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ========== 6. 新增系统设置项 ==========
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_only', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('encrypted_attachments_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_likes', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_bookmarks', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_comments', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_posts', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('watermark_enabled', '1');