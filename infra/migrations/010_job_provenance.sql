ALTER TABLE jobs
ADD COLUMN template_id UUID
  REFERENCES workflow_templates(id)
  ON DELETE SET NULL;

ALTER TABLE jobs
ADD COLUMN template_version INTEGER;
