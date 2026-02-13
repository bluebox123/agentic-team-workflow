-- ================================
-- Organizations & Teams (Phase 5.3)
-- ================================

-- Organizations are first-class citizens
-- They own workflows, jobs, and schedules
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Organization membership with role-based access
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,

  user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, user_id)
);

-- Performance indexes
CREATE INDEX idx_organization_members_organization 
  ON organization_members (organization_id);

CREATE INDEX idx_organization_members_user
  ON organization_members (user_id);

CREATE INDEX idx_organization_members_role
  ON organization_members (role);
