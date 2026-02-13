-- Phase 8.1.1: Extend artifacts to support rich outputs

ALTER TABLE artifacts
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS previewable BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Backfill existing PDF artifacts safely
UPDATE artifacts
SET
  mime_type = 'application/pdf',
  previewable = true
WHERE
  type = 'pdf'
  AND mime_type IS NULL;
