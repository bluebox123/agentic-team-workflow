
import { useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    type Node,
    type Edge,
    Handle,
    MarkerType,
    Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { WorkflowDAG } from '../api/brain';

interface WorkflowVisualizerProps {
    workflow: WorkflowDAG;
    taskStatusByName?: Record<string, string>;
}

// Custom Node to display agent details with 3D styling
const AgentNode = ({
    data,
}: {
    data: { label: string; inputs: unknown; taskStatus?: string };
}) => {
    const getGradientForAgent = (label: string) => {
        if (label.includes('scraper')) return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        if (label.includes('email')) return 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        if (label.includes('summarize') || label.includes('text')) return 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
        return 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)';
    };

    const taskStatus = (data.taskStatus || '').toUpperCase();
    const isRunning = taskStatus === 'RUNNING';
    const isSuccess = taskStatus === 'SUCCESS';
    const isFailed = taskStatus === 'FAILED';
    const isPending = taskStatus === 'PENDING' || taskStatus === '';

    const borderColor = isRunning
        ? 'rgba(59, 130, 246, 0.95)'
        : isSuccess
            ? 'rgba(34, 197, 94, 0.95)'
            : isFailed
                ? 'rgba(239, 68, 68, 0.95)'
                : 'rgba(255, 255, 255, 0.28)';

    const glowColor = isRunning
        ? 'rgba(59, 130, 246, 0.55)'
        : isSuccess
            ? 'rgba(34, 197, 94, 0.45)'
            : isFailed
                ? 'rgba(239, 68, 68, 0.45)'
                : 'rgba(102, 126, 234, 0.35)';

    const statusDotClass = isRunning
        ? 'bg-blue-400 animate-pulse'
        : isSuccess
            ? 'bg-green-400'
            : isFailed
                ? 'bg-red-400'
                : isPending
                    ? 'bg-slate-300/70'
                    : 'bg-slate-300/70';

    return (
        <div
            className={`px-4 py-3 shadow-2xl rounded-lg border-2 transition-all duration-500 hover:scale-105 hover:-rotate-1 cursor-pointer group relative ${
                isRunning ? 'animate-[nodePulse_1.8s_ease-in-out_infinite]' : ''
            }`}
            style={{
                background: getGradientForAgent(data.label),
                borderColor,
                boxShadow: `0 10px 40px rgba(0, 0, 0, 0.3), 0 0 26px ${glowColor}`,
                transform: 'perspective(1000px) rotateX(2deg) rotateY(0deg)',
            }}
        >
            {isRunning && (
                <div className="absolute inset-0 rounded-lg pointer-events-none">
                    <div className="absolute inset-0 rounded-lg border-2 border-blue-400/40 animate-ping" />
                </div>
            )}
            <Handle
                type="target"
                position={Position.Top}
                className="w-3 h-3 !bg-white/80 !border-2 !border-white/50 transition-all duration-300 group-hover:!bg-yellow-400 group-hover:scale-125"
            />
            <div className="flex flex-col">
                <div className="text-base font-bold text-white drop-shadow-lg mb-1 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusDotClass}`} />
                    {data.label}
                    {taskStatus && (
                        <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-black/30 text-white/80 border border-white/10">
                            {taskStatus}
                        </span>
                    )}
                </div>
                <div className="text-[10px] text-white/80 bg-black/20 rounded px-2 py-1 backdrop-blur-sm">
                    {data.inputs && typeof data.inputs === 'object' && Object.keys(data.inputs as object).length > 0 ? (
                        <pre className="line-clamp-2 overflow-hidden">{JSON.stringify(data.inputs, null, 2)}</pre>
                    ) : (
                        <span className="italic">No inputs</span>
                    )}
                </div>
            </div>
            <Handle
                type="source"
                position={Position.Bottom}
                className="w-3 h-3 !bg-white/80 !border-2 !border-white/50 transition-all duration-300 group-hover:!bg-green-400 group-hover:scale-125"
            />
        </div>
    );
};

const nodeTypes = {
    agent: AgentNode,
};

export function WorkflowVisualizer({ workflow, taskStatusByName }: WorkflowVisualizerProps) {

    // Transform WorkflowDAG to ReactFlow nodes/edges
    const { nodes, edges } = useMemo(() => {
        const rfNodes: Node[] = [];
        const rfEdges: Edge[] = [];

        const xGap = 280;
        const yGap = 120;

        const executionOrder = workflow.executionOrder || workflow.nodes.map(n => n.id);

        // Calculate levels for better layout
        const levels = new Map<string, number>();
        const assignLevel = (nodeId: string, level: number = 0) => {
            const currentLevel = levels.get(nodeId) ?? -1;
            if (currentLevel < level) {
                levels.set(nodeId, level);
                const node = workflow.nodes.find(n => n.id === nodeId);
                if (node) {
                    workflow.edges
                        .filter(e => e.from === nodeId)
                        .forEach(e => assignLevel(e.to, level + 1));
                }
            }
        };

        // Start level assignment from root nodes
        workflow.nodes
            .filter(n => n.dependencies.length === 0)
            .forEach(n => assignLevel(n.id, 0));

        // Arrange nodes by level
        const nodesByLevel = new Map<number, string[]>();
        levels.forEach((level, nodeId) => {
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(nodeId);
        });

        executionOrder.forEach((nodeId) => {
            const node = workflow.nodes.find(n => n.id === nodeId);
            if (!node) return;

            const level = levels.get(nodeId) ?? 0;
            const nodesAtLevel = nodesByLevel.get(level) ?? [];
            const indexAtLevel = nodesAtLevel.indexOf(nodeId);

            rfNodes.push({
                id: node.id,
                type: 'agent',
                data: {
                    label: `${node.agentType}`,
                    inputs: node.inputs,
                    taskStatus: taskStatusByName?.[node.id],
                },
                position: {
                    x: level * xGap,
                    y: indexAtLevel * yGap + (indexAtLevel % 2) * 20
                }
            });
        });

        workflow.edges.forEach(edge => {
            rfEdges.push({
                id: `${edge.from}-${edge.to}`,
                source: edge.from,
                target: edge.to,
                animated: true,
                style: {
                    stroke: 'url(#edge-gradient)',
                    strokeWidth: 3,
                },
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: '#667eea',
                },
            });
        });

        return { nodes: rfNodes, edges: rfEdges };
    }, [workflow, taskStatusByName]);

    return (
        <div className="h-[450px] w-full border-2 rounded-lg overflow-hidden shadow-lg relative"
            style={{
                background: 'linear-gradient(to bottom, #0f172a 0%, #1e293b 100%)',
            }}>
            <style>
                {`@keyframes nodePulse {
                    0%, 100% { filter: saturate(1) brightness(1); }
                    50% { filter: saturate(1.2) brightness(1.12); }
                }`}
            </style>
            <svg width="0" height="0">
                <defs>
                    <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style={{ stopColor: '#667eea', stopOpacity: 1 }} />
                        <stop offset="100%" style={{ stopColor: '#764ba2', stopOpacity: 1 }} />
                    </linearGradient>
                </defs>
            </svg>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.5}
                maxZoom={1.5}
                defaultEdgeOptions={{
                    animated: true,
                }}
                className="workflow-visualizer"
            >
                <Background
                    color="#475569"
                    gap={16}
                    style={{ opacity: 0.3 }}
                />
                <Controls
                    style={{
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                    }}
                />
            </ReactFlow>
        </div>
    );
}
