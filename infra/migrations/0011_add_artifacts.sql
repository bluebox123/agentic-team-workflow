CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  job_id  UUID NOT NULL REFERENCES jobs(id)  ON DELETE CASCADE,

  type TEXT NOT NULL,              -- pdf | text | image | audio (future)
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,       -- s3/minio object key

  metadata JSONB,

  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_artifacts_task_id ON artifacts(task_id);
CREATE INDEX idx_artifacts_job_id  ON artifacts(job_id);
