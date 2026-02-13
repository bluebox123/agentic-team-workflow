-- Phase 8.5.2 Final Verification
-- Test versioned artifact creation with existing data

-- Show current state
SELECT 'Current Artifact State Before Test' as test,
       job_id, type, role, COUNT(*) as total_versions,
       COUNT(*) FILTER (WHERE is_current = true) as current_versions
FROM artifacts 
GROUP BY job_id, type, role
ORDER BY job_id, type, role;

-- Test the unique constraint by attempting to create a duplicate current artifact
-- This should fail due to our uniq_current_artifact index
BEGIN;

-- Try to insert a duplicate current artifact (should fail)
DO $$
DECLARE
    existing_artifact RECORD;
BEGIN
    -- Get an existing current artifact
    SELECT * INTO existing_artifact 
    FROM artifacts 
    WHERE is_current = true 
    LIMIT 1;
    
    IF FOUND THEN
        -- Try to insert another current artifact with same job_id, type, role
        INSERT INTO artifacts (
            id, task_id, job_id, type, role, filename, storage_key,
            mime_type, previewable, metadata,
            version, is_current, parent_artifact_id, created_at
        )
        VALUES (
            gen_random_uuid(),
            existing_artifact.task_id,
            existing_artifact.job_id,
            existing_artifact.type,
            existing_artifact.role,
            'should_fail.png',
            'test/should_fail.png',
            'image/png',
            true,
            '{"test": "constraint_violation"}',
            999,
            true,
            NULL,
            now()
        );
        
        RAISE EXCEPTION 'Expected unique constraint violation but insert succeeded';
    END IF;
END $$;

ROLLBACK; -- This should not be reached if constraint works

-- Test successful version creation workflow
BEGIN;

-- Get current artifact to version
SELECT 'Artifact to version' as test,
       id, job_id, type, role, version
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
    'new_version_test.png',
    'test/new_version_test.png',
    'image/png',
    true,
    '{"test": "versioning_works", "new_version": true}',
    version + 1,
    true,
    id,
    now()
FROM artifacts 
WHERE is_current = false 
ORDER BY created_at DESC 
LIMIT 1;

COMMIT;

-- Verify versioning worked correctly
SELECT 'Final Verification Results' as test,
       version, is_current, 
       parent_artifact_id IS NOT NULL as has_parent,
       filename
FROM artifacts 
WHERE job_id = (SELECT job_id FROM artifacts WHERE filename = 'new_version_test.png')
  AND type = (SELECT type FROM artifacts WHERE filename = 'new_version_test.png')
  AND role = (SELECT role FROM artifacts WHERE filename = 'new_version_test.png')
ORDER BY version;

-- Clean up test data
DELETE FROM artifacts WHERE filename = 'new_version_test.png';
UPDATE artifacts SET is_current = true 
WHERE id = (SELECT parent_artifact_id FROM artifacts WHERE filename = 'new_version_test.png' LIMIT 1);
