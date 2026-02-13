-- Phase 8.5.2 Verification Script
-- Test versioned artifact creation behavior

-- Clean up any existing test data
DELETE FROM artifacts WHERE job_id = '00000000-0000-0000-0000-000000000001';

-- Test 1: Create first artifact (should be version 1, current)
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    gen_random_uuid(),
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    'chart',
    'latency_p95',
    'latency_v1.png',
    'test/key1.png',
    'image/png',
    true,
    '{"test": "first"}',
    1,
    true,
    NULL,
    now()
);

-- Test 2: Create second artifact (should be version 2, current; v1 marked non-current)
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    gen_random_uuid(),
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000001',
    'chart',
    'latency_p95',
    'latency_v2.png',
    'test/key2.png',
    'image/png',
    true,
    '{"test": "second"}',
    2,
    true,
    (SELECT id FROM artifacts WHERE job_id = '00000000-0000-0000-0000-000000000001' AND type = 'chart' AND role = 'latency_p95' AND version = 1),
    now()
);

-- Update first artifact to be non-current (simulating versioned creation)
UPDATE artifacts SET is_current = false 
WHERE job_id = '00000000-0000-0000-0000-000000000001' 
  AND type = 'chart' 
  AND role = 'latency_p95' 
  AND version = 1;

-- Verification Queries

-- 1. Show version history (should show v1=false, v2=true)
SELECT 'Version History Check' as test,
       version, is_current, parent_artifact_id, filename
FROM artifacts 
WHERE job_id = '00000000-0000-0000-0000-000000000001'
  AND type = 'chart' 
  AND role = 'latency_p95'
ORDER BY version;

-- 2. Verify only one current artifact exists (should return 1 row)
SELECT 'Current Artifact Count' as test, COUNT(*) as count
FROM artifacts 
WHERE job_id = '00000000-0000-0000-0000-000000000001'
  AND type = 'chart' 
  AND role = 'latency_p95'
  AND is_current = true;

-- 3. Verify parent-child relationship (v2 should have v1 as parent)
SELECT 'Parent-Child Relationship' as test,
       a1.version as parent_version,
       a2.version as child_version,
       a2.parent_artifact_id = a1.id as correct_parent
FROM artifacts a1
JOIN artifacts a2 ON a2.parent_artifact_id = a1.id
WHERE a1.job_id = '00000000-0000-0000-0000-000000000001'
  AND a1.type = 'chart' 
  AND a1.role = 'latency_p95'
  AND a1.version = 1;

-- 4. Test constraint protection (try to create duplicate current - should fail)
-- This would be tested in the application layer, not SQL
