const fs = require("fs");
const path = require("path");
const axios = require("axios");
const jwt = require("jsonwebtoken");

require("dotenv").config();

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api";

const TEST_USER = {
  sub: "550e8400-e29b-41d4-a716-446655440000",
  email: "test@example.com",
  orgId: "550e8400-e29b-41d4-a716-446655440001",
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractPromptsFromReadme(readmeText) {
  const prompts = [];
  for (let i = 1; i <= 8; i++) {
    const header = `### Prompt ${i}`;
    const idx = readmeText.indexOf(header);
    if (idx === -1) throw new Error(`Could not find ${header} in README.md`);

    const after = readmeText.slice(idx);
    // Handle both LF and CRLF and optional language tag after the fence.
    // Example: ``` or ```json
    const fenceMatch = after.match(/```[^\r\n]*\r?\n/);
    if (!fenceMatch || fenceMatch.index == null) {
      throw new Error(`Missing code fence for ${header}`);
    }
    const fenceStart = fenceMatch.index;
    const fenceContentStart = fenceStart + fenceMatch[0].length;

    const fenceEnd = after.indexOf("```", fenceContentStart);
    if (fenceEnd === -1) throw new Error(`Unclosed code fence for ${header}`);

    const prompt = after.slice(fenceContentStart, fenceEnd).trim();
    prompts.push({ id: i, prompt });
  }
  return prompts;
}

function mapWorkflowToTasks(workflow) {
  const executionOrder = workflow.executionOrder || workflow.nodes.map(n => n.id);

  const tasks = [];
  for (let index = 0; index < executionOrder.length; index++) {
    const nodeId = executionOrder[index];
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    let parentIndex = undefined;
    if (Array.isArray(node.dependencies) && node.dependencies.length > 0) {
      const dependencyIndices = node.dependencies
        .map(depId => executionOrder.indexOf(depId))
        .filter(idx => idx !== -1 && idx < index);

      if (dependencyIndices.length > 0) {
        parentIndex = Math.max(...dependencyIndices);
      }
    }

    tasks.push({
      name: node.id,
      agent_type: node.agentType,
      payload: node.inputs,
      parent_task_index: parentIndex,
    });
  }

  return tasks;
}

async function runOnePrompt(api, promptObj, gmail) {
  const promptText = promptObj.prompt.replace(/<your gmail>/gi, gmail);

  const analysisRes = await api.post("/brain/analyze", { prompt: promptText });
  const analysis = analysisRes.data;
  if (!analysis || analysis.canExecute !== true || !analysis.workflow) {
    throw new Error(`Prompt ${promptObj.id}: brain returned cannot execute: ${analysis?.reasonIfCannot || "unknown"}`);
  }

  const tasks = mapWorkflowToTasks(analysis.workflow);

  const createRes = await api.post("/jobs", {
    title: `Prompt ${promptObj.id}`,
    tasks,
  });

  const jobId = createRes.data?.jobId;
  if (!jobId) throw new Error(`Prompt ${promptObj.id}: create job did not return jobId`);

  const timeoutMs = Number(process.env.PROMPT_TIMEOUT_MS || 10 * 60 * 1000);
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Prompt ${promptObj.id}: timeout after ${timeoutMs}ms (jobId=${jobId})`);
    }

    const tasksRes = await api.get(`/jobs/${jobId}/tasks`);
    const jobTasks = tasksRes.data || [];

    const failed = jobTasks.find(t => t.status === "FAILED");
    if (failed) {
      throw new Error(`Prompt ${promptObj.id}: task FAILED name=${failed.name} id=${failed.id} (jobId=${jobId})`);
    }

    const allTerminal = jobTasks.length > 0 && jobTasks.every(t => ["SUCCESS", "FAILED", "CANCELLED", "SKIPPED"].includes(t.status));
    if (allTerminal) {
      const artifactsRes = await api.get(`/jobs/${jobId}/artifacts`);
      const artifacts = artifactsRes.data || [];

      const hasPdf = artifacts.some(a => {
        const fn = String(a.filename || "").toLowerCase();
        const mime = String(a.mime_type || "").toLowerCase();
        return fn.endsWith(".pdf") || mime === "application/pdf";
      });

      if (!hasPdf) {
        throw new Error(`Prompt ${promptObj.id}: completed but no PDF artifact found (jobId=${jobId}, artifacts=${artifacts.length})`);
      }

      return { jobId, tasks: jobTasks, artifacts };
    }

    await sleep(2500);
  }
}

async function main() {
  const readmePath = path.resolve(__dirname, "..", "README.md");
  const readmeText = fs.readFileSync(readmePath, "utf8");
  const prompts = extractPromptsFromReadme(readmeText);

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set in backend/.env");

  const token = jwt.sign(TEST_USER, secret, { expiresIn: "2h" });

  const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    timeout: 30_000,
  });

  const gmail = process.env.TEST_GMAIL || "test@example.com";

  const results = [];
  for (const p of prompts) {
    process.stdout.write(`\n[RUN] Prompt ${p.id}...\n`);
    const res = await runOnePrompt(api, p, gmail);
    process.stdout.write(`[OK] Prompt ${p.id} jobId=${res.jobId} artifacts=${res.artifacts.length}\n`);
    results.push({ id: p.id, jobId: res.jobId, artifacts: res.artifacts.length });
    await sleep(1000);
  }

  process.stdout.write("\nALL 8 PROMPTS PASSED\n");
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

main().catch(err => {
  console.error("\nRUN FAILED:\n", err?.message || err);
  process.exit(1);
});
