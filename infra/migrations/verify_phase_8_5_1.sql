-- Phase 8.5.1 Verification Script
-- Run this to verify artifact versioning migration is complete

-- 1. Verify no NULL versions (should return 0)
SELECT 'NULL versions check' as test, COUNT(*) as count 
FROM artifacts 
WHERE version IS NULL;

-- 2. Verify only one current artifact per group (should return 0 rows)
SELECT 'Duplicate current artifacts check' as test, job_id, type, role, COUNT(*) as count
FROM artifacts 
WHERE is_current = TRUE 
GROUP BY job_id, type, role 
HAVING COUNT(*) > 1;

-- 3. Verify version constraints are in place (should return 1 row each)
SELECT 'Version constraint check' as test, COUNT(*) as count
FROM pg_constraint 
WHERE conname = 'valid_artifact_version';

SELECT 'Role constraint check' as test, COUNT(*) as count
FROM pg_constraint 
WHERE conname = 'valid_artifact_role';

-- 4. Verify indexes are created (should return 1 row each)
SELECT 'Current artifact index check' as test, COUNT(*) as count
FROM pg_indexes 
WHERE indexname = 'uniq_current_artifact';

SELECT 'Version lookup index check' as test, COUNT(*) as count
FROM pg_indexes 
WHERE indexname = 'idx_artifacts_version_lookup';

-- 5. Show current artifact state
SELECT 'Current artifact summary' as test, 
       job_id, type, role, 
       COUNT(*) as total_versions,
       COUNT(*) FILTER (WHERE is_current = TRUE) as current_versions
FROM artifacts 
GROUP BY job_id, type, role 
ORDER BY job_id, type, role;

-- 6. Sample artifact versions (showing versioning works)
SELECT 'Sample artifact versions' as test,
       id, version, is_current, parent_artifact_id,
       job_id, type, role, created_at
FROM artifacts 
ORDER BY job_id, type, role, version DESC
LIMIT 10;
