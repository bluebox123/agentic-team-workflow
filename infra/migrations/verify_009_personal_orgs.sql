-- Verification script for 009_personal_orgs.sql migration
-- Run this after applying the migration to verify personal orgs are created correctly

-- 1. Verify every user has exactly one organization
SELECT 
    u.id as user_id,
    u.email,
    COUNT(om.id) as org_count,
    STRING_AGG(o.name, ', ') as org_names
FROM users u
LEFT JOIN organization_members om ON u.id = om.user_id
LEFT JOIN organizations o ON om.organization_id = o.id
GROUP BY u.id, u.email
HAVING COUNT(om.id) != 1
ORDER BY u.email;

-- Should return 0 rows - every user should have exactly 1 org

-- 2. Verify every user is OWNER of their organization
SELECT 
    u.id as user_id,
    u.email,
    o.name as org_name,
    om.role
FROM users u
JOIN organization_members om ON u.id = om.user_id
JOIN organizations o ON om.organization_id = o.id
WHERE om.role != 'OWNER'
ORDER BY u.email;

-- Should return 0 rows - every user should be OWNER

-- 3. Verify personal organizations exist
SELECT 
    COUNT(*) as personal_org_count,
    COUNT(DISTINCT o.id) as unique_personal_orgs
FROM organizations o
WHERE o.name = 'Personal';

-- Should show count of personal orgs created

-- 4. Verify no duplicate memberships
SELECT 
    user_id,
    COUNT(*) as membership_count
FROM organization_members
GROUP BY user_id
HAVING COUNT(*) > 1
ORDER BY user_id;

-- Should return 0 rows - no duplicate memberships

-- 5. Verify organization structure
SELECT 
    'organizations' as table_name,
    COUNT(*) as total_count,
    COUNT(CASE WHEN name = 'Personal' THEN 1 END) as personal_count
FROM organizations

UNION ALL

SELECT 
    'organization_members' as table_name,
    COUNT(*) as total_count,
    COUNT(CASE WHEN role = 'OWNER' THEN 1 END) as owner_count
FROM organization_members;

-- Show org and member counts

-- 6. Test getDefaultOrgId logic (dry run)
-- This simulates the orgs.ts function behavior
WITH user_default_org AS (
    SELECT 
        u.id as user_id,
        om.organization_id,
        ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY om.created_at ASC) as rn
    FROM users u
    JOIN organization_members om ON u.id = om.user_id
)
SELECT 
    user_id,
    organization_id as default_org_id
FROM user_default_org
WHERE rn = 1
ORDER BY user_id
LIMIT 5;

-- Should show each user's default org (first created)

-- 7. Verify migration is idempotent-safe
-- Count before and after running migration again
SELECT 
    'before_rerun' as state,
    (SELECT COUNT(*) FROM organizations WHERE name = 'Personal') as personal_orgs,
    (SELECT COUNT(*) FROM organization_members WHERE role = 'OWNER') as owner_members;

-- After running migration again, these counts should be unchanged
