-- Test constraint properly
BEGIN;
INSERT INTO artifacts (id, task_id, job_id, type, role, filename, storage_key, mime_type, previewable, metadata, version, is_current, parent_artifact_id, created_at)
SELECT gen_random_uuid(), task_id, job_id, type, role, 'test_duplicate.png', 'test/duplicate.png', 'image/png', true, '{"test": "constraint"}', 999, true, NULL, now()
FROM artifacts WHERE is_current = true LIMIT 1;
COMMIT;
