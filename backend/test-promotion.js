// Phase 8.6: Artifact Promotion Testing
// Test all promotion scenarios and validation rules

import { promoteArtifact, getArtifactStatusHistory, getFrozenArtifacts, checkPromotionPermission } from './dist/artifacts/promotion.js';
import db from './dist/db.js';

// Test data setup
const testUserId = '00000000-0000-0000-0000-000000000123';
const testJobId = '00000000-0000-0000-0000-000000000001';
const testArtifactId = '00000000-0000-0000-0000-000000000123';

const pool = db.default;

async function setupTestData() {
  console.log('🧪 Setting up test data...');
  
  // Clean up existing test data
  await pool.query('DELETE FROM artifacts WHERE job_id = $1', [testJobId]);
  await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [testUserId]);
  
  // Create test user
  await pool.query(`
    INSERT INTO users (id, email, name, created_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (id) DO NOTHING
  `, [testUserId, 'test@example.com', 'Test User']);
  
  // Create test job
  await db.query(`
    INSERT INTO jobs (id, user_id, title, input, status, created_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
  `, [testJobId, testUserId, 'Test Job', '{}', 'RUNNING']);
  
  // Create draft artifact
  const { rows } = await pool.query(`
    INSERT INTO artifacts (
      id, task_id, job_id, type, role, filename, storage_key,
      mime_type, previewable, metadata, status, version, is_current, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 1, true, NOW())
    RETURNING *
  `, [
    testArtifactId,
    'test-task-1',
    testJobId,
    'chart',
    'latency_p95',
    'test-chart.png',
    'test/test-chart.png',
    'image/png',
    true,
    '{"title": "Test Chart"}'
  ]);
  
  console.log('✅ Test data setup complete');
  return rows[0];
}

async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...');
  await db.query('DELETE FROM artifacts WHERE job_id = $1', [testJobId]);
  await db.query('DELETE FROM audit_logs WHERE user_id = $1', [testUserId]);
  await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
  await db.query('DELETE FROM jobs WHERE id = $1', [testJobId]);
  console.log('✅ Cleanup complete');
}

async function testScenario1_DraftToApproved() {
  console.log('\n🧪 Scenario 1: Draft → Approved');
  
  try {
    const result = await promoteArtifact(testArtifactId, {
      target_status: 'approved'
    }, testUserId);
    
    console.log('✅ Draft → Approved successful:', result);
    
    // Verify artifact status
    const { rows } = await db.query(
      'SELECT status, promoted_from FROM artifacts WHERE id = $1',
      [testArtifactId]
    );
    
    if (rows[0].status === 'approved' && rows[0].promoted_from === testArtifactId) {
      console.log('✅ Artifact status correctly updated');
    } else {
      console.log('❌ Artifact status not updated correctly');
    }
    
  } catch (error) {
    console.log('❌ Draft → Approved failed:', error.message);
  }
}

async function testScenario2_ApprovedToFrozen() {
  console.log('\n🧪 Scenario 2: Approved → Frozen');
  
  try {
    const result = await promoteArtifact(testArtifactId, {
      target_status: 'frozen'
    }, testUserId);
    
    console.log('✅ Approved → Frozen successful:', result);
    
    // Verify frozen status and timestamp
    const { rows } = await db.query(
      'SELECT status, frozen_at FROM artifacts WHERE id = $1',
      [testArtifactId]
    );
    
    if (rows[0].status === 'frozen' && rows[0].frozen_at) {
      console.log('✅ Artifact correctly frozen with timestamp');
    } else {
      console.log('❌ Artifact not frozen correctly');
    }
    
  } catch (error) {
    console.log('❌ Approved → Frozen failed:', error.message);
  }
}

