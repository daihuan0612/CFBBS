-- 清理废弃表：media_events 从未被任何 API 读取或写入
DROP TABLE IF EXISTS media_events;
