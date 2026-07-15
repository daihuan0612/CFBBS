-- 性能索引迁移：消除核心查询路径的全表扫描
-- 适用于 D1 免费配额（500万行读取/月）

-- posts 表核心索引
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_pinned_created ON posts(is_pinned, created_at);

-- posts 新增 updated_at 列，用于 If-Modified-Since 条件缓存
ALTER TABLE posts ADD COLUMN updated_at TEXT;
-- 存量数据用 created_at 填充
UPDATE posts SET updated_at = created_at WHERE updated_at IS NULL;

-- comments 表核心索引
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at);

-- likes 表索引（user_id 在 UNIQUE(post_id,user_id) 中不靠前，需单独建）
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);

-- sessions 清理/用户删除
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- nonces 定时清理
CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at);

-- rate_limits 定时清理
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- audit_logs（后续加定时清理后需要）
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
