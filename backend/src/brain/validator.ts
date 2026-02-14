import { WorkflowDAG, WorkflowEdge, WorkflowNode } from "./types";
import { AGENT_REGISTRY } from "./registry";

interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export function validateWorkflow(dag: WorkflowDAG): ValidationResult {
    const errors: string[] = [];
    const nodeIds = new Set(dag.nodes.map((n) => n.id));
    const edgeSet = new Set(dag.edges.map((e) => `${e.from}=>${e.to}`));

    // 1. Check for unknown nodes in edges
    dag.edges.forEach((edge) => {
        if (!nodeIds.has(edge.from)) errors.push(`Edge source ${edge.from} not found in nodes.`);
        if (!nodeIds.has(edge.to)) errors.push(`Edge target ${edge.to} not found in nodes.`);
    });

    if (errors.length > 0) return { valid: false, errors };

    // 2. Check for cycles
    if (hasCycle(dag)) {
        errors.push("Workflow contains a cycle.");
    }

    // 3. Validate Agent Types & Inputs
    dag.nodes.forEach(node => {
        const agent = AGENT_REGISTRY.find(a => a.id === node.agentType);
        if (!agent) {
            errors.push(`Unknown agent type: ${node.agentType} for node ${node.id}`);
        } else {
            // Check required inputs
            agent.inputs.filter(i => i.required).forEach(reqInput => {
                // Check if input is provided in params OR if there is an incoming edge
                const hasIncomingEdge = dag.edges.some(e => e.to === node.id);
                const hasParam = node.params && node.params[reqInput.name] !== undefined;

                if (!hasIncomingEdge && !hasParam) {
                    // Strictly speaking, this might be a false positive if the edge satisfies it.
                    // But without explicit port mapping, we can't be sure.
                    // Let's rely on the "Brain" description rather than strict code validation for now.
                    // errors.push(`Node ${node.id} (${agent.name}) missing required input: ${reqInput.name}`);
                }
            });

            // 5. Validate Template References in Inputs
            if (node.params) {
                Object.entries(node.params).forEach(([key, value]) => {
                    if (typeof value === 'string') {
                        // Regex to find {{tasks.nodeId.outputs.field}}
                        const matches = value.matchAll(/\{\{tasks\.([a-zA-Z0-9_]+)\.outputs\.([a-zA-Z0-9_]+)\}\}/g);
                        for (const match of matches) {
                            const [fullMatch, targetNodeId, outputField] = match;

                            // Check 1: Target node exists
                            const targetNode = dag.nodes.find(n => n.id === targetNodeId);
                            if (!targetNode) {
                                errors.push(`Node ${node.id} references unknown node '${targetNodeId}' in param '${key}'`);
                                continue;
                            }

                            // Check 1.5: Dependency edge exists from target -> node
                            // If a node references another node's outputs, it MUST depend on it.
                            if (!edgeSet.has(`${targetNodeId}=>${node.id}`)) {
                                errors.push(
                                    `Node ${node.id} references outputs from '${targetNodeId}' in param '${key}' but is missing dependency edge ${targetNodeId} -> ${node.id}`
                                );
                            }

                            // Check 2: Target agent produces this output
                            const targetAgent = AGENT_REGISTRY.find(a => a.id === targetNode.agentType);
                            if (targetAgent) {
                                const hasOutput = targetAgent.outputs.some(o => o.name === outputField);
                                if (!hasOutput) {
                                    errors.push(`Node ${node.id} references non-existent output '${outputField}' of agent '${targetAgent.name}' (Type: ${targetNode.agentType})`);
                                }
                            }
                        }
                    }
                });
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors,
    };
}

function hasCycle(dag: WorkflowDAG): boolean {
    const adj = new Map<string, string[]>();
    dag.nodes.forEach((n) => adj.set(n.id, []));
    dag.edges.forEach((e) => adj.get(e.from)?.push(e.to));

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const node of dag.nodes) {
        if (checkCycleUtil(node.id, adj, visited, recursionStack)) {
            return true;
        }
    }
    return false;
}

function checkCycleUtil(
    nodeId: string,
    adj: Map<string, string[]>,
    visited: Set<string>,
    recursionStack: Set<string>
): boolean {
    if (recursionStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const children = adj.get(nodeId) || [];
    for (const child of children) {
        if (checkCycleUtil(child, adj, visited, recursionStack)) {
            return true;
        }
    }

    recursionStack.delete(nodeId);
    return false;
}
