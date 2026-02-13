-- Phase 8.5.3 Test Data Setup
-- Create test artifacts with different versions for diff testing

-- Clean up any existing test data
DELETE FROM artifacts WHERE job_id = '00000000-0000-0000-0000-000000000003';

-- Create test job and task
INSERT INTO jobs (id, user_id, title, input, status, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  (SELECT id FROM users LIMIT 1),
  'Phase 8.5.3 Diff Test Job',
  '{"test": "diff_testing"}',
  'RUNNING',
  now()
);

INSERT INTO tasks (id, job_id, name, status, agent_type, payload, order_index, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000003',
  'Chart Test Task',
  'SUCCESS',
  'chart',
  '{}',
  1,
  now()
);

-- Version 1: Basic chart
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    'test-chart-v1',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000003',
    'chart',
    'latency_p95',
    'latency_v1.png',
    'test/latency_v1.png',
    'image/png',
    true,
    '{
      "title": "Latency P95",
      "chart_type": "line",
      "data_points": 3,
      "points": [
        {"x": "2026-01-01", "y": 120},
        {"x": "2026-01-02", "y": 130},
        {"x": "2026-01-03", "y": 125}
      ],
      "labels": {
        "x_label": "Date",
        "y_label": "Latency (ms)"
      },
      "role": "latency_p95"
    }',
    1,
    false,
    NULL,
    now()
);

-- Version 2: Modified chart (new title + added point)
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    'test-chart-v2',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000003',
    'chart',
    'latency_p95',
    'latency_v2.png',
    'test/latency_v2.png',
    'image/png',
    true,
    '{
      "title": "Latency P95 (rolling avg)",
      "chart_type": "line",
      "data_points": 4,
      "points": [
        {"x": "2026-01-01", "y": 120},
        {"x": "2026-01-02", "y": 130},
        {"x": "2026-01-03", "y": 125},
        {"x": "2026-01-04", "y": 140}
      ],
      "labels": {
        "x_label": "Date",
        "y_label": "Latency (ms)"
      },
      "role": "latency_p95"
    }',
    2,
    true,
    'test-chart-v1',
    now()
);

-- Version 3: Different chart type (bar instead of line)
INSERT INTO artifacts (
    id, task_id, job_id, type, role, filename, storage_key,
    mime_type, previewable, metadata,
    version, is_current, parent_artifact_id, created_at
)
VALUES (
    'test-chart-v3',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000003',
    'chart',
    'throughput',
    'throughput_v1.png',
    'test/throughput_v1.png',
    'image/png',
    true,
    '{
      "title": "Request Throughput",
      "chart_type": "bar",
      "data_points": 3,
      "points": [
        {"x": "endpoint1", "y": 1000},
        {"x": "endpoint2", "y": 1500},
        {"x": "endpoint3", "y": 800}
      ],
      "labels": {
        "x_label": "Endpoint",
        "y_label": "Requests/sec"
      },
      "role": "throughput"
    }',
    1,
    true,
    NULL,
    now()
);

-- Verify test data
SELECT '=== Phase 8.5.3 Test Data Created ===' as info;
SELECT job_id, type, role, version, is_current, filename,
       metadata->>'title' as title,
       metadata->>'chart_type' as chart_type,
       (metadata->>'data_points')::int as data_points
FROM artifacts 
WHERE job_id = '00000000-0000-0000-0000-000000000003'
ORDER BY type, role, version;
