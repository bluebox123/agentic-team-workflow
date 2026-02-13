export interface AgentInput {
    name: string;
    type: string; // e.g., 'string', 'number', 'array', 'object', 'json'
    description: string;
    required: boolean;
}

export interface AgentOutput {
    name: string;
    type: string;
    description: string;
}

export interface AgentCapability {
    id: string; // unique identifier e.g., 'scraper', 'summarizer'
    name: string;
    description: string;
    inputs: AgentInput[];
    outputs: AgentOutput[];
    category: 'input' | 'process' | 'output';
}

export interface WorkflowNode {
    id: string;
    agentType: string;
    params: Record<string, any>;
}

export interface WorkflowEdge {
    from: string;
    to: string;
}

export interface WorkflowDAG {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

export interface BrainAnalysisResult {
    canExecute: boolean;
    reasonIfCannot: string | null;
    workflow?: {
        nodes: {
            id: string;
            agentType: string;
            inputs: Record<string, any>;
            dependencies: string[];
            outputMapping: Record<string, string>; // next_node_field: this_node_output_field
        }[];
        edges: { from: string; to: string }[];
        executionOrder: string[];
    };
    explanation?: string;
}
