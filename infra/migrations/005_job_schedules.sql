-- 005_job_schedules.sql
-- Job scheduling metadata

CREATE TABLE job_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  -- Scheduling type
  -- 'once'     → run exactly one time
  -- 'delayed'  → run once at a future time
  -- 'cron'     → recurring
  type TEXT NOT NULL CHECK (type IN ('once', 'delayed', 'cron')),

  -- Cron expression (only for cron schedules)
  cron_expr TEXT,

  -- Used for once / delayed execution
  run_at TIMESTAMP WITH TIME ZONE,

  -- Computed next execution time (cron or delayed)
  next_run_at TIMESTAMP WITH TIME ZONE,

  -- Enable / disable schedule without deleting it
  enabled BOOLEAN NOT NULL DEFAULT true,

  -- Bookkeeping
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- One schedule per job (enforced)
  UNIQUE (job_id)
);

-- Speed up scheduler scans
CREATE INDEX idx_job_schedules_next_run
  ON job_schedules (next_run_at)
  WHERE enabled = true;
