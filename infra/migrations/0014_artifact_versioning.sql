-- Phase 8.5.1: Artifact Versioning & History
-- Enables immutable artifacts with version history while preserving current behavior

-- Add versioning columns to artifacts table
ALTER TABLE artifacts
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS parent_artifact_id UUID REFERENCES artifacts(id);

-- Create unique index to enforce only one current artifact per (job, type, role)
-- This is the core constraint that prevents duplicate "current" artifacts
-- Using COALESCE to handle NULL roles properly in unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS uniq_current_artifact
ON artifacts (job_id, type, COALESCE(role, ''))
WHERE is_current = TRUE;

-- Create index for efficient version lookups (will be used in Phase 8.5.2)
-- Orders by version DESC so latest versions come first
CREATE INDEX IF NOT EXISTS idx_artifacts_version_lookup
ON artifacts (job_id, type, role, version DESC);

-- Add comments to document the new versioning fields
COMMENT ON COLUMN artifacts.version IS 'Monotonic version number per (job, type, role) group';
COMMENT ON COLUMN artifacts.is_current IS 'Flag indicating this is the current/latest version';
COMMENT ON COLUMN artifacts.parent_artifact_id IS 'Reference to previous version, forming a version chain';

-- Add constraints to ensure data integrity (without IF NOT EXISTS for compatibility)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_artifact_version') THEN
        ALTER TABLE artifacts ADD CONSTRAINT valid_artifact_version CHECK (version > 0);
    END IF;
END $$;

-- This migration is backward compatible:
-- - Existing artifacts get version = 1, is_current = TRUE, parent_artifact_id = NULL
-- - All existing queries continue to work (they implicitly get the current version)
-- - No data rewrite needed due to DEFAULT values
-- - Phase 8.4 behavior remains unchanged

-- Verification queries (run after migration to ensure correctness):
-- 1. No NULL versions: SELECT COUNT(*) FROM artifacts WHERE version IS NULL; -- should be 0
-- 2. Only one current per group: 
--    SELECT job_id, type, role, COUNT(*) FROM artifacts 
--    WHERE is_current = TRUE GROUP BY job_id, type, role HAVING COUNT(*) > 1; -- should be 0 rows
