-- 将早期开发阶段的绝对路径迁移为账号下的相对路径，原始文件不改名、不删除。
UPDATE books SET storage_path = owner_id::text || '/' || id::text || '.' || lower(format) WHERE storage_path LIKE '/%';
