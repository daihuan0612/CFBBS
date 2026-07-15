-- 帖子视频缩略图永久缓存
-- VideoThumbnail 截帧后存储 URL 到 posts.thumbnail_url，所有访客复用
ALTER TABLE posts ADD COLUMN thumbnail_url TEXT DEFAULT NULL;