async function testScenario3_DraftToFrozenBlocked() {
  console.log('\n🧪 Scenario 3: Draft → Frozen (Should Be Blocked)');
  
  try {
    await promoteArtifact(testArtifactId, {
      target_status: 'frozen'
    }, testUserId);
    
    console.log('❌ Draft → Frozen should have been blocked!');
    
  } catch (error) {
    if (error.message.includes('Can only promote from approved to frozen')) {
      console.log('✅ Correctly blocked Draft → Frozen promotion');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }
}

async function testScenario4_FrozenCannotChange() {
  console.log('\n🧪 Scenario 4: Frozen Artifact Cannot Be Promoted');
  
  try {
    await promoteArtifact(testArtifactId, {
      target_status: 'approved'
    }, testUserId);
    
    console.log('❌ Frozen artifact promotion should have been blocked!');
    
  } catch (error) {
    if (error.message.includes('Frozen artifacts cannot be modified')) {
      console.log('✅ Correctly blocked promotion of frozen artifact');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }
}

async function testScenario5_OnlyOneFrozen() {
  console.log('\n🧪 Scenario 5: Only One Frozen Artifact Per Role');
  
  // Create second artifact
  const { rows } = await pool.query(`
    INSERT INTO artifacts (
      id, task_id, job_id, type, role, filename, storage_key,
      mime_type, previewable, metadata, status, version, is_current, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', 2, false, NOW())
    RETURNING *
  `, [
    'test-artifact-456',
    'test-task-2',
    testJobId,
    'chart',
    'latency_p95',
    'test-chart-2.png',
    'test/test-chart-2.png',
    'image/png',
    true,
    '{"title": "Test Chart 2"}'
  ]);
  
  const secondArtifact = rows[0];
  
  try {
    // Try to freeze second artifact (should fail due to unique constraint)
    await promoteArtifact(secondArtifact.id, {
      target_status: 'frozen'
    }, testUserId);
    
    console.log('❌ Second artifact freezing should have been blocked!');
    
  } catch (error) {
    if (error.message.includes('A frozen artifact already exists')) {
      console.log('✅ Correctly enforced unique frozen artifact constraint');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }
}

async function testScenario6_PermissionChecks() {
  console.log('\n🧪 Scenario 6: Permission Checks');
  
  // Test owner permission (should succeed)
  const ownerPermission = await checkPromotionPermission(testUserId, testArtifactId, 'approved');
  console.log('Owner permission for approve:', ownerPermission ? '✅ Granted' : '❌ Denied');
}

async function testScenario7_AuditTrail() {
  console.log('\n🧪 Scenario 7: Audit Trail Verification');
  
  // Check audit logs were created
  const { rows } = await db.query(`
    SELECT action, details, created_at 
    FROM audit_logs 
    WHERE resource_type = 'artifact' AND resource_id = $1
    ORDER BY created_at DESC
  `, [testArtifactId]);
  
  if (rows.length > 0) {
    console.log('✅ Audit trail created:');
    rows.forEach(log => {
      console.log(`  - ${log.action} at ${log.created_at}`);
    });
  } else {
    console.log('❌ No audit trail found');
  }
}

async function runAllTests() {
  console.log('🚀 Phase 8.6 Promotion Testing Started');
  
  try {
    await setupTestData();
    
    await testScenario1_DraftToApproved();
    await testScenario2_ApprovedToFrozen();
    await testScenario3_DraftToFrozenBlocked();
    await testScenario4_FrozenCannotChange();
    await testScenario5_OnlyOneFrozen();
    await testScenario6_PermissionChecks();
    await testScenario7_AuditTrail();
    
    console.log('\n✅ All Phase 8.6 tests completed');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  } finally {
    await cleanupTestData();
  }
}

// Run tests if this file is executed directly
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
  runAllTests().catch(console.error);
}

export {
  setupTestData,
  cleanupTestData,
  testScenario1_DraftToApproved,
  testScenario2_ApprovedToFrozen,
  testScenario3_DraftToFrozenBlocked,
  testScenario4_FrozenCannotChange,
  testScenario5_OnlyOneFrozen,
  testScenario6_PermissionChecks,
  testScenario7_AuditTrail,
  runAllTests
};
