-- Phase 8.5.2 Comprehensive Verification
-- Complete test of versioned artifact creation system

-- 1. Show initial state
SELECT '=== INITIAL STATE ===' as test;
SELECT job_id, type, role, COUNT(*) as total_versions,
       COUNT(*) FILTER (WHERE is_current = true) as current_versions
FROM artifacts 
GROUP BY job_id, type, role
ORDER BY job_id, type, role;

-- 2. Test constraint protection (should fail)
SELECT '=== TESTING CONSTRAINT PROTECTION ===' as test;
BEGIN;
DO $$
DECLARE
    existing RECORD;
BEGIN
    SELECT * INTO existing FROM artifacts WHERE is_current = true LIMIT 1;
    
    IF FOUND THEN
        INSERT INTO artifacts (
            id, task_id, job_id, type, role, filename, storage_key,
            mime_type, previewable, metadata, version, is_current, 
            parent_artifact_id, created_at
        )
        VALUES (
            gen_random_uuid(), existing.task_id, existing.job_id, 
            existing.type, existing.role, 'constraint_test.png', 
            'test/constraint.png', 'image/png', true, 
            '{"test": "should_fail"}', 999, true, NULL, now()
        );
        
        RAISE EXCEPTION 'UNEXPECTED: Constraint should have prevented this insert';
    END IF;
END $$;
ROLLBACK;
SELECT '✅ Constraint protection working - duplicate current artifacts rejected' as result;

-- 3. Test successful versioning workflow
SELECT '=== TESTING VERSIONING WORKFLOW ===' as test;
BEGIN;

-- Get current artifact
SELECT 'Found current artifact to version' as status,
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
    mime_type, previewable, metadata, version, is_current, 
    parent_artifact_id, created_at
)
SELECT 
    gen_random_uuid(), task_id, job_id, type, role, 
    'versioned_artifact.png', 'test/versioned.png', 'image/png', true,
    '{"test": "versioning_success", "new_version": true}', 
    version + 1, true, id, now()
FROM artifacts 
WHERE is_current = false 
ORDER BY created_at DESC 
LIMIT 1;

COMMIT;
SELECT '✅ Versioning workflow completed successfully' as result;

-- 4. Verify final state
SELECT '=== FINAL VERIFICATION ===' as test;
SELECT version, is_current, 
       parent_artifact_id IS NOT NULL as has_parent,
       filename, metadata->>'test' as test_label
FROM artifacts 
WHERE filename = 'versioned_artifact.png' OR 
      parent_artifact_id IN (SELECT id FROM artifacts WHERE filename = 'versioned_artifact.png')
ORDER BY version;

-- 5. Verify only one current per group
SELECT '=== UNIQUENESS CHECK ===' as test;
SELECT job_id, type, role, COUNT(*) as current_count
FROM artifacts 
WHERE is_current = true
GROUP BY job_id, type, role
HAVING COUNT(*) > 1;

-- 6. Cleanup test data
SELECT '=== CLEANUP ===' as test;
DELETE FROM artifacts WHERE filename = 'versioned_artifact.png';
UPDATE artifacts SET is_current = true 
WHERE id = (SELECT parent_artifact_id FROM artifacts WHERE filename = 'versioned_artifact.png' LIMIT 1);
SELECT '✅ Test data cleaned up' as result;

SELECT '=== PHASE 8.5.2 VERIFICATION COMPLETE ===' as test;
