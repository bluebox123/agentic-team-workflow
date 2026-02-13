-- Phase 8.6.1: Artifact Lifecycle Schema Changes
-- Add lifecycle control columns and constraints

-- Add lifecycle columns to artifacts table
ALTER TABLE artifacts
ADD COLUMN status TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN frozen_at TIMESTAMP,
ADD COLUMN promoted_from UUID REFERENCES artifacts(id);

-- Create unique index for frozen artifacts
-- Ensures only one frozen artifact per (job_id, type, role)
CREATE UNIQUE INDEX uniq_frozen_artifact 
ON artifacts (job_id, type, role)
WHERE status = 'frozen';

-- Safety: Set all existing artifacts to draft status
UPDATE artifacts 
SET status = 'draft' 
WHERE status IS NULL OR status NOT IN ('draft', 'approved', 'frozen');

-- Verify the changes
SELECT '=== Phase 8.6.1 Schema Changes Applied ===' as info;

SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'artifacts' 
    AND column_name IN ('status', 'frozen_at', 'promoted_from')
ORDER BY column_name;

-- Check existing artifact statuses
SELECT 
    status,
    COUNT(*) as count
FROM artifacts 
GROUP BY status
ORDER BY status;

-- Verify frozen artifact constraint
SELECT '=== Frozen Artifact Index Created ===' as info;
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE indexname = 'uniq_frozen_artifact';
