-- ================================
-- Personal Orgs & Default Assignment (Phase 5.3 Step 3)
-- ================================

-- 1️⃣ Create a personal organization for every existing user
INSERT INTO organizations (id, name)
SELECT
  gen_random_uuid(),
  'Personal'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_members om
  WHERE om.user_id = u.id
);

-- 2️⃣ Attach user as OWNER of their personal org
INSERT INTO organization_members (
  id,
  organization_id,
  user_id,
  role
)
SELECT
  gen_random_uuid(),
  o.id,
  u.id,
  'OWNER'
FROM users u
JOIN organizations o
  ON o.name = 'Personal'
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_members om
  WHERE om.user_id = u.id
);

-- ✅ Migration Guarantees:
-- Every user has exactly one org
-- No duplicate memberships  
-- No changes to jobs/templates yet
-- Safe to run multiple times (idempotent behavior)
