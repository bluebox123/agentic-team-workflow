import { Router } from "express";
import { planWorkflow } from "../brain/planner";
import { AGENT_REGISTRY } from "../brain/registry";

const router = Router();

// GET /api/brain/agents - List available agents
router.get("/agents", (req, res) => {
    res.json(AGENT_REGISTRY);
});

// POST /api/brain/analyze - Analyze user prompt and generate workflow
router.post("/analyze", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
    }

    try {
        const result = await planWorkflow(prompt);
        res.json(result);
    } catch (error) {
        console.error("Brain API Error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({
            canExecute: false,
            reasonIfCannot: `Brain error: ${errorMessage}`,
            workflow: null,
            explanation: null
        });
    }
});

export default router;
