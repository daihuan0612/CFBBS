-- Migration 0004: Media management system
-- 媒体文件管理、帖子媒体关联、媒体事件日志
-- 执行: wrangler d1 migrations apply cforum-db --remote

-- 媒体文件表
CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,              -- 格式: m_xxxxx
    owner_id TEXT NOT NULL,            -- 上传用户 ID
    url TEXT NOT NULL,                 -- 可访问的完整 URL
    media_type TEXT NOT NULL,          -- image / video / audio / file
    mime TEXT,                         -- image/jpeg, video/mp4 等
    size INTEGER,                      -- 文件大小（字节）
    width INTEGER,                     -- 图片/视频宽度
    height INTEGER,                    -- 图片/视频高度
    duration REAL,                     -- 视频/音频时长（秒）
    storage TEXT NOT NULL,             -- telegram / r2 / s3 等
    storage_id TEXT,                   -- 存储系统内的唯一标识（如 TG file_id）
    thumbnail TEXT,                    -- 缩略图 URL
    status TEXT NOT NULL DEFAULT 'ready',  -- ready / processing / failed / deleted
    purpose TEXT,                      -- post / avatar / emoji / attachment
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media_files(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_status ON media_files(status);
CREATE INDEX IF NOT EXISTS idx_media_purpose ON media_files(purpose);

-- 帖子-媒体关联表
CREATE TABLE IF NOT EXISTS post_media (
    post_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    position INTEGER DEFAULT 0,        -- 在帖子中的排序位置
    created_at INTEGER NOT NULL,
    PRIMARY KEY(post_id, media_id),
    FOREIGN KEY (media_id) REFERENCES media_files(id)
);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_post_media_media ON post_media(media_id);

-- 媒体事件日志表
CREATE TABLE IF NOT EXISTS media_events (
    id TEXT PRIMARY KEY,
    media_id TEXT,
    event TEXT NOT NULL,               -- upload / thumbnail_generated / attached / detached / deleted
    created_at INTEGER NOT NULL,
    FOREIGN KEY (media_id) REFERENCES media_files(id)
);
CREATE INDEX IF NOT EXISTS idx_media_events_media ON media_events(media_id);
CREATE INDEX IF NOT EXISTS idx_media_events_event ON media_events(event);