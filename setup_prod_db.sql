-- =================================================================
-- PRODUCTION DATABASE SETUP SCRIPT
-- =================================================================
-- Run this entire script in the Supabase SQL Editor to set up your database.
-- It combines all migration files in the correct order.

-- 1. BASE TABLES (0001_init.sql)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  title TEXT,
  input JSONB,
  status TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id),
  name TEXT,
  agent_type TEXT,
  payload JSONB,
  status TEXT,
  result JSONB,
  parent_task_id uuid,
  order_index INT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id),
  type TEXT,
  s3_key TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_logs (
  id SERIAL PRIMARY KEY,
  task_id uuid REFERENCES tasks(id),
  level TEXT,
  message TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- 2. JOB SCHEDULES (005_job_schedules.sql)
CREATE TABLE job_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('once', 'delayed', 'cron')),
  cron_expr TEXT,
  run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (job_id)
);

CREATE INDEX idx_job_schedules_next_run
  ON job_schedules (next_run_at)
  WHERE enabled = true;

-- 3. WORKFLOW TEMPLATES (006_workflow_templates.sql)
CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  dag JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, version)
);

CREATE INDEX idx_workflow_templates_owner ON workflow_templates (owner_id);
CREATE INDEX idx_workflow_template_versions_template ON workflow_template_versions (template_id);

-- 4. ORGANIZATIONS (007_organizations.sql)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_organization_members_organization ON organization_members (organization_id);
CREATE INDEX idx_organization_members_user ON organization_members (user_id);
CREATE INDEX idx_organization_members_role ON organization_members (role);

-- 5. ATTACH ORGS (008_attach_orgs.sql)
ALTER TABLE jobs ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE workflow_templates ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_jobs_org ON jobs (organization_id);
CREATE INDEX idx_workflow_templates_org ON workflow_templates (organization_id);

-- 6. PERSONAL ORGS MIGRATION (009_personal_orgs.sql)
-- (Safe to run even if empty)
INSERT INTO organizations (id, name)
SELECT gen_random_uuid(), 'Personal'
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id);

INSERT INTO organization_members (id, organization_id, user_id, role)
SELECT gen_random_uuid(), o.id, u.id, 'OWNER'
FROM users u
JOIN organizations o ON o.name = 'Personal'
WHERE NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id);

-- 7. JOB PROVENANCE (010_job_provenance.sql)
ALTER TABLE jobs ADD COLUMN template_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN template_version INTEGER;

-- 8. ARTIFACTS (0011_add_artifacts.sql)
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  job_id  UUID NOT NULL REFERENCES jobs(id)  ON DELETE CASCADE,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_artifacts_task_id ON artifacts(task_id);
CREATE INDEX idx_artifacts_job_id  ON artifacts(job_id);

-- 9. RICH ARTIFACTS (0012_add_rich_artifacts.sql)
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS previewable BOOLEAN DEFAULT false;
-- Note: metadata was already added in 0011, but 0012 adds defaults? No, 0011 has metadata JSONB.
-- 0012 sets default '{}'.
ALTER TABLE artifacts ALTER COLUMN metadata SET DEFAULT '{}';
-- Backfill
UPDATE artifacts SET mime_type = 'application/pdf', previewable = true WHERE type = 'pdf' AND mime_type IS NULL;

-- 10. ARTIFACT ROLES (0013_add_artifact_roles.sql)
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS role TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_artifact_role ON artifacts (job_id, type, role) WHERE role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_role ON artifacts (job_id, type, role) WHERE role IS NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_artifact_role') THEN
        ALTER TABLE artifacts ADD CONSTRAINT valid_artifact_role CHECK (role IS NULL OR (role ~ '^[a-z][a-z0-9_]*$'));
    END IF;
END $$;

-- 11. ARTIFACT VERSIONING (0014_artifact_versioning.sql)
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS parent_artifact_id UUID REFERENCES artifacts(id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_current_artifact ON artifacts (job_id, type, COALESCE(role, '')) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_artifacts_version_lookup ON artifacts (job_id, type, role, version DESC);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_artifact_version') THEN
        ALTER TABLE artifacts ADD CONSTRAINT valid_artifact_version CHECK (version > 0);
    END IF;
END $$;

-- 12. ARTIFACT LIFECYCLE (0015_artifact_lifecycle.sql)
ALTER TABLE artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE artifacts ADD COLUMN frozen_at TIMESTAMP;
ALTER TABLE artifacts ADD COLUMN promoted_from UUID REFERENCES artifacts(id);
CREATE UNIQUE INDEX uniq_frozen_artifact ON artifacts (job_id, type, role) WHERE status = 'frozen';

-- 13. AUDIT LOGS (0016_audit_logs.sql)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- =================================================================
-- END OF SETUP SCRIPT
-- =================================================================
