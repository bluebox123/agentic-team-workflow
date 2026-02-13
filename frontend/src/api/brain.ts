
import { api } from "./client";

export interface AgentCapability {
    id: string;
    name: string;
    description: string;
    category: "input" | "process" | "output" | "control";
    inputs: {
        name: string;
        type: string;
        description: string;
        required?: boolean;
    }[];
    outputs: {
        name: string;
        type: string;
        description: string;
    }[];
}

export interface WorkflowNode {
    id: string;
    agentType: string;
    inputs: Record<string, any>;
    dependencies: string[];
    outputMapping?: Record<string, string>;
}

export interface WorkflowEdge {
    from: string;
    to: string;
}

export interface WorkflowDAG {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    executionOrder: string[];
}

export interface BrainAnalysisResult {
    canExecute: boolean;
    reasonIfCannot: string | null;
    workflow?: WorkflowDAG;
    explanation?: string;
}

export async function getAgents(): Promise<AgentCapability[]> {
    const res = await api.get("/brain/agents");
    return res.data;
}

export async function analyzeRequest(prompt: string): Promise<BrainAnalysisResult> {
    const res = await api.post("/brain/analyze", { prompt });
    return res.data;
}
