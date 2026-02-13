const pool = require('./dist/db.js').default;
const jwt = require('jsonwebtoken');

async function createToken() {
  try {
    console.log('Checking users...');
    
    // Check existing users
    const users = await pool.query('SELECT id, email FROM users LIMIT 5');
    console.log(`Found ${users.rows.length} users:`);
    users.rows.forEach(user => {
      console.log(`  - ${user.id}: ${user.email}`);
    });
    
    if (users.rows.length === 0) {
      console.log('No users found. Creating test user...');
      const testUserId = '11111111-1111-1111-1111-111111111111';
      const testEmail = 'test@example.com';
      
      await pool.query(`
        INSERT INTO users (id, email) 
        VALUES ($1, $2) 
        ON CONFLICT (id) DO NOTHING
      `, [testUserId, testEmail]);
      
      console.log(`Created test user: ${testUserId}`);
      
      // Create token for test user
      const token = jwt.sign(
        { id: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: '24h' }
      );
      
      console.log('\n=== FRESH AUTH TOKEN ===');
      console.log(token);
      console.log('========================\n');
      
    } else {
      // Create token for first existing user
      const user = users.rows[0];
      const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: '24h' }
      );
      
      console.log('\n=== FRESH AUTH TOKEN ===');
      console.log(token);
      console.log('========================\n');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Token creation failed:', error);
    process.exit(1);
  }
}

createToken();
