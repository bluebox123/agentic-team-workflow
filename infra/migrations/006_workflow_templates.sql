-- ================================
-- Workflow Templates (Phase 5.2)
-- ================================

-- Template identity & ownership
CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One row per version of a template
CREATE TABLE workflow_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL
    REFERENCES workflow_templates(id)
    ON DELETE CASCADE,

  version INTEGER NOT NULL,

  -- DAG definition (same structure as job creation input)
  dag JSONB NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  UNIQUE (template_id, version)
);

-- Speed up template listing per user
CREATE INDEX idx_workflow_templates_owner
  ON workflow_templates (owner_id);

-- Speed up version lookups
CREATE INDEX idx_workflow_template_versions_template
  ON workflow_template_versions (template_id);
