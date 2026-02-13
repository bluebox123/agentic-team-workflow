-- Phase 8.5.3 Diff Test with Existing Data
-- Test the diff functionality with existing artifacts

-- First, let's see what artifacts we have
SELECT '=== Existing Artifacts for Diff Testing ===' as info;
SELECT 
    id, job_id, type, role, version, is_current, filename,
    metadata->>'title' as title,
    metadata->>'chart_type' as chart_type,
    CASE 
        WHEN metadata->>'points' IS NOT NULL 
        THEN json_array_length(metadata->>'points')
        ELSE 0 
    END as data_points
FROM artifacts 
WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
ORDER BY type, role, version;

-- Test scenario: Create a new version of an existing chart to test diff
BEGIN;

-- Get current PDF artifact
SELECT 'Current PDF artifact to version' as status,
       id, version, is_current, filename
FROM artifacts 
WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
  AND type = 'pdf' 
  AND is_current = true;

-- Mark current as non-current
UPDATE artifacts 
SET is_current = false 
WHERE id = (
    SELECT id FROM artifacts 
    WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
      AND type = 'pdf' 
      AND is_current = true
);

-- Create new version with different metadata
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
    'report_v2.pdf',
    'test/report_v2.pdf',
    'application/pdf',
    true,
    jsonb_set(
        jsonb_set(metadata, '{"title"}', '"Updated Report"'),
        '{"updated_version"}', 
        'true'
    ),
    version + 1,
    true,
    id,
    now()
FROM artifacts 
WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
  AND type = 'pdf' 
  AND is_current = false
ORDER BY version DESC
LIMIT 1;

COMMIT;

-- Verify the versioning worked
SELECT '=== PDF Versioning Test Results ===' as info;
SELECT 
    version, is_current, 
    parent_artifact_id IS NOT NULL as has_parent,
    filename,
    metadata->>'title' as title,
    metadata->>'updated_version' as updated
FROM artifacts 
WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
  AND type = 'pdf'
ORDER BY version;

-- Test the diff scenarios we expect the API to handle
SELECT '=== Expected Diff Test Scenarios ===' as info;
SELECT 
    'Scenario 1: PDF metadata diff' as scenario,
    'Compare v2 vs v1 - should show title change and new updated_version field' as description;

SELECT 
    'Scenario 2: Invalid artifact comparison' as scenario,
    'Try to compare different roles - should be rejected' as description;

SELECT 
    'Scenario 3: Version not found' as scenario,
    'Compare with non-existent version - should return 404' as description;

-- Get artifact IDs for API testing
SELECT '=== Artifact IDs for API Testing ===' as info;
SELECT 
    'PDF v1 (old)' as label,
    id,
    version,
    is_current
FROM artifacts 
WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
  AND type = 'pdf'
  AND version = (SELECT MIN(version) FROM artifacts WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02' AND type = 'pdf')

UNION ALL

SELECT 
    'PDF v2 (current)' as label,
    id,
    version,
    is_current
FROM artifacts 
WHERE job_id = 'a6782466-68bb-4dc0-acdd-e29e59900f02'
  AND type = 'pdf'
  AND is_current = true;
