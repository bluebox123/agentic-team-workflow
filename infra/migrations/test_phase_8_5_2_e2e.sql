-- Phase 8.5.2 End-to-End Test
-- Test the complete versioned artifact creation flow

-- Clean up test artifacts
DELETE FROM artifacts WHERE job_id = 'test-852-job';

-- Create a test job and task first
INSERT INTO jobs (id, name, workflow_id, status, created_at)
VALUES ('test-852-job', 'Phase 8.5.2 Test Job', 'test-workflow', 'RUNNING', now());

INSERT INTO tasks (id, job_id, name, status, agent_type, payload, order_index, created_at)
VALUES ('test-852-task', 'test-852-job', 'Test Chart Task', 'SUCCESS', 'chart', '{}', 1, now());

-- Test 1: Create first version through direct SQL (simulating worker)
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    'test-852-artifact-v1',
    'test-852-task',
    'test-852-job',
    'chart',
    'latency_p95',
    'latency_v1.png',
    'test/latency_v1.png',
    'image/png',
    true,
    '{"version": "first", "test": "852"}',
    1,
    true,
    NULL,
    now()
);

-- Test 2: Create second version (simulating retry/re-run)
BEGIN;

-- Lock and update current
SELECT id, version FROM artifacts 
WHERE job_id = 'test-852-job' AND type = 'chart' AND role = 'latency_p95' AND is_current = TRUE
FOR UPDATE;

-- Mark old as non-current
UPDATE artifacts SET is_current = FALSE 
WHERE id = 'test-852-artifact-v1';

-- Create new version
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    'test-852-artifact-v2',
    'test-852-task',
    'test-852-job',
    'chart',
    'latency_p95',
    'latency_v2.png',
    'test/latency_v2.png',
    'image/png',
    true,
    '{"version": "second", "test": "852", "improved": true}',
    2,
    true,
    'test-852-artifact-v1',
    now()
);

COMMIT;

-- Verification
SELECT 'Phase 8.5.2 Test Results' as test,
       version, is_current, parent_artifact_id IS NOT NULL as has_parent,
       filename, metadata->>'version' as version_label
FROM artifacts 
WHERE job_id = 'test-852-job'
  AND type = 'chart' 
  AND role = 'latency_p95'
ORDER BY version;

-- Test constraint: Try to create duplicate current (should fail)
BEGIN;
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    'test-852-duplicate',
    'test-852-task',
    'test-852-job',
    'chart',
    'latency_p95',
    'duplicate.png',
    'test/duplicate.png',
    'image/png',
    true,
    '{"bad": "duplicate"}',
    3,
    true,
    NULL,
    now()
);
-- This should fail due to uniq_current_artifact constraint
ROLLBACK;

-- Cleanup
DELETE FROM artifacts WHERE job_id = 'test-852-job';
DELETE FROM tasks WHERE job_id = 'test-852-job';
DELETE FROM jobs WHERE id = 'test-852-job';
