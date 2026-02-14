import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    type Node,
    type Edge,
    Handle,
    Position,
    addEdge,
    useNodesState,
    useEdgesState,
    type Connection,
    ReactFlowProvider,
    useReactFlow,
    Panel,
    MarkerType,
    type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { 
    Trash2, 
    Settings, 
    Play, 
    Download, 
    MousePointer2,
    GripVertical,
    Plus,
    X,
    Sparkles,
    Layout,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';
import type { WorkflowDAG, WorkflowNode, WorkflowEdge } from '../api/brain';

// ============================================
// TYPES & INTERFACES
// ============================================

export type BuilderMode = 'view' | 'edit' | 'build';

interface WorkflowBuilderProps {
    workflow?: WorkflowDAG;
    mode?: BuilderMode;
    onWorkflowChange?: (workflow: WorkflowDAG) => void;
    onExecute?: (workflow: WorkflowDAG) => void;
    readOnly?: boolean;
}

interface AgentNodeData {
    label: string;
    agentType: string;
    inputs: Record<string, unknown>;
    status?: string;
    onDelete?: (id: string) => void;
    onEdit?: (id: string) => void;
}

// ============================================
// AGENT TYPE DEFINITIONS
// ============================================

interface AgentType {
    id: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    gradient: string;
    inputs: { name: string; type: string; required: boolean; description?: string }[];
}

const AGENT_TYPES: AgentType[] = [
    {
        id: 'scraper',
        name: 'Scraper',
        description: 'Extract content from web pages',
        icon: '🌐',
        color: '#667eea',
        gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        inputs: [
            { name: 'url', type: 'string', required: true, description: 'URL to scrape' },
            { name: 'selector', type: 'string', required: false, description: 'CSS selector (optional)' },
            { name: 'max_length', type: 'number', required: false, description: 'Max characters to extract' }
        ]
    },
    {
        id: 'analyzer',
        name: 'Analyzer',
        description: 'Generate insights from data or text',
        icon: '🔍',
        color: '#f093fb',
        gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        inputs: [
            { name: 'text', type: 'string', required: false, description: 'Text content to analyze' },
            { name: 'data', type: 'array', required: false, description: 'Structured data for analysis' },
            { name: 'context', type: 'string', required: false, description: 'Additional context' }
        ]
    },
    {
        id: 'chart',
        name: 'Chart',
        description: 'Create data visualizations',
        icon: '📊',
        color: '#4facfe',
        gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        inputs: [
            { name: 'data', type: 'array', required: true, description: 'Data points or series' },
            { name: 'type', type: 'string', required: true, description: 'Chart type (bar, line, pie, etc)' },
            { name: 'title', type: 'string', required: true, description: 'Chart title' },
            { name: 'x_label', type: 'string', required: false, description: 'X-axis label' },
            { name: 'y_label', type: 'string', required: false, description: 'Y-axis label' }
        ]
    },
    {
        id: 'designer',
        name: 'Designer',
        description: 'Generate PDF reports',
        icon: '🎨',
        color: '#43e97b',
        gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        inputs: [
            { name: 'sections', type: 'array', required: true, description: 'Report sections' },
            { name: 'title', type: 'string', required: true, description: 'Report title' },
            { name: 'theme', type: 'string', required: false, description: 'Color theme' },
            { name: 'artifacts', type: 'array', required: false, description: 'Chart/image references' }
        ]
    },
    {
        id: 'summarizer',
        name: 'Summarizer',
        description: 'Condense long text into summaries',
        icon: '📝',
        color: '#fa709a',
        gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        inputs: [
            { name: 'text', type: 'string', required: true, description: 'Text to summarize' },
            { name: 'max_length', type: 'number', required: false, description: 'Max summary length' }
        ]
    },
    {
        id: 'validator',
        name: 'Validator',
        description: 'Validate data against schema',
        icon: '✓',
        color: '#30cfd0',
        gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
        inputs: [
            { name: 'data', type: 'unknown', required: true, description: 'Data to validate' },
            { name: 'schema', type: 'object', required: true, description: 'Validation schema' }
        ]
    },
    {
        id: 'transformer',
        name: 'Transformer',
        description: 'Transform data formats',
        icon: '🔄',
        color: '#a8edea',
        gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        inputs: [
            { name: 'data', type: 'unknown', required: true, description: 'Data to transform' },
            { name: 'operation', type: 'string', required: true, description: 'Transform operation' }
        ]
    },
    {
        id: 'notifier',
        name: 'Notifier',
        description: 'Send notifications',
        icon: '🔔',
        color: '#ffecd2',
        gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
        inputs: [
            { name: 'message', type: 'string', required: true, description: 'Message to send' },
            { name: 'channel', type: 'string', required: true, description: 'Notification channel' }
        ]
    }
];

// ============================================
// CUSTOM NODE COMPONENT
// ============================================

const AgentNode = ({ data, selected, id }: { data: AgentNodeData; selected?: boolean; id: string }) => {
    const agentType = AGENT_TYPES.find(a => a.id === data.agentType) || AGENT_TYPES[0];
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className={cn(
                "relative px-4 py-3 rounded-xl border-2 transition-all duration-200 min-w-[180px]",
                selected ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-105" : "",
                isHovered ? "scale-102 shadow-2xl" : ""
            )}
            style={{
                background: agentType.gradient,
                borderColor: selected ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.3)',
                boxShadow: selected 
                    ? '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 30px rgba(102, 126, 234, 0.6)'
                    : '0 10px 40px rgba(0, 0, 0, 0.3), 0 0 20px rgba(102, 126, 234, 0.3)',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Target Handle */}
            <Handle
                type="target"
                position={Position.Top}
                className="!w-4 !h-4 !bg-white/90 !border-2 !border-white/60 transition-all duration-200 hover:!scale-125"
                style={{ top: -8 }}
            />
            
            {/* Node Content */}
            <div className="flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">{agentType.icon}</span>
                        {data.status === 'active' && (
                            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
                        )}
                    </div>
                    {(isHovered || selected) && (
                        <div className="flex gap-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onEdit?.(id);
                                }}
                                className="p-1 rounded bg-white/20 hover:bg-white/40 transition-colors"
                                title="Edit node"
                            >
                                <Settings className="w-3 h-3 text-white" />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onDelete?.(id);
                                }}
                                className="p-1 rounded bg-white/20 hover:bg-red-500/60 transition-colors"
                                title="Delete node"
                            >
                                <Trash2 className="w-3 h-3 text-white" />
                            </button>
                        </div>
                    )}
                </div>
                
                {/* Title */}
                <div className="text-sm font-bold text-white drop-shadow-md mb-1">
                    {agentType.name}
                </div>
                
                {/* Inputs Preview */}
                <div className="text-[10px] text-white/80 bg-black/20 rounded-lg px-2 py-1.5 backdrop-blur-sm max-h-[60px] overflow-hidden">
                    {Object.keys(data.inputs).length > 0 ? (
                        <div className="space-y-0.5">
                            {Object.entries(data.inputs).slice(0, 3).map(([key, value]) => (
                                <div key={key} className="flex items-center gap-1 truncate">
                                    <span className="text-white/60">{key}:</span>
                                    <span className="truncate font-mono">
                                        {typeof value === 'string' ? value.slice(0, 20) : JSON.stringify(value).slice(0, 20)}
                                    </span>
                                </div>
                            ))}
                            {Object.keys(data.inputs).length > 3 && (
                                <span className="text-white/40">+{Object.keys(data.inputs).length - 3} more</span>
                            )}
                        </div>
                    ) : (
                        <span className="italic opacity-60">No inputs configured</span>
                    )}
                </div>
            </div>
            
            {/* Source Handle */}
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-4 !h-4 !bg-white/90 !border-2 !border-white/60 transition-all duration-200 hover:!scale-125"
                style={{ bottom: -8 }}
            />
        </div>
    );
};

