// Phase 8.5.3 Diff Test
// Test the diff functionality directly

import { diffArtifacts } from './dist/artifacts/diff.js';

// Test artifacts (simulating database rows)
const artifactV1 = {
  id: 'test-v1',
  task_id: 'task-1',
  job_id: 'job-1',
  type: 'chart',
  role: 'latency_p95',
  filename: 'latency_v1.png',
  storage_key: 'test/latency_v1.png',
  mime_type: 'image/png',
  previewable: true,
  metadata: {
    title: 'Latency P95',
    chart_type: 'line',
    data_points: 3,
    points: [
      { x: '2026-01-01', y: 120 },
      { x: '2026-01-02', y: 130 },
      { x: '2026-01-03', y: 125 }
    ],
    labels: {
      x_label: 'Date',
      y_label: 'Latency (ms)'
    },
    role: 'latency_p95'
  },
  version: 1,
  is_current: false,
  created_at: '2026-01-08T12:00:00Z'
};

const artifactV2 = {
  id: 'test-v2',
  task_id: 'task-1',
  job_id: 'job-1',
  type: 'chart',
  role: 'latency_p95',
  filename: 'latency_v2.png',
  storage_key: 'test/latency_v2.png',
  mime_type: 'image/png',
  previewable: true,
  metadata: {
    title: 'Latency P95 (rolling avg)',
    chart_type: 'line',
    data_points: 4,
    points: [
      { x: '2026-01-01', y: 120 },
      { x: '2026-01-02', y: 130 },
      { x: '2026-01-03', y: 125 },
      { x: '2026-01-04', y: 140 }
    ],
    labels: {
      x_label: 'Date',
      y_label: 'Latency (ms)'
    },
    role: 'latency_p95'
  },
  version: 2,
  is_current: true,
  parent_artifact_id: 'test-v1',
  created_at: '2026-01-08T13:00:00Z'
};

// Test 1: Normal chart diff
console.log('=== Test 1: Chart Diff ===');
try {
  const diff = diffArtifacts(artifactV1, artifactV2);
  console.log('✅ Chart diff successful:');
  console.log(JSON.stringify(diff, null, 2));
} catch (error) {
  console.log('❌ Chart diff failed:', error.message);
}

// Test 2: Different roles (should fail)
console.log('\n=== Test 2: Different Roles (Should Fail) ===');
const differentRole = {
  ...artifactV2,
  role: 'throughput'
};

try {
  const diff = diffArtifacts(artifactV1, differentRole);
  console.log('❌ Should have failed but passed:', diff);
} catch (error) {
  console.log('✅ Correctly rejected different roles:', error.message);
}

// Test 3: Different types (should fail)
console.log('\n=== Test 3: Different Types (Should Fail) ===');
const differentType = {
  ...artifactV2,
  type: 'pdf'
};

try {
  const diff = diffArtifacts(artifactV1, differentType);
  console.log('❌ Should have failed but passed:', diff);
} catch (error) {
  console.log('✅ Correctly rejected different types:', error.message);
}

// Test 4: PDF metadata diff
console.log('\n=== Test 4: PDF Metadata Diff ===');
const pdfV1 = {
  id: 'pdf-v1',
  task_id: 'task-1',
  job_id: 'job-1',
  type: 'pdf',
  role: 'report',
  filename: 'report_v1.pdf',
  storage_key: 'test/report_v1.pdf',
  mime_type: 'application/pdf',
  previewable: true,
  metadata: {
    pages: 10,
    embedded_artifacts: 2,
    section_count: 5
  },
  version: 1,
  is_current: false,
  created_at: '2026-01-08T12:00:00Z'
};

const pdfV2 = {
  id: 'pdf-v2',
  task_id: 'task-1',
  job_id: 'job-1',
  type: 'pdf',
  role: 'report',
  filename: 'report_v2.pdf',
  storage_key: 'test/report_v2.pdf',
  mime_type: 'application/pdf',
  previewable: true,
  metadata: {
    pages: 12,
    embedded_artifacts: 3,
    section_count: 6
  },
  version: 2,
  is_current: true,
  parent_artifact_id: 'pdf-v1',
  created_at: '2026-01-08T13:00:00Z'
};

try {
  const diff = diffArtifacts(pdfV1, pdfV2);
  console.log('✅ PDF diff successful:');
  console.log(JSON.stringify(diff, null, 2));
} catch (error) {
  console.log('❌ PDF diff failed:', error.message);
}

console.log('\n=== Phase 8.5.3 Diff Testing Complete ===');
