const pool = require('./dist/db.js').default;

async function runMigrations() {
  try {
    console.log('Running migrations...');
    
    // Create organizations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✓ Organizations table created');

    // Create organization_members table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organization_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, user_id)
      )
    `);
    console.log('✓ Organization members table created');

    // Add organization_id column to workflow_templates
    await pool.query(`
      ALTER TABLE workflow_templates ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL
    `);
    console.log('✓ Workflow templates organization_id column added');

    // Add organization_id column to jobs
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL
    `);
    console.log('✓ Jobs organization_id column added');

    // Add template_id column to jobs
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL
    `);
    console.log('✓ Jobs template_id column added');

    // Add template_version column to jobs
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS template_version INTEGER
    `);
    console.log('✓ Jobs template_version column added');

    // Add reviewer fields to tasks table
    await pool.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS review_score INT,
      ADD COLUMN IF NOT EXISTS review_decision TEXT,
      ADD COLUMN IF NOT EXISTS review_feedback JSONB
    `);
    console.log('✓ Tasks reviewer fields added');

    // Add review decision constraint
    try {
      await pool.query(`
        ALTER TABLE tasks
        ADD CONSTRAINT review_decision_check
        CHECK (
          review_decision IS NULL
          OR review_decision IN ('APPROVE', 'REJECT')
        )
      `);
      console.log('✓ Tasks review decision constraint added');
    } catch (error) {
      // Postgres returns 42710 (duplicate_object) if a constraint with that name already exists.
      // Some drivers/environments may surface different codes, so also handle by checking pg_constraint.
      if (error && (error.code === '42710' || error.code === '23505')) {
        console.log('✓ Tasks review decision constraint already exists');
      } else {
        // Last resort: if the constraint exists, don't fail the deploy.
        const exists = await pool.query(
          `
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'review_decision_check'
            LIMIT 1
          `
        );
        if (exists.rowCount > 0) {
          console.log('✓ Tasks review decision constraint already exists');
        } else {
          throw error;
        }
      }
    }

    console.log('Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
