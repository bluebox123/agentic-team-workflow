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
    Maximize2,
    Minimize2,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
        color: '#64748b',
        gradient: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
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
        color: '#0ea5e9',
        gradient: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
        inputs: [
            { name: 'text', type: 'string', required: false, description: 'Text content to analyze' },
            { name: 'data', type: 'array', required: false, description: 'Structured data for analysis' },
            { name: 'analysis_type', type: 'string', required: false, description: 'Analysis type (e.g. summary)' }
        ]
    },
    {
        id: 'chart',
        name: 'Chart',
        description: 'Create data visualizations',
        icon: '📊',
        color: '#8b5cf6',
        gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
        inputs: [
            { name: 'type', type: 'string', required: false, description: 'Chart type (bar, line, pie, etc)' },
            { name: 'title', type: 'string', required: false, description: 'Chart title' },
            { name: 'text', type: 'string', required: false, description: 'Instruction/context (optional)' },
            { name: 'role', type: 'string', required: true, description: 'Artifact role (used by designer)' },
            { name: 'x', type: 'array', required: false, description: 'X values (for bar/line/scatter/area)' },
            { name: 'y', type: 'array', required: false, description: 'Y values (for bar/line/scatter/area)' },
            { name: 'labels', type: 'array', required: false, description: 'Labels (for pie)' },
            { name: 'values', type: 'array', required: false, description: 'Values (for pie/histogram)' },
            { name: 'x_label', type: 'string', required: false, description: 'X-axis label' },
            { name: 'y_label', type: 'string', required: false, description: 'Y-axis label' }
        ]
    },
    {
        id: 'designer',
        name: 'Designer',
        description: 'Generate PDF reports',
        icon: '🎨',
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
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
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
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
        color: '#06b6d4',
        gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
        inputs: [
            { name: 'data', type: 'unknown', required: true, description: 'Data to validate' },
            { name: 'rules', type: 'object', required: true, description: 'Validation rules / JSON schema' }
        ]
    },
    {
        id: 'transformer',
        name: 'Transformer',
        description: 'Transform data formats',
        icon: '🔄',
        color: '#ec4899',
        gradient: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
        inputs: [
            { name: 'data', type: 'unknown', required: true, description: 'Data to transform' },
            { name: 'transform', type: 'string', required: true, description: 'Transform (e.g. uppercase, lowercase, ai:...)' }
        ]
    },
    {
        id: 'notifier',
        name: 'Notifier',
        description: 'Send notifications',
        icon: '🔔',
        color: '#f97316',
        gradient: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
        inputs: [
            { name: 'message', type: 'string', required: true, description: 'Message to send' },
            { name: 'channel', type: 'string', required: true, description: 'Notification channel' }
            , { name: 'recipients', type: 'array', required: false, description: 'Recipients (email addresses)' }
            , { name: 'recipient', type: 'string', required: false, description: 'Legacy single recipient' }
            , { name: 'subject', type: 'string', required: false, description: 'Email subject' }
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
                "relative px-4 py-3 rounded-lg border bg-card transition-all duration-200 min-w-[180px] max-w-[250px]",
                selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "",
                isHovered ? "shadow-lg" : ""
            )}
            style={{
                borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Target Handle */}
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
                style={{ top: -6 }}
            />

            {/* Node Content */}
            <div className="flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <div
                            className="w-8 h-8 rounded flex items-center justify-center text-lg"
                            style={{ background: agentType.gradient, opacity: 0.9 }}
                        >
                            {agentType.icon}
                        </div>
                        {data.status === 'active' && (
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                        )}
                    </div>
                    {(isHovered || selected) && (
                        <div className="flex gap-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onEdit?.(id);
                                }}
                                className="p-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                                title="Edit node"
                            >
                                <Settings className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onDelete?.(id);
                                }}
                                className="p-1 rounded bg-muted hover:bg-destructive/20 transition-colors"
                                title="Delete node"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Title */}
                <div className="text-sm font-medium text-foreground mb-1 truncate">
                    {agentType.name}
                </div>

                {/* Inputs Preview */}
                <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 max-h-[60px] overflow-hidden">
                    {Object.keys(data.inputs).length > 0 ? (
                        <div className="space-y-0.5">
                            {Object.entries(data.inputs).slice(0, 3).map(([key, value]) => (
                                <div key={key} className="flex items-center gap-1 min-w-0">
                                    <span className="text-muted-foreground flex-shrink-0">{key}:</span>
                                    <span className="truncate font-mono">
                                        {typeof value === 'string' ? value.slice(0, 20) : JSON.stringify(value).slice(0, 20)}
                                    </span>
                                </div>
                            ))}
                            {Object.keys(data.inputs).length > 3 && (
                                <span className="text-muted-foreground/60">+{Object.keys(data.inputs).length - 3} more</span>
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
                className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
                style={{ bottom: -6 }}
            />
        </div>
    );
};

const nodeTypes: NodeTypes = {
    agent: AgentNode,
};

function isEmptyValue(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length === 0;
    return false;
}

const AGENT_OUTPUTS: Record<string, string[]> = {
    scraper: ['text', 'html', 'url'],
    summarizer: ['summary', 'original_length'],
    analyzer: ['stats', 'insights'],
    transformer: ['result', 'transformed'],
    validator: ['valid', 'errors', 'warnings', 'error_count', 'warning_count'],
    chart: ['image_url', 'description', 'role'],
    designer: ['pdf_url'],
    notifier: ['status'],
    reviewer: ['decision', 'score', 'feedback'],
    executor: ['result'],
};

function makeOutputTemplate(sourceId: string, field: string) {
    return `{{tasks.${sourceId}.outputs.${field}}}`;
}

function chooseFirstAvailableOutput(sourceAgentType: string, preferred: string[]): string | null {
    const outputs = AGENT_OUTPUTS[sourceAgentType] ?? [];
    for (const p of preferred) {
        if (outputs.includes(p)) return p;
    }
    return outputs.length > 0 ? outputs[0] : null;
}

function inferAutoWiring(params: {
    sourceNodeId: string;
    sourceAgentType: string;
    sourceInputs: Record<string, unknown>;
    targetAgentType: string;
    existingTargetInputs: Record<string, unknown>;
}): Record<string, unknown> {
    const { sourceNodeId, sourceAgentType, sourceInputs, targetAgentType, existingTargetInputs } = params;

    const nextInputs: Record<string, unknown> = { ...existingTargetInputs };
    const setIfEmpty = (key: string, value: unknown) => {
        if (!(key in nextInputs) || isEmptyValue(nextInputs[key])) nextInputs[key] = value;
    };

    // Most agents accept upstream data via a "text" or "data" input. Prefer richer fields.
    if (targetAgentType === 'summarizer') {
        const out = chooseFirstAvailableOutput(sourceAgentType, ['text', 'summary', 'insights', 'result']);
        if (out) setIfEmpty('text', makeOutputTemplate(sourceNodeId, out));
    }

    if (targetAgentType === 'analyzer') {
        const out = chooseFirstAvailableOutput(sourceAgentType, ['text', 'summary', 'insights', 'result']);
        if (out) setIfEmpty('text', makeOutputTemplate(sourceNodeId, out));
        setIfEmpty('analysis_type', 'summary');
    }

    if (targetAgentType === 'transformer') {
        const out = chooseFirstAvailableOutput(sourceAgentType, ['result', 'text', 'summary', 'insights']);
        if (out) setIfEmpty('data', makeOutputTemplate(sourceNodeId, out));
        setIfEmpty('transform', 'ai:Transform the input into a clean JSON array or object suitable for the next step');
    }

    if (targetAgentType === 'validator') {
        const out = chooseFirstAvailableOutput(sourceAgentType, ['result', 'transformed', 'stats']);
        if (out) setIfEmpty('data', makeOutputTemplate(sourceNodeId, out));
        // rules cannot be inferred safely; user must provide
    }

    if (targetAgentType === 'chart') {
        // Chart expects either x/y or labels/values; we can't infer series reliably. Use text instruction from upstream.
        const out = chooseFirstAvailableOutput(sourceAgentType, ['insights', 'summary', 'text', 'result']);
        if (out) setIfEmpty('text', makeOutputTemplate(sourceNodeId, out));
        setIfEmpty('type', 'bar');
        setIfEmpty('title', 'Chart');
        setIfEmpty('role', `chart_${Date.now()}`);
    }

    if (targetAgentType === 'designer') {
        // Designer always wants sections; create a basic section referencing upstream output.
        const out = chooseFirstAvailableOutput(sourceAgentType, ['summary', 'insights', 'text', 'result', 'pdf_url', 'image_url']);
        setIfEmpty('title', 'Report');

        const existingSections = Array.isArray(nextInputs.sections) ? (nextInputs.sections as unknown[]) : [];
        const canAppend = existingSections.length > 0;

        // Special-case: chart -> designer should embed via artifact reference (not a URL string)
        if (sourceAgentType === 'chart') {
            const role = typeof sourceInputs.role === 'string' && sourceInputs.role.trim() ? sourceInputs.role.trim() : null;
            const section = role
                ? { heading: 'Chart', artifact: { type: 'chart', role } }
                : { heading: 'Chart', content: makeOutputTemplate(sourceNodeId, 'image_url') };

            if (canAppend) {
                const next = [...existingSections, section];
                nextInputs.sections = next;
            } else {
                nextInputs.sections = [section];
            }
        } else if (out) {
            const section = { heading: 'Results', content: makeOutputTemplate(sourceNodeId, out) };
            if (canAppend) {
                const next = [...existingSections, section];
                nextInputs.sections = next;
            } else {
                setIfEmpty('sections', [section]);
            }
        }
    }

    if (targetAgentType === 'notifier') {
        // If notifying after designer, send pdf_url.
        if (sourceAgentType === 'designer') {
            setIfEmpty('message', `Your report is ready: ${makeOutputTemplate(sourceNodeId, 'pdf_url')}`);
        } else {
            const out = chooseFirstAvailableOutput(sourceAgentType, ['result', 'summary', 'insights', 'text']);
            if (out) setIfEmpty('message', makeOutputTemplate(sourceNodeId, out));
        }
        setIfEmpty('channel', 'email');
    }

    if (targetAgentType === 'reviewer') {
        // target_task_id is injected by backend based on dependency; do nothing.
        setIfEmpty('score_threshold', 80);
    }

    if (targetAgentType === 'executor') {
        const out = chooseFirstAvailableOutput(sourceAgentType, ['text', 'summary', 'insights', 'result']);
        if (out) setIfEmpty('context', makeOutputTemplate(sourceNodeId, out));
    }

    return nextInputs;
}

// ============================================
// DRAG & DROP TOOLBAR
// ============================================

function AgentToolbar() {
    const onDragStart = (event: React.DragEvent, agentType: AgentType) => {
        event.dataTransfer.setData('application/reactflow', JSON.stringify(agentType));
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className="w-64 bg-background border-r flex flex-col">
            <div className="p-4 border-b">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Agent Types
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Drag to add nodes</p>
            </div>

            <ScrollArea className="flex-1 p-3">
                <div className="space-y-2">
                    {AGENT_TYPES.map((agent) => (
                        <div
                            key={agent.id}
                            draggable
                            onDragStart={(e) => onDragStart(e, agent)}
                            className="group p-3 rounded-lg border bg-card hover:bg-accent cursor-grab active:cursor-grabbing transition-all hover:border-muted-foreground/30"
                        >
                            <div className="flex items-start gap-3">
                                <div
                                    className="w-8 h-8 rounded flex items-center justify-center text-lg"
                                    style={{ background: agent.gradient, opacity: 0.8 }}
                                >
                                    {agent.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <GripVertical className="w-3 h-3 text-muted-foreground" />
                                        <span className="font-medium text-sm truncate">
                                            {agent.name}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
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
        const newData = { ...node.data, inputs: newInputs };
        onChange(node.id, newData);
        // Also dispatch event to update FlowCanvas nodes
        const event = new CustomEvent('nodeDataChange', { detail: { id: node.id, data: newData } });
        window.dispatchEvent(event);
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
            <div className="w-80 bg-background border-l flex flex-col">
                <div className="flex-1 flex items-center justify-center p-6 text-center">
                    <div className="text-muted-foreground">
                        <MousePointer2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">Select a node to edit its properties</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-80 bg-background border-l flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div
                        className="w-8 h-8 rounded flex items-center justify-center text-lg"
                        style={{ background: agentType.gradient, opacity: 0.8 }}
                    >
                        {agentType.icon}
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold">{agentType.name}</h3>
                        <p className="text-xs text-muted-foreground">Node Properties</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {/* Required Inputs */}
                    {agentType.inputs.some(i => i.required) && (
                        <div className="p-3 rounded-lg border bg-muted/30">
                            <div className="flex items-center justify-between mb-2">
                                <Label className="text-xs text-muted-foreground">Required Inputs</Label>
                                <Badge variant="outline" className="text-[10px]">
                                    {agentType.inputs.filter(i => i.required).filter(i => inputs[i.name] !== undefined && inputs[i.name] !== null && String(inputs[i.name]).trim?.() !== "").length}/{agentType.inputs.filter(i => i.required).length}
                                </Badge>
                            </div>
                            <div className="space-y-1">
                                {agentType.inputs.filter(i => i.required).map((i) => {
                                    const v = (inputs as Record<string, unknown>)[i.name];
                                    const ok = v !== undefined && v !== null && (typeof v !== "string" || v.trim() !== "");
                                    return (
                                        <div key={i.name} className="flex items-center justify-between text-xs">
                                            <span className="font-mono">{i.name}</span>
                                            <span className={cn("text-[10px]", ok ? "text-emerald-500" : "text-destructive")}>{ok ? "OK" : "Missing"}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Node ID */}
                    <div>
                        <Label className="text-xs text-muted-foreground">Node ID</Label>
                        <Input
                            value={node.id}
                            disabled
                            className="mt-1.5 bg-muted text-muted-foreground text-xs"
                        />
                    </div>

                    <Separator />

                    {/* Quick Inputs from Agent Template */}
                    <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Quick Add Inputs</Label>
                        <div className="flex flex-wrap gap-2">
                            {agentType.inputs.map((input) => (
                                <button
                                    key={input.name}
                                    onClick={() => handleInputChange(input.name, input.type === 'string' ? '' : input.type === 'number' ? 0 : input.type === 'array' ? [] : {})}
                                    className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 border transition-colors"
                                >
                                    + {input.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Separator />

                    {/* Current Inputs */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <Label className="text-xs text-muted-foreground">Configured Inputs</Label>
                            <Badge variant="outline" className="text-[10px]">
                                {Object.keys(inputs).length}
                            </Badge>
                        </div>

                        <div className="space-y-2">
                            {Object.entries(inputs).map(([key, value]) => (
                                <div key={key} className="p-2 rounded-lg bg-muted/50 border group">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <Label className="text-xs font-medium">{key}</Label>
                                        <button
                                            onClick={() => handleRemoveInput(key)}
                                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 transition-all"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <Textarea
                                        value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                        onChange={(e) => {
                                            const newValue = e.target.value;
                                            try {
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
                                        className="min-h-[60px] text-xs bg-background border font-mono"
                                    />
                                </div>
                            ))}

                            {Object.keys(inputs).length === 0 && (
                                <div className="text-center py-4 text-muted-foreground text-xs">
                                    No inputs configured yet
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator />

                    {/* Add Custom Input */}
                    <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">Add Custom Input</Label>
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
                                className="flex-1 bg-muted text-xs"
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

    const onWorkflowChangeRef = useRef<typeof onWorkflowChange>(onWorkflowChange);
    useEffect(() => {
        onWorkflowChangeRef.current = onWorkflowChange;
    }, [onWorkflowChange]);

    // Convert initial workflow to nodes/edges (without handlers first)
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

    const selectedNodeIdRef = useRef<string | null>(null);
    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
    }, [selectedNodeId]);

    // Handler functions - defined AFTER state hooks
    const handleDeleteNode = useCallback((id: string) => {
        setNodes((nds) => nds.filter((n) => n.id !== id));
        setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
        if (selectedNodeIdRef.current === id) {
            setSelectedNodeId(null);
        }
    }, [setNodes, setEdges]);

    const handleEditNode = useCallback((id: string) => {
        setSelectedNodeId(id);
    }, []);

    // Update nodes with handlers - only once after mount, not in a loop
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run once on mount

    // When new nodes are added via onDrop, include handlers immediately
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
        onWorkflowChangeRef.current?.(workflow);
    }, [nodes, edges, buildWorkflowDAG]);

    const onConnect = useCallback((params: Connection) => {
        setEdges((eds) => addEdge({
            ...params,
            animated: true,
            style: { stroke: '#667eea', strokeWidth: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#667eea' }
        }, eds));

        const sourceId = params.source;
        const targetId = params.target;
        if (!sourceId || !targetId) return;

        setNodes((nds) => {
            const sourceNode = nds.find((n) => n.id === sourceId);
            const targetNode = nds.find((n) => n.id === targetId);
            if (!sourceNode || !targetNode) return nds;

            const nextInputs = inferAutoWiring({
                sourceNodeId: sourceId,
                sourceAgentType: sourceNode.data.agentType,
                sourceInputs: (sourceNode.data.inputs ?? {}) as Record<string, unknown>,
                targetAgentType: targetNode.data.agentType,
                existingTargetInputs: targetNode.data.inputs ?? {},
            });

            // Avoid triggering re-renders if nothing changes
            if (JSON.stringify(nextInputs) === JSON.stringify(targetNode.data.inputs ?? {})) return nds;

            const nextData: AgentNodeData = {
                ...targetNode.data,
                inputs: nextInputs,
            };

            // Keep the properties panel in sync
            const event = new CustomEvent('nodeDataChange', { detail: { id: targetId, data: nextData } });
            window.dispatchEvent(event);

            return nds.map((n) => (n.id === targetId ? { ...n, data: nextData } : n));
        });
    }, [setEdges]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

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
        <div className="flex-1 flex flex-col min-h-0">
            <div ref={reactFlowWrapper} className="flex-1 min-h-0">
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
                    style={{ width: '100%', height: '100%' }}
                >
                    <Background
                        color="#475569"
                        gap={20}
                        style={{ opacity: 0.4 }}
                    />
                    <Controls
                        className="!bg-background !border !shadow-md"
                    />

                    {/* Stats Panel */}
                    <Panel position="top-left" className="m-4">
                        <div className="bg-card border rounded-lg p-3 shadow-md">
                            <div className="flex items-center gap-4 text-xs">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-primary" />
                                    <span className="text-muted-foreground">{nodes.length} Nodes</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-primary/60" />
                                    <span className="text-muted-foreground">{edges.length} Connections</span>
                                </div>
                            </div>
                        </div>
                    </Panel>

                    {/* Instructions */}
                    {nodes.length === 0 && (
                        <Panel position="top-center" className="mt-8">
                            <div className="text-center p-8 bg-card border rounded-xl shadow-lg">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                                    <Sparkles className="w-8 h-8 text-primary" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2">Build Your Workflow</h3>
                                <p className="text-sm text-muted-foreground max-w-xs">
                                    Drag agent types from the left sidebar and drop them here to create your workflow.
                                </p>
                                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
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
    const [isFullscreen, setIsFullscreen] = useState(false);

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
        <div className={cn(
            "flex flex-col bg-background border",
            isFullscreen
                ? "fixed inset-4 z-[100] rounded-xl shadow-2xl"
                : "h-full min-h-0 overflow-hidden rounded-lg"
        )}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted border-b">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Layout className="w-5 h-5 text-primary" />
                        <h2 className="font-semibold">Workflow Builder</h2>
                    </div>
                    <div className="flex items-center gap-1 ml-4 bg-background rounded-lg p-1 border">
                        <button
                            onClick={() => setActiveMode('build')}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                activeMode === 'build'
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                        >
                            Build
                        </button>
                        <button
                            onClick={() => setActiveMode('view')}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                                activeMode === 'view'
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                        >
                            View
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="px-2"
                        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </Button>
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
            <div className="flex-1 min-h-0 flex overflow-hidden">
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
export type { AgentType, AgentNodeData, WorkflowDAG };
