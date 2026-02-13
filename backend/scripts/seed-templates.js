const pool = require('../dist/db.js').default;
const { v4: uuidv4 } = require('uuid');

async function seedTemplates() {
    const client = await pool.connect();

    try {
        console.log('Seeding workflow templates...');

        // Get the first user and their default org
        const userResult = await client.query('SELECT id FROM users LIMIT 1');
        if (userResult.rows.length === 0) {
            console.log('No users found. Run the app or create-token script first.');
            return;
        }
        const userId = userResult.rows[0].id;

        // Get user's org (checking mostly for single-user dev environment assumption)
        const orgResult = await client.query('SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1', [userId]);
        let orgId = null;
        if (orgResult.rows.length > 0) {
            orgId = orgResult.rows[0].organization_id;
        }

        const templates = [
            {
                name: "Content Generation Pipeline",
                description: "Generate blog post, review it, and prepare social media snippets.",
                dag: {
                    tasks: [
                        {
                            name: "Generate Draft",
                            agent_type: "executor",
                            payload: { prompt: "Write a blog post about AI agents." }
                        },
                        {
                            name: "Review Content",
                            agent_type: "reviewer",
                            parent_task_index: 0,
                            payload: { criteria: "Check for tone and accuracy." }
                        },
                        {
                            name: "Create Social Snippets",
                            agent_type: "executor",
                            parent_task_index: 1,
                            payload: { platform: "twitter" }
                        }
                    ]
                }
            },
            {
                name: "Data Analysis Report",
                description: "Fetch data, run analysis Python script, and summarize findings.",
                dag: {
                    tasks: [
                        {
                            name: "Fetch Dataset",
                            agent_type: "executor",
                            payload: { source: "database_v2" }
                        },
                        {
                            name: "Run Analysis",
                            agent_type: "executor",
                            parent_task_index: 0,
                            payload: { script: "analyze_trends.py" }
                        },
                        {
                            name: "Summarize Results",
                            agent_type: "executor",
                            parent_task_index: 1,
                            payload: { format: "markdown" }
                        }
                    ]
                }
            },
            {
                name: "Code Review Assistant",
                description: "Analyze PR diff, check style, and suggest improvements.",
                dag: {
                    tasks: [
                        {
                            name: "Fetch PR Diff",
                            agent_type: "executor",
                            payload: { repo: "ai-workflow" }
                        },
                        {
                            name: "Style Check",
                            agent_type: "executor",
                            parent_task_index: 0,
                            payload: { linter: "eslint" }
                        },
                        {
                            name: "Suggest Improvements",
                            agent_type: "reviewer",
                            parent_task_index: 1,
                            payload: { focus: "performance" }
                        }
                    ]
                }
            }
        ];

        await client.query('BEGIN');

        for (const t of templates) {
            const templateId = uuidv4();

            // Insert Template
            await client.query(`
        INSERT INTO workflow_templates (id, owner_id, organization_id, name, description)
        VALUES ($1, $2, $3, $4, $5)
      `, [templateId, userId, orgId, t.name, t.description]);

            // Insert Version 1
            await client.query(`
        INSERT INTO workflow_template_versions (id, template_id, version, dag)
        VALUES (gen_random_uuid(), $1, 1, $2)
      `, [templateId, t.dag]);

            console.log(`Created template: ${t.name}`);
        }

        await client.query('COMMIT');
        console.log('Seeding completed successfully!');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seeding failed:', err);
    } finally {
        client.release();
        // Use timeout to allow pool to drain naturally if needed, or forced exit
        setTimeout(() => process.exit(0), 1000);
    }
}

seedTemplates();
