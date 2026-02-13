-- ================================
-- Attach Organizations to Existing Entities (Phase 5.3 Step 2)
-- ================================

-- Design Principles:
-- ✅ Existing jobs keep working
-- ✅ Existing templates keep working  
-- ✅ Single-user mode keeps working
-- ❌ No forced migration yet
-- ❌ No auth logic changes yet

-- 1️⃣ Attach orgs to jobs (safe, nullable)
ALTER TABLE jobs
ADD COLUMN organization_id UUID
  REFERENCES organizations(id)
  ON DELETE SET NULL;

-- 2️⃣ Attach orgs to workflow_templates (safe, nullable)
ALTER TABLE workflow_templates
ADD COLUMN organization_id UUID
  REFERENCES organizations(id)
  ON DELETE SET NULL;

-- 3️⃣ Performance indexes (non-blocking, future-ready)
CREATE INDEX idx_jobs_org
  ON jobs (organization_id);

CREATE INDEX idx_workflow_templates_org
  ON workflow_templates (organization_id);

-- 🧠 Behavioral Contract:
-- NULL organization_id = personal/legacy (works exactly like before)
-- non-NULL organization_id = org-owned (future org-aware behavior)

-- 🎯 Safety Guarantees:
-- ✔ Nullable columns - no existing data affected
-- ✔ No defaults - no automatic changes
-- ✔ No backfill - existing rows remain NULL
-- ✔ ON DELETE SET NULL - safe cleanup
-- ✔ Indexes only - performance only, no behavior change
