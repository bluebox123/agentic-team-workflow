-- Phase 8.4.1: Add artifact roles for deterministic selection

-- Add role column to artifacts table
ALTER TABLE artifacts
ADD COLUMN IF NOT EXISTS role TEXT;

-- Create unique index to enforce one artifact per role per job+type
-- This is the backbone of Phase 8.4
CREATE UNIQUE INDEX IF NOT EXISTS uniq_artifact_role
ON artifacts (job_id, type, role)
WHERE role IS NOT NULL;

-- Create regular index for faster lookups when role is present
CREATE INDEX IF NOT EXISTS idx_artifacts_role
ON artifacts (job_id, type, role)
WHERE role IS NOT NULL;

-- Add comment to document the purpose
COMMENT ON COLUMN artifacts.role IS 'Semantic role identifier for explicit artifact selection (e.g., latency_p95, throughput, accuracy_confusion_matrix)';

-- Add constraint to ensure role is a valid identifier when present (without IF NOT EXISTS for compatibility)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_artifact_role') THEN
        ALTER TABLE artifacts ADD CONSTRAINT valid_artifact_role 
        CHECK (role IS NULL OR (role ~ '^[a-z][a-z0-9_]*$'));
    END IF;
END $$;

-- This migration is backward compatible:
-- - Existing artifacts have role = NULL
-- - New artifacts can optionally specify role
-- - Unique constraint only applies when role IS NOT NULL
