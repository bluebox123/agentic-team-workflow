-- Verification script for organizations migration
-- Run this after applying 007_organizations.sql to verify everything works

-- 1. Check organizations table exists and has correct structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'organizations' 
ORDER BY ordinal_position;

-- 2. Check organization_members table exists and has correct structure  
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'organization_members'
ORDER BY ordinal_position;

-- 3. Verify role constraint exists
SELECT conname, contype, consrc
FROM pg_constraint 
WHERE conrelid = 'organization_members'::regclass 
AND contype = 'c';

-- 4. Verify foreign key constraints
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name IN ('organizations', 'organization_members');

-- 5. Verify indexes were created
SELECT 
    indexname, 
    indexdef
FROM pg_indexes 
WHERE tablename IN ('organizations', 'organization_members')
AND schemaname = 'public';

-- 6. Test that we can create an organization (dry run)
-- This should succeed without errors
BEGIN;
INSERT INTO organizations (id, name) 
VALUES (gen_random_uuid(), 'Test Organization') 
ON CONFLICT DO NOTHING;
ROLLBACK;

-- 7. Test that we can add a member (dry run)  
-- This should succeed without errors
BEGIN;
INSERT INTO organization_members (id, organization_id, user_id, role)
VALUES (
    gen_random_uuid(), 
    gen_random_uuid(), 
    gen_random_uuid(), 
    'OWNER'
) ON CONFLICT DO NOTHING;
ROLLBACK;

-- 8. Verify existing tables are untouched
SELECT 'users' as table_name, count(*) as row_count FROM users
UNION ALL
SELECT 'jobs' as table_name, count(*) as row_count FROM jobs
UNION ALL  
SELECT 'tasks' as table_name, count(*) as row_count FROM tasks
UNION ALL
SELECT 'workflow_templates' as table_name, count(*) as row_count FROM workflow_templates
UNION ALL
SELECT 'workflow_template_versions' as table_name, count(*) as row_count FROM workflow_template_versions;
