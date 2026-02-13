-- Phase 8.5.2 Verification Script (using existing data)
-- Test versioned artifact creation behavior

-- First, let's see what artifacts we currently have
SELECT 'Current Artifacts Before Test' as test,
       id, job_id, type, role, version, is_current, parent_artifact_id
FROM artifacts 
ORDER BY job_id, type, role, version;

-- Test the unique constraint by trying to violate it (should fail)
-- This tests the database enforcement we created in Phase 8.5.1

-- Try to create a duplicate current artifact (should be rejected by unique constraint)
BEGIN;
-- This should fail due to uniq_current_artifact constraint
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
SELECT 
    gen_random_uuid(),
    task_id,
    job_id,
    type,
    role,
    'duplicate.png',
    'test/duplicate.png',
    'image/png',
    true,
    '{"test": "duplicate"}',
    1,
    true,
    NULL,
    now()
FROM artifacts 
WHERE is_current = true 
LIMIT 1;
ROLLBACK;

-- Test that we can create a new version (this simulates what the new code does)
BEGIN;

-- Get current artifact info
SELECT 'Current artifact for versioning test' as test,
       id, job_id, type, role, version, is_current
FROM artifacts 
WHERE is_current = true 
LIMIT 1;

-- Mark current as non-current
UPDATE artifacts 
SET is_current = false 
WHERE id = (SELECT id FROM artifacts WHERE is_current = true LIMIT 1);

-- Create new version
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
SELECT 
    gen_random_uuid(),
    task_id,
    job_id,
    type,
    role,
    'new_version.png',
    'test/new_version.png',
    'image/png',
    true,
    '{"test": "new_version"}',
    version + 1,
    true,
    id,
    now()
FROM artifacts 
WHERE is_current = false 
ORDER BY created_at DESC 
LIMIT 1;

COMMIT;

-- Verify the results
SELECT 'Final State After Versioning Test' as test,
       id, job_id, type, role, version, is_current, parent_artifact_id,
       filename
FROM artifacts 
WHERE job_id = (SELECT job_id FROM artifacts ORDER BY created_at DESC LIMIT 1)
  AND type = (SELECT type FROM artifacts ORDER BY created_at DESC LIMIT 1)
  AND role = (SELECT role FROM artifacts ORDER BY created_at DESC LIMIT 1)
ORDER BY version;
