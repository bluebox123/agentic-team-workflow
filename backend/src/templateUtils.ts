
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
        let rawResult: any = row.result ? row.result : {};
        // Only unwrap a { result: ... } wrapper if it looks like a pure wrapper.
        // Many tasks store additional fields alongside `result` (e.g. ok, executor, transformed).
        // Unwrapping those would break templates like tasks.transformer.outputs.result[*].name.
        if (
            rawResult &&
            typeof rawResult === "object" &&
            !Array.isArray(rawResult) &&
            "result" in rawResult &&
            Object.keys(rawResult).length === 1
        ) {
            rawResult = (rawResult as any).result;
        }
        // Normalize primitives to objects so downstream debug + template access doesn't crash.
        // Some tasks store result as a string (e.g. executor), which would break 'in' operator and Object.keys.
        if (rawResult === null || rawResult === undefined) {
            rawResult = {};
        } else if (typeof rawResult !== "object") {
            rawResult = {
                result: rawResult,
                text: typeof rawResult === "string" ? rawResult : undefined,
            };
        }

        console.log(`[TEMPLATE] Task '${row.name}': result type=${typeof row.result}, has result.result=${!!row.result?.result}`);
        console.log(`[TEMPLATE] Task '${row.name}': raw result keys=${Object.keys(rawResult).join(', ')}`);
        console.log(`[TEMPLATE] Task '${row.name}': text present=${'text' in rawResult}, text length=${rawResult.text?.length || 0}`);

        // DEBUG: Special logging for analyzer tasks
        if (row.name && (row.name.includes('analyze') || row.name.includes('analyzer'))) {
            console.log(`[TEMPLATE] ANALYZER TASK '${row.name}': full result=${JSON.stringify(row.result).substring(0, 200)}`);
            console.log(`[TEMPLATE] ANALYZER TASK '${row.name}': insights present=${'insights' in rawResult}, insights value=${rawResult.insights?.substring(0, 50)}`);
        }

        // Store the outputs with the raw result data
        // This ensures tasks.X.outputs.result works if the data has a result field
        // or tasks.X.outputs works for direct access
        context.tasks[row.name] = {
            outputs: rawResult
        };

        // Alias analyzer task names so templates remain stable even if the planner
        // chooses different node IDs like 'analyze' vs 'analyzer_node'.
        // This avoids placeholders like {{tasks.analyzer_node.outputs.insights}} showing up.
        const nameLower = String(row.name || "").toLowerCase();
        const isAnalyzerTaskName =
            nameLower === "analyze" ||
            nameLower === "analyzer" ||
            nameLower === "analyzer_node" ||
            nameLower.endsWith("_analyze") ||
            nameLower.endsWith("_analyzer") ||
            nameLower.endsWith("_analyzer_node") ||
            nameLower.includes("analyzer") ||
            nameLower.includes("analyze");

        if (isAnalyzerTaskName) {
            // Only fill alias keys if they don't already exist (avoid overwriting real tasks)
            if (!context.tasks["analyzer_node"]) {
                context.tasks["analyzer_node"] = { outputs: rawResult };
            }
            if (!context.tasks["analyze"]) {
                context.tasks["analyze"] = { outputs: rawResult };
            }
            if (!context.tasks["analyzer"]) {
                context.tasks["analyzer"] = { outputs: rawResult };
            }
            // Also alias analyze_chart since templates reference this name
            if (!context.tasks["analyze_chart"]) {
                context.tasks["analyze_chart"] = { outputs: rawResult };
            }
        }

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
        const evalExpr = (expr: string): any => {
            // Support JSONPath-like projections produced by some planners:
            // e.g. tasks.transformer.outputs.result[*].name
            // We interpret that as: getPath(...result) then map('name').
            let projectionField: string | null = null;
            const projectionMatch = expr.match(/\[\*\]\.([a-zA-Z0-9_]+)(\.|$)/);
            if (projectionMatch) {
                projectionField = projectionMatch[1];
                expr = expr.replace(/\[\*\]\.[a-zA-Z0-9_]+/g, "");
            }

            const parts = expr.split("|").map(p => p.trim()).filter(Boolean);
            if (!parts.length) return undefined;

            let val = getPath(context, parts[0]);

            if (projectionField && Array.isArray(val)) {
                val = val.map((v: any) => (v && typeof v === "object") ? v[projectionField!] : undefined);
            }

            for (let i = 1; i < parts.length; i++) {
                const op = parts[i];
                const mapMatch = op.match(/^map\((['\"])(.+?)\1\)$/);
                if (mapMatch) {
                    const field = mapMatch[2];
                    if (Array.isArray(val)) {
                        val = val.map((v: any) => (v && typeof v === "object") ? v[field] : undefined);
                    }
                    continue;
                }

                if (op === "list") {
                    // no-op, kept for compatibility with planner output
                    continue;
                }
            }
            return val;
        };

        // If the whole string is a single template, return the underlying value directly
        // so downstream tasks can receive arrays/objects instead of JSON strings.
        const whole = obj.match(/^\{\{([^}]+)\}\}$/);
        if (whole) {
            const expr = String(whole[1]).trim();
            const val = evalExpr(expr);
            console.log(`[TEMPLATE] Whole-template '${expr}' -> type=${typeof val}`);
            return val !== undefined && val !== null && val !== "" ? val : obj;
        }

        // Otherwise, do string interpolation.
        return obj.replace(/\{\{([^}]+)\}\}/g, (match, exprRaw) => {
            const expr = String(exprRaw).trim();
            const val = evalExpr(expr);
            console.log(`[TEMPLATE] Looking up expr '${expr}', got type=${typeof val}, value=${JSON.stringify(val)?.substring(0, 50)}`);
            if (val !== undefined && val !== null && val !== '') {
                const serialized = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
                console.log(`[TEMPLATE] Resolved {{${expr}}} -> ${serialized.substring(0, 80)}`);
                return serialized;
            } else {
                console.log(`[TEMPLATE] NOT FOUND or EMPTY: {{${expr}}} - val=${JSON.stringify(val)} - keeping original`);
                return match;
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
