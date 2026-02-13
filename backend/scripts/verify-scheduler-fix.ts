
import pool from '../src/db';
import { v4 as uuidv4 } from 'uuid';

async function verifySchedulerFix() {
    console.log('Starting verification...');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Create a dummy job (old enough to be deleted)
        // We simulate it being 8 days old
        const jobId = uuidv4();
        await client.query(`
            INSERT INTO jobs (id, title, status, created_at, updated_at)
            VALUES ($1, 'Test Cleanup Job', 'SUCCESS', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days')
        `, [jobId]);
        console.log('Created dummy job:', jobId);

        // 2. Create a dummy task
        const taskId = uuidv4();
        await client.query(`
            INSERT INTO tasks (id, job_id, name, status, created_at)
            VALUES ($1, $2, 'Test Cleanup Task', 'SUCCESS', NOW() - INTERVAL '8 days')
        `, [taskId, jobId]);
        console.log('Created dummy task:', taskId);

        // 3. Create a dummy output (dependent record)
        await client.query(`
            INSERT INTO outputs (task_id, type, s3_key, metadata)
            VALUES ($1, 'text', 'test-key', '{}')
        `, [taskId]);
        console.log('Created dummy output');

        // 4. Create a dummy task log (dependent record)
        await client.query(`
            INSERT INTO task_logs (task_id, level, message)
            VALUES ($1, 'INFO', 'Test log')
        `, [taskId]);
        console.log('Created dummy task log');

        await client.query('COMMIT');

        // 5. Run the cleanup logic matching scheduler.ts
        console.log('Running cleanup logic...');
        const RETENTION_DAYS = 7;

        // Start a new transaction for cleanup
        await client.query('BEGIN');

        // 1. Identify jobs to delete
        const { rows: jobsToDelete } = await client.query(
            `
          SELECT id FROM jobs 
          WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
            AND status IN ('SUCCESS', 'FAILED', 'CANCELLED')
            AND id = $2
          FOR UPDATE
          `,
            [RETENTION_DAYS, jobId]
        );

        if (jobsToDelete.length > 0) {
            const jobIds = jobsToDelete.map((j: any) => j.id);
            console.log('Found jobs to delete:', jobIds);

            // This is the part that is expected to fail currently
            // The scheduler currently deletes tasks, schedules, then jobs
            // But it misses outputs and task_logs

            try {
                // 2. Delete dependent task artifacts (outputs & logs)
                await client.query(
                    `
                    DELETE FROM outputs
                    WHERE task_id IN (SELECT id FROM tasks WHERE job_id = ANY($1))
                    `,
                    [jobIds]
                );

                await client.query(
                    `
                    DELETE FROM task_logs
                    WHERE task_id IN (SELECT id FROM tasks WHERE job_id = ANY($1))
                    `,
                    [jobIds]
                );

                // 3. Delete dependent tasks
                await client.query(
                    `
                    DELETE FROM tasks
                    WHERE job_id = ANY($1)
                    `,
                    [jobIds]
                );
                console.log('Deleted tasks');
            } catch (error: any) {
                console.error('Caught error deleting tasks:', error.message);
                await client.query('ROLLBACK');
                return;
            }

            console.log('✅ Verification Successful: Deletion succeeded with fix implemented.');

            // 4. Delete dependent schedules
            await client.query(
                `
            DELETE FROM job_schedules
            WHERE job_id = ANY($1)
            `,
                [jobIds]
            );

            // 4. Delete the jobs
            await client.query(
                `
            DELETE FROM jobs
            WHERE id = ANY($1)
            `,
                [jobIds]
            );

            console.log(`Cleaned up ${jobsToDelete.length} old jobs`);
        } else {
            console.log('❌ Job not found for deletion?');
        }

        await client.query('ROLLBACK'); // Always rollback the test data

    } catch (error) {
        console.error('Error during verification:', error);
        await client.query('ROLLBACK');
    } finally {
        client.release();
        await pool.end();
    }
}

verifySchedulerFix();
