-- Migration 0003: Add notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_user_delete', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_username_change', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_avatar_change', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_manual_verify', '1');
