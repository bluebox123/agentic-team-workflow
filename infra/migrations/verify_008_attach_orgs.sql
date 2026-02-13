-- Verification script for 008_attach_orgs.sql migration
-- Run this after applying the migration to verify safety and correctness

-- 1. Verify organization_id columns were added correctly
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE column_name = 'organization_id' 
AND table_name IN ('jobs', 'workflow_templates')
ORDER BY table_name;

-- 2. Verify foreign key constraints exist and are correct
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name IN ('jobs', 'workflow_templates')
AND kcu.column_name = 'organization_id';

-- 3. Verify indexes were created
SELECT 
    indexname, 
    indexdef,
    tablename
FROM pg_indexes 
WHERE tablename IN ('jobs', 'workflow_templates')
AND indexdef LIKE '%organization_id%'
ORDER BY tablename, indexname;

-- 4. CRITICAL: Verify all existing data has NULL organization_id (safety check)
SELECT 
    'jobs' as table_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN organization_id IS NULL THEN 1 END) as null_org_count,
    COUNT(CASE WHEN organization_id IS NOT NULL THEN 1 END) as non_null_org_count
FROM jobs

UNION ALL

SELECT 
    'workflow_templates' as table_name,
    COUNT(*) as total_rows,
    COUNT(CASE WHEN organization_id IS NULL THEN 1 END) as null_org_count,
    COUNT(CASE WHEN organization_id IS NOT NULL THEN 1 END) as non_null_org_count
FROM workflow_templates;

-- 5. Verify existing functionality is preserved (test queries that should still work)
-- These queries represent existing patterns that must continue working

-- 5a. Jobs by user_id (existing pattern)
-- This should work exactly as before
EXPLAIN (FORMAT JSON)
SELECT id, title, status, created_at
FROM jobs 
WHERE user_id = $1
ORDER BY created_at DESC;

-- 5b. Workflow templates by owner_id (existing pattern)  
-- This should work exactly as before
EXPLAIN (FORMAT JSON)
SELECT id, name, description, created_at
FROM workflow_templates 
WHERE owner_id = $1
ORDER BY created_at DESC;

-- 6. Test future org-aware queries (should work but return no results yet)
-- These verify the new columns are ready for Step 3

-- 6a. Jobs by organization_id (future pattern)
-- Should work but return empty for now
SELECT COUNT(*) as org_job_count
FROM jobs 
WHERE organization_id IS NOT NULL;

-- 6b. Templates by organization_id (future pattern)
-- Should work but return empty for now  
SELECT COUNT(*) as org_template_count
FROM workflow_templates 
WHERE organization_id IS NOT NULL;

-- 7. Verify no unintended side effects on related tables
-- Tasks and schedules should be untouched (inherit org through jobs)

SELECT 'tasks' as table_name, column_name, data_type
FROM information_schema.columns 
WHERE table_name = 'tasks' 
AND column_name LIKE '%organization%'
UNION ALL
SELECT 'job_schedules' as table_name, column_name, data_type  
FROM information_schema.columns 
WHERE table_name = 'job_schedules'
AND column_name LIKE '%organization%';

-- 8. Performance check - ensure indexes are being used
-- This should show the new indexes are available for the optimizer
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('jobs', 'workflow_templates')
ORDER BY tablename, indexname;
