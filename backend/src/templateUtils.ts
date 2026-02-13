
import pool from "./db";

/**
 * Recursively substitute placeholders in an object or string
 * supported formats:
 * - {{tasks.taskName.outputs.field}}
 * - {{parent.outputs.field}}
 */
export async function resolveTaskInputs(
    jobId: string,
    taskId: string,
    parentTaskId: string | null,
    payload: any
): Promise<any> {
    // 1. Gather context (outputs of all completed tasks in the job)
    const { rows } = await pool.query(
        `
    SELECT name, result, id
    FROM tasks
    WHERE job_id = $1 AND status = 'SUCCESS'
    `,
        [jobId]
    );

    console.log(`[TEMPLATE] Resolving inputs for job ${jobId}, found ${rows.length} completed tasks:`);
    
    const context: Record<string, any> = {
        tasks: {},
        parent: null
    };

    for (const row of rows) {
        // Handle both flat and nested result structures
        // The result from DB might be: { result: actualData } or actualData directly
        const rawResult = row.result ? (row.result.result || row.result) : {};
        
        console.log(`[TEMPLATE] Task '${row.name}': result type=${typeof row.result}, has result.result=${!!row.result?.result}`);
        console.log(`[TEMPLATE] Task '${row.name}': raw result keys=${Object.keys(rawResult).join(', ')}`);
        console.log(`[TEMPLATE] Task '${row.name}': text present=${'text' in rawResult}, text length=${rawResult.text?.length || 0}`);
        
        // Store the outputs with the raw result data
        // This ensures tasks.X.outputs.result works if the data has a result field
        // or tasks.X.outputs works for direct access
        context.tasks[row.name] = {
            outputs: rawResult
        };

        if (parentTaskId && row.id === parentTaskId) {
            context.parent = {
                outputs: rawResult
            };
        }
    }
    
    console.log(`[TEMPLATE] Built context with task names: ${Object.keys(context.tasks).join(', ')}`);

    // 2. Perform substitution
    const result = substitute(payload, context);
    console.log(`[TEMPLATE] Substituted result: ${JSON.stringify(result).substring(0, 500)}`);
    return result;
}

export function substitute(obj: any, context: any): any {
    if (typeof obj === "string") {
        // Regex to match {{ path.to.value }}
        // We'll support simple dot notation
        return obj.replace(/\{\{([\w\.]+)\}\}/g, (match, path) => {
            const val = getPath(context, path);
            console.log(`[TEMPLATE] Looking up path '${path}', got type=${typeof val}, value=${JSON.stringify(val)?.substring(0, 50)}`);
            if (val !== undefined && val !== null && val !== '') {
                console.log(`[TEMPLATE] Resolved {{${path}}} -> ${String(val).substring(0, 50)}`);
                return String(val);
            } else {
                console.log(`[TEMPLATE] NOT FOUND or EMPTY: {{${path}}} - val=${JSON.stringify(val)} - keeping original`);
                return match; // keep original if not found
            }
        });
    }

    if (Array.isArray(obj)) {
        return obj.map(v => substitute(v, context));
    }

    if (obj && typeof obj === "object") {
        const out: any = {};
        for (const k of Object.keys(obj)) {
            out[k] = substitute(obj[k], context);
        }
        return out;
    }

    return obj;
}

function getPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}