const nodeTypes: NodeTypes = {
    agent: AgentNode,
};

// ============================================
// DRAG & DROP TOOLBAR
// ============================================

function AgentToolbar() {
    const onDragStart = (event: React.DragEvent, agentType: AgentType) => {
        event.dataTransfer.setData('application/reactflow', JSON.stringify(agentType));
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className="w-64 bg-slate-900/95 border-r border-slate-700 flex flex-col">
            <div className="p-4 border-b border-slate-700">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Agent Types
                </h3>
                <p className="text-xs text-slate-400 mt-1">Drag to add nodes</p>
            </div>
            
            <ScrollArea className="flex-1 p-3">
                <div className="space-y-2">
                    {AGENT_TYPES.map((agent) => (
                        <div
                            key={agent.id}
                            draggable
                            onDragStart={(e) => onDragStart(e, agent)}
                            className="group p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 cursor-grab active:cursor-grabbing transition-all duration-200 hover:border-slate-500 hover:shadow-lg"
                        >
                            <div className="flex items-start gap-3">
                                <div 
                                    className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shadow-lg"
                                    style={{ background: agent.gradient }}
                                >
                                    {agent.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <GripVertical className="w-3 h-3 text-slate-500" />
                                        <span className="font-medium text-sm text-white truncate">
                                            {agent.name}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                                        {agent.description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

// ============================================
// PROPERTIES PANEL
// ============================================

function NodePropertiesPanel({
    node,
    onChange,
    onClose
}: {
    node: Node<AgentNodeData> | null;
    onChange: (id: string, data: AgentNodeData) => void;
    onClose: () => void;
}) {
    const agentType = node ? (AGENT_TYPES.find(a => a.id === node.data.agentType) || AGENT_TYPES[0]) : null;
    
    // Directly use node data - changes are applied immediately via onChange
    const inputs = useMemo(() => node?.data.inputs ?? {}, [node?.data.inputs]);

    const handleInputChange = useCallback((key: string, value: unknown) => {
        if (!node) return;
        const newInputs = { ...inputs, [key]: value };
        onChange(node.id, { ...node.data, inputs: newInputs });
    }, [node, inputs, onChange]);

    const handleRemoveInput = useCallback((key: string) => {
        if (!node) return;
        const newInputs = { ...inputs };
        delete newInputs[key];
        onChange(node.id, { ...node.data, inputs: newInputs });
    }, [node, inputs, onChange]);

    // If no node is selected, show empty state
    if (!node || !agentType) {
        return (
            <div className="w-80 bg-slate-900/95 border-l border-slate-700 flex flex-col">
                <div className="flex-1 flex items-center justify-center p-6 text-center">
                    <div className="text-slate-500">
                        <MousePointer2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">Select a node to edit its properties</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-80 bg-slate-900/95 border-l border-slate-700 flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div 
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
                        style={{ background: agentType.gradient }}
                    >
                        {agentType.icon}
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">{agentType.name}</h3>
                        <p className="text-xs text-slate-400">Node Properties</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {/* Node ID */}
                    <div>
                        <Label className="text-xs text-slate-400">Node ID</Label>
                        <Input 
                            value={node.id} 
                            disabled 
                            className="mt-1.5 bg-slate-800 border-slate-700 text-slate-400 text-xs"
                        />
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* Quick Inputs from Agent Template */}
                    <div>
                        <Label className="text-xs text-slate-400 mb-2 block">Quick Add Inputs</Label>
                        <div className="flex flex-wrap gap-2">
                            {agentType.inputs.map((input) => (
                                <button
                                    key={input.name}
                                    onClick={() => handleInputChange(input.name, input.type === 'string' ? '' : input.type === 'number' ? 0 : input.type === 'array' ? [] : {})}
                                    className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                                >
                                    + {input.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* Current Inputs */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <Label className="text-xs text-slate-400">Configured Inputs</Label>
                            <Badge variant="outline" className="text-[10px]">
                                {Object.keys(inputs).length}
                            </Badge>
                        </div>
                        
                        <div className="space-y-2">
                            {Object.entries(inputs).map(([key, value]) => (
                                <div key={key} className="p-2 rounded-lg bg-slate-800/50 border border-slate-700 group">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <Label className="text-xs text-white font-medium">{key}</Label>
                                        <button
                                            onClick={() => handleRemoveInput(key)}
                                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 transition-all"
                                        >
                                            <X className="w-3 h-3 text-red-400" />
                                        </button>
                                    </div>
                                    <Textarea
                                        value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                        onChange={(e) => {
                                            const newValue = e.target.value;
                                            try {
                                                // Try to parse as JSON if it looks like an object/array
                                                if (newValue.trim().startsWith('{') || newValue.trim().startsWith('[')) {
                                                    handleInputChange(key, JSON.parse(newValue));
                                                } else if (!isNaN(Number(newValue)) && newValue !== '') {
                                                    handleInputChange(key, Number(newValue));
                                                } else {
                                                    handleInputChange(key, newValue);
                                                }
                                            } catch {
                                                handleInputChange(key, newValue);
                                            }
                                        }}
                                        className="min-h-[60px] text-xs bg-slate-900 border-slate-600 font-mono"
                                    />
                                </div>
                            ))}
                            
                            {Object.keys(inputs).length === 0 && (
                                <div className="text-center py-4 text-slate-500 text-xs">
                                    No inputs configured yet
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* Add Custom Input */}
                    <div>
                        <Label className="text-xs text-slate-400 mb-2 block">Add Custom Input</Label>
                        <form 
                            onSubmit={(e) => {
                                e.preventDefault();
                                const form = e.target as HTMLFormElement;
                                const key = (form.elements.namedItem('key') as HTMLInputElement).value;
                                if (key) {
                                    handleInputChange(key, '');
                                    form.reset();
                                }
                            }}
                            className="flex gap-2"
                        >
                            <Input 
                                name="key"
                                placeholder="input_name"
                                className="flex-1 bg-slate-800 border-slate-700 text-xs"
                            />
                            <Button type="submit" size="sm" variant="secondary">
                                <Plus className="w-4 h-4" />
                            </Button>
                        </form>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}

// ============================================
// MAIN BUILDER COMPONENT
// ============================================

function FlowCanvas({
    initialWorkflow,
    onWorkflowChange,
    setSelectedNode
}: {
    initialWorkflow?: WorkflowDAG;
    onWorkflowChange?: (workflow: WorkflowDAG) => void;
    setSelectedNode: (node: Node<AgentNodeData> | null) => void;
}) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { project, fitView } = useReactFlow();
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

    // Convert initial workflow to nodes/edges
    const getInitialNodes = useCallback((): Node<AgentNodeData>[] => {
        if (!initialWorkflow?.nodes) return [];
        
        return initialWorkflow.nodes.map((node, index) => {
            const agentType = AGENT_TYPES.find(a => a.id === node.agentType) || AGENT_TYPES[0];
            const xGap = 280;
            
            return {
                id: node.id,
                type: 'agent',
                position: { 
                    x: index * xGap, 
                    y: 100 + (index % 2) * 50
                },
                data: {
                    label: agentType.name,
                    agentType: node.agentType,
                    inputs: node.inputs,
                    status: 'active',
                }
            };
        });
    }, [initialWorkflow]);

    const getInitialEdges = useCallback((): Edge[] => {
        if (!initialWorkflow?.edges) return [];
        
        return initialWorkflow.edges.map(edge => ({
            id: `${edge.from}-${edge.to}`,
            source: edge.from,
            target: edge.to,
            animated: true,
            style: { stroke: '#667eea', strokeWidth: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#667eea' }
        }));
    }, [initialWorkflow]);

    const initialNodes = getInitialNodes();
    const initialEdges = getInitialEdges();

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Build workflow DAG from current nodes and edges
    const buildWorkflowDAG = useCallback((): WorkflowDAG => {
        const workflowNodes: WorkflowNode[] = nodes.map(node => {
            // Find dependencies based on edges
            const dependencies = edges
                .filter(edge => edge.target === node.id)
                .map(edge => edge.source);

            return {
                id: node.id,
                agentType: node.data.agentType,
                inputs: node.data.inputs,
                dependencies,
            };
        });

        const workflowEdges: WorkflowEdge[] = edges.map(edge => ({
            from: edge.source,
            to: edge.target
        }));

        // Calculate execution order using topological sort
        const executionOrder: string[] = [];
        const visited = new Set<string>();
        const tempVisited = new Set<string>();

        const visit = (nodeId: string) => {
            if (tempVisited.has(nodeId)) return;
            if (visited.has(nodeId)) return;

            tempVisited.add(nodeId);
            
            // Visit dependencies first
            const deps = workflowEdges.filter(e => e.to === nodeId).map(e => e.from);
            for (const dep of deps) {
                visit(dep);
            }

            tempVisited.delete(nodeId);
            visited.add(nodeId);
            executionOrder.push(nodeId);
        };

        for (const node of workflowNodes) {
            visit(node.id);
        }

        return {
            nodes: workflowNodes,
            edges: workflowEdges,
            executionOrder
        };
    }, [nodes, edges]);

    // Handler functions using useCallback
    const handleDeleteNode = useCallback((id: string) => {
        setNodes((nds) => nds.filter((n) => n.id !== id));
        setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
        if (selectedNodeId === id) {
            setSelectedNodeId(null);
        }
    }, [setNodes, setEdges, selectedNodeId]);

    const handleEditNode = useCallback((id: string) => {
        setSelectedNodeId(id);
    }, []);

    // Update nodes with delete/edit handlers whenever nodes or handlers change
    useEffect(() => {
        setNodes((nds) =>
            nds.map((n) => ({
                ...n,
                data: {
                    ...n.data,
                    onDelete: handleDeleteNode,
                    onEdit: handleEditNode
                }
            }))
        );
    }, [handleDeleteNode, handleEditNode, setNodes]);

    // Update selected node for properties panel
    useEffect(() => {
        if (selectedNodeId) {
            const node = nodes.find(n => n.id === selectedNodeId) || null;
            setSelectedNode(node as Node<AgentNodeData> | null);
        } else {
            setSelectedNode(null);
        }
    }, [selectedNodeId, nodes, setSelectedNode]);

    // Export workflow whenever nodes/edges change
    useEffect(() => {
        const workflow = buildWorkflowDAG();
        onWorkflowChange?.(workflow);
    }, [nodes, edges, buildWorkflowDAG, onWorkflowChange]);

    const onConnect = useCallback((params: Connection) => {
        setEdges((eds) => addEdge({
            ...params,
            animated: true,
            style: { stroke: '#667eea', strokeWidth: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#667eea' }
        }, eds));
    }, [setEdges]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
            if (!wrapperBounds) return;

            const typeData = event.dataTransfer.getData('application/reactflow');
            if (!typeData) return;

            const agentType: AgentType = JSON.parse(typeData);
            const position = project({
                x: event.clientX - wrapperBounds.left,
                y: event.clientY - wrapperBounds.top,
            });

            const newNode: Node<AgentNodeData> = {
                id: `${agentType.id}_${Date.now()}`,
                type: 'agent',
                position,
                data: {
                    label: agentType.name,
                    agentType: agentType.id,
                    inputs: {},
                    status: 'pending',
                    onDelete: handleDeleteNode,
                    onEdit: handleEditNode
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [project, setNodes, handleDeleteNode, handleEditNode]
    );

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNodeId(node.id);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
    }, []);

    // Listen for node data changes from properties panel
    useEffect(() => {
        const handler = (e: Event) => {
            const customEvent = e as CustomEvent<{ id: string; data: AgentNodeData }>;
            const { id, data } = customEvent.detail;
            setNodes((nds) =>
                nds.map((n) =>
                    n.id === id ? { ...n, data } : n
                )
            );
        };
        window.addEventListener('nodeDataChange', handler);
        return () => window.removeEventListener('nodeDataChange', handler);
    }, [setNodes]);

    // Auto-fit view on mount
    useEffect(() => {
        setTimeout(() => fitView({ padding: 0.2 }), 100);
    }, [fitView]);

    return (
        <div className="flex-1 flex flex-col">
            <div ref={reactFlowWrapper} className="flex-1">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    nodeTypes={nodeTypes}
                    fitView
                    minZoom={0.3}
                    maxZoom={2}
                    defaultEdgeOptions={{
                        animated: true,
                    }}
                    snapToGrid
                    snapGrid={[15, 15]}
                    className="workflow-builder"
                >
                    <Background
                        color="#475569"
                        gap={20}
                        style={{ opacity: 0.4 }}
                    />
                    <Controls 
                        className="!bg-slate-900/80 !border-slate-700 !shadow-xl"
                    />
                    
                    {/* Stats Panel */}
                    <Panel position="top-left" className="m-4">
                        <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-lg p-3 shadow-xl">
                            <div className="flex items-center gap-4 text-xs">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-indigo-500" />
                                    <span className="text-slate-300">{nodes.length} Nodes</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                                    <span className="text-slate-300">{edges.length} Connections</span>
                                </div>
                            </div>
                        </div>
                    </Panel>

                    {/* Instructions */}
                    {nodes.length === 0 && (
                        <Panel position="top-center" className="mt-8">
                            <div className="text-center p-8 bg-slate-900/80 backdrop-blur-sm border border-slate-700 rounded-xl shadow-2xl">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                    <Sparkles className="w-8 h-8 text-white" />
                                </div>
                                <h3 className="text-lg font-semibold text-white mb-2">Build Your Workflow</h3>
                                <p className="text-sm text-slate-400 max-w-xs">
                                    Drag agent types from the left sidebar and drop them here to create your workflow.
                                </p>
                                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
                                    <MousePointer2 className="w-4 h-4" />
                                    <span>Connect nodes by dragging from one handle to another</span>
                                </div>
                            </div>
                        </Panel>
                    )}
                </ReactFlow>
            </div>
        </div>
    );
}

// ============================================
// EXPORTED MAIN COMPONENT
// ============================================

export function WorkflowBuilder({
    workflow,
    mode = 'build',
    onWorkflowChange,
    onExecute,
    readOnly = false
}: WorkflowBuilderProps) {
    const [selectedNode, setSelectedNode] = useState<Node<AgentNodeData> | null>(null);
    const [activeMode, setActiveMode] = useState<BuilderMode>(mode);
    const [exportedWorkflow, setExportedWorkflow] = useState<WorkflowDAG | null>(null);

    const handleWorkflowChange = useCallback((newWorkflow: WorkflowDAG) => {
        setExportedWorkflow(newWorkflow);
        onWorkflowChange?.(newWorkflow);
    }, [onWorkflowChange]);

    const handleExport = () => {
        if (!exportedWorkflow) return;
        const dataStr = JSON.stringify(exportedWorkflow, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExecute = () => {
        if (exportedWorkflow && onExecute) {
            onExecute(exportedWorkflow);
        }
    };

    return (
        <div className="flex flex-col h-[600px] rounded-xl overflow-hidden border border-slate-700 bg-slate-950 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Layout className="w-5 h-5 text-indigo-500" />
                        <h2 className="font-semibold text-white">Workflow Builder</h2>
                    </div>
                    <div className="flex items-center gap-1 ml-4 bg-slate-800 rounded-lg p-1">
                        <button
                            onClick={() => setActiveMode('build')}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                activeMode === 'build' 
                                    ? "bg-indigo-600 text-white" 
                                    : "text-slate-400 hover:text-white hover:bg-slate-700"
                            )}
                        >
                            Build
                        </button>
                        <button
                            onClick={() => setActiveMode('view')}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                activeMode === 'view' 
                                    ? "bg-indigo-600 text-white" 
                                    : "text-slate-400 hover:text-white hover:bg-slate-700"
                            )}
                        >
                            View
                        </button>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    {onExecute && (
                        <Button 
                            onClick={handleExecute}
                            disabled={!exportedWorkflow || exportedWorkflow.nodes.length === 0}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                        >
                            <Play className="w-4 h-4 mr-1.5" />
                            Execute
                        </Button>
                    )}
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={handleExport}
                        disabled={!exportedWorkflow || exportedWorkflow.nodes.length === 0}
                    >
                        <Download className="w-4 h-4 mr-1.5" />
                        Export
                    </Button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {activeMode === 'build' && !readOnly && <AgentToolbar />}
                
                <ReactFlowProvider>
                    <FlowCanvas
                        initialWorkflow={workflow}
                        onWorkflowChange={handleWorkflowChange}
                        setSelectedNode={setSelectedNode}
                    />
                </ReactFlowProvider>
                
                {activeMode === 'build' && !readOnly && (
                    <NodePropertiesPanel
                        node={selectedNode}
                        onChange={(id, data) => {
                            // Find the react flow instance and update the node
                            const event = new CustomEvent('nodeDataChange', { 
                                detail: { id, data } 
                            });
                            window.dispatchEvent(event);
                        }}
                        onClose={() => setSelectedNode(null)}
                    />
                )}
            </div>
        </div>
    );
}

export { AGENT_TYPES };
export type { AgentType, AgentNodeData };
