import { Component, useCallback, useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, GripVertical, Play, CheckCircle, Smartphone, Layers, RefreshCcw, BarChart, PenTool, Calculator, FileText, Shield, ArrowLeftRight, Bell, Globe, LayoutGrid, List, Clock, XCircle, AlertCircle, Activity, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowBuilder, type WorkflowDAG } from "./WorkflowBuilder";
import { WorkflowVisualizer } from "./WorkflowVisualizer";
import { createWorkflow } from "../api/workflows";
import { createJob, fetchJobTasks, fetchJobs, type Job, type TaskConfig } from "../api/jobs";
import { fetchArtifacts, fetchArtifactBlob, fetchArtifactText, type Artifact } from "../api/artifacts";
import { fetchLogs } from "../api/logs";
import { cn } from "@/lib/utils";

interface CreateJobDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

class VisualBuilderErrorBoundary extends Component<
    { onBackToList: () => void; children: ReactNode },
    { hasError: boolean; errorMessage: string }
> {
    constructor(props: { onBackToList: () => void; children: ReactNode }) {
        super(props);
        this.state = { hasError: false, errorMessage: "" };
    }

    static getDerivedStateFromError(error: unknown) {
        return {
            hasError: true,
            errorMessage: error instanceof Error ? error.message : "Visual builder crashed",
        };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-full w-full flex items-center justify-center p-6">
                    <div className="max-w-md w-full border rounded-lg bg-card p-4">
                        <div className="text-sm font-medium mb-2">Visual Builder Error</div>
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words mb-4">
                            {this.state.errorMessage}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => this.setState({ hasError: false, errorMessage: "" })}>
                                Retry
                            </Button>
                            <Button onClick={this.props.onBackToList}>Back to List View</Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

interface JobTask {
    id: string;
    name: string;
    status: string;
}

function toJobTask(value: unknown): JobTask | null {
    if (!value || typeof value !== "object") return null;
    const v = value as { id?: unknown; name?: unknown; status?: unknown };
    if (typeof v.id !== "string" || typeof v.name !== "string" || typeof v.status !== "string") return null;
    return { id: v.id, name: v.name, status: v.status };
}

type TaskType = "executor" | "reviewer" | "designer" | "chart" | "analyzer" | "summarizer" | "validator" | "transformer" | "notifier" | "scraper";

interface BuilderTask extends TaskConfig {
    id: string;
    type: TaskType;
}

const availableTasks: { type: TaskType; label: string; icon: ElementType; defaultPayload: Record<string, unknown> }[] = [
    { type: "executor", label: "Executor Agent", icon: Smartphone, defaultPayload: { prompt: "" } },
    { type: "reviewer", label: "Reviewer Agent", icon: CheckCircle, defaultPayload: { criteria: "" } },
    { type: "designer", label: "Designer Agent", icon: PenTool, defaultPayload: { title: "New Report", sections: [{ heading: "Introduction", content: "This is a default section." }] } },
    { type: "chart", label: "Chart Agent", icon: BarChart, defaultPayload: { type: "bar", title: "New Chart", x: [1, 2, 3], y: [10, 20, 30], x_label: "X", y_label: "Y" } },
    { type: "analyzer", label: "Analyzer Agent", icon: Calculator, defaultPayload: { data: [1, 2, 3, 4, 5], analysis_type: "summary" } },
    { type: "summarizer", label: "Summarizer Agent", icon: FileText, defaultPayload: { text: "", max_sentences: 3 } },
    { type: "validator", label: "Validator Agent", icon: Shield, defaultPayload: { data: {}, rules: {} } },
    { type: "transformer", label: "Transformer Agent", icon: ArrowLeftRight, defaultPayload: { data: [], transform: "uppercase" } },
    { type: "notifier", label: "Notifier Agent", icon: Bell, defaultPayload: { channel: "email", recipients: [], message: "" } },
    { type: "scraper", label: "Scraper Agent", icon: Globe, defaultPayload: { url: "", selector: "" } },
];

export function CreateJobDialog({ open, onOpenChange, onSuccess }: CreateJobDialogProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [tasks, setTasks] = useState<BuilderTask[]>([]);
    const [saveTemplate, setSaveTemplate] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("list");
    const [visualWorkflow, setVisualWorkflow] = useState<WorkflowDAG | null>(null);

    // Job execution tracking - same as BrainPanel
    const [executingJob, setExecutingJob] = useState<Job | null>(null);
    const [jobLogs, setJobLogs] = useState<Array<{ level: string; message: string; created_at: string }>>([]);
    const [jobArtifacts, setJobArtifacts] = useState<Artifact[]>([]);
    const [jobTasks, setJobTasks] = useState<JobTask[]>([]);
    const [autoRefreshInterval, setAutoRefreshInterval] = useState<ReturnType<typeof setInterval> | null>(null);

    // Artifact viewing
    const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
    const [artifactText, setArtifactText] = useState<string>("");
    const [artifactObjectUrl, setArtifactObjectUrl] = useState<string>("");

    const taskStatusByName = useMemo(() => {
        const map: Record<string, string> = {};
        for (const t of jobTasks) {
            map[t.name] = t.status;
        }
        return map;
    }, [jobTasks]);

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        };
    }, [autoRefreshInterval]);

    // Cleanup artifact object URLs
    useEffect(() => {
        return () => {
            if (artifactObjectUrl) URL.revokeObjectURL(artifactObjectUrl);
        };
    }, [artifactObjectUrl]);

    // View artifact content - same as BrainPanel
    const viewArtifact = async (artifact: Artifact) => {
        setSelectedArtifact(artifact);
        setArtifactText("");
        if (artifactObjectUrl) {
            URL.revokeObjectURL(artifactObjectUrl);
            setArtifactObjectUrl("");
        }

        const mime = artifact.mime_type || "";
        if (mime.startsWith("text/") || mime === "" || mime === "application/json") {
            try {
                const text = await fetchArtifactText(artifact.id);
                setArtifactText(text);
            } catch (error) {
                console.error("Failed to fetch artifact text:", error);
                setArtifactText("Failed to load artifact content.");
            }
            return;
        }

        if (mime.startsWith("image/") || mime === "application/pdf") {
            try {
                const blob = await fetchArtifactBlob(artifact.id);
                const url = URL.createObjectURL(blob);
                setArtifactObjectUrl(url);
            } catch (error) {
                console.error("Failed to fetch artifact blob:", error);
            }
        }
    };

    // Download artifact - same as BrainPanel
    const downloadArtifact = async (artifact: Artifact) => {
        try {
            const blob = await fetchArtifactBlob(artifact.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = artifact.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to download artifact:", error);
        }
    };

    // Auto-refresh job status - same as BrainPanel
    const startJobTracking = useCallback(async (jobId: string) => {
        const refreshJobStatus = async () => {
            try {
                const jobs = await fetchJobs("mine");
                const job = jobs.find(j => j.id === jobId);
                if (job) {
                    setExecutingJob(job);

                    // Fetch tasks, logs, and artifacts
                    const [tasksRaw, artifacts] = await Promise.all([
                        fetchJobTasks(jobId),
                        fetchArtifacts(jobId)
                    ]);

                    const normalizedTasks = Array.isArray(tasksRaw)
                        ? (tasksRaw.map(toJobTask).filter((t): t is JobTask => t !== null))
                        : [];

                    setJobTasks(normalizedTasks);
                    setJobArtifacts(artifacts);

                    // Get logs from the latest task
                    if (Array.isArray(tasksRaw) && tasksRaw.length > 0) {
                        const latestTask = tasksRaw[tasksRaw.length - 1] as { id?: unknown };
                        if (latestTask?.id && typeof latestTask.id === "string") {
                            const logs = await fetchLogs(latestTask.id);
                            setJobLogs(logs);
                        }
                    }

                    // Stop tracking if job is complete
                    if (job.status !== "RUNNING" && job.status !== "PENDING") {
                        if (autoRefreshInterval) {
                            clearInterval(autoRefreshInterval);
                            setAutoRefreshInterval(null);
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to refresh job status", error);
            }
        };

        // Initial fetch
        await refreshJobStatus();

        // Set up auto-refresh
        const interval = setInterval(refreshJobStatus, 3000);
        setAutoRefreshInterval(interval);
    }, [autoRefreshInterval]);

    const addTask = (taskType: TaskType) => {
        const template = availableTasks.find(t => t.type === taskType)!;
        setTasks([
            ...tasks,
            {
                id: Math.random().toString(36).substring(7),
                name: `${template.label} ${tasks.length + 1}`,
                agent_type: taskType,
                type: taskType,
                payload: { ...template.defaultPayload },
                parent_task_index: tasks.length > 0 ? tasks.length - 1 : undefined
            }
        ]);
    };

    const removeTask = (index: number) => {
        const newTasks = [...tasks];
        newTasks.splice(index, 1);
        newTasks.forEach((t, i) => {
            if (i > 0) t.parent_task_index = i - 1;
            else delete t.parent_task_index;
        });
        setTasks(newTasks);
    };

    const updateTask = (index: number, field: keyof BuilderTask | "payload_key", value: unknown, payloadKey?: string) => {
        const newTasks = [...tasks];
        if (field === "payload" && payloadKey) {
            newTasks[index].payload = { ...newTasks[index].payload, [payloadKey]: value };
        } else {
            (newTasks[index] as unknown as Record<string, unknown>)[field] = value;
        }
        setTasks(newTasks);
    };

    const handleVisualWorkflowChange = useCallback((workflow: WorkflowDAG) => {
        setVisualWorkflow(workflow);
        const executionOrder = workflow.executionOrder || workflow.nodes.map((n: { id: string }) => n.id);
        const newTasks = executionOrder.map((nodeId: string, index: number) => {
            const node = workflow.nodes.find((n: { id: string }) => n.id === nodeId);
            if (!node) return null;

            let parentIndex: number | undefined = undefined;
            if (node.dependencies.length > 0) {
                const dependencyIndices = node.dependencies
                    .map((depId: string) => executionOrder.indexOf(depId))
                    .filter((idx: number) => idx !== -1 && idx < index);
                
                if (dependencyIndices.length > 0) {
                    parentIndex = Math.max(...dependencyIndices);
                }
            }

            return {
                id: node.id,
                name: node.id,
                agent_type: node.agentType as TaskType,
                type: node.agentType as TaskType,
                payload: node.inputs as Record<string, unknown>,
                parent_task_index: parentIndex
            };
        }).filter((t): t is NonNullable<typeof t> => t !== null);

        setTasks(newTasks);
    }, []);

    const handleSubmit = async () => {
        if (!title) { setError("Title is required"); return; }
        if (tasks.length === 0) { setError("Add at least one task"); return; }

        setLoading(true);
        setError(null);

        try {
            const jobPayload = {
                title,
                tasks: tasks.map((t) => {
                    const { id, type, ...rest } = t;
                    void id;
                    void type;
                    return rest;
                })
            };
            const createdJobResponse = await createJob(jobPayload);

            if (saveTemplate) {
                await createWorkflow({
                    name: title,
                    description: description || "Created from Job Builder",
                    dag: {
                        tasks: tasks.map(t => ({
                            name: t.name,
                            agent_type: t.agent_type,
                            parent_task_index: t.parent_task_index,
                            payload: t.payload,
                            params: t.payload
                        }))
                    }
                });
            }

            // Start tracking the job - same as BrainPanel
            if (createdJobResponse && createdJobResponse.jobId) {
                const jobId = createdJobResponse.jobId;
                await startJobTracking(jobId);
                // Switch to execution tab to show progress
                setActiveTab("execution");
            }

            onSuccess();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create job";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Reset form and close dialog
    const handleClose = () => {
        // Clear job tracking state
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            setAutoRefreshInterval(null);
        }
        setExecutingJob(null);
        setJobTasks([]);
        setJobLogs([]);
        setJobArtifacts([]);
        setSelectedArtifact(null);
        if (artifactObjectUrl) {
            URL.revokeObjectURL(artifactObjectUrl);
            setArtifactObjectUrl("");
        }

        // Reset form
        setTitle("");
        setDescription("");
        setTasks([]);
        setSaveTemplate(false);
        setVisualWorkflow(null);
        setActiveTab("list");

        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0 gap-0 bg-background/95 backdrop-blur-md border-border/60">
                <DialogHeader className="p-6 border-b">
                    <DialogTitle className="text-xl font-light tracking-wide flex items-center gap-2">
                        <span className="bg-primary/10 p-2 rounded-full text-primary"><Plus className="w-5 h-5" /></span>
                        Create New Job
                    </DialogTitle>
                    <DialogDescription>
                        Design your workflow by adding and configuring tasks.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 flex overflow-hidden">
                    {/* Sidebar - Task Library */}
                    <div className="w-64 border-r bg-muted/30 p-4 flex flex-col gap-4 overflow-y-auto">
                        <div className="space-y-4">
                            <div>
                                <Label>Job Details</Label>
                                <Input
                                    placeholder="Job Title"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    className="mt-1.5 bg-background"
                                />
                            </div>
                            <div className="flex items-center space-x-2 pt-2">
                                <Checkbox
                                    id="save-template"
                                    checked={saveTemplate}
                                    onCheckedChange={(c) => setSaveTemplate(!!c)}
                                />
                                <Label htmlFor="save-template" className="text-sm font-normal cursor-pointer">Save as Template</Label>
                            </div>
                        </div>

                        <div className="h-px bg-border/50" />

                        <div>
                            <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-3 block">Task Library</Label>
                            <div className="space-y-2">
                                {availableTasks.map(task => (
                                    <motion.button
                                        key={task.type}
                                        whileHover={{ scale: 1.02, x: 2 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => addTask(task.type)}
                                        className="w-full flex items-center gap-3 p-3 text-sm font-medium border rounded-lg hover:bg-background hover:shadow-sm hover:border-primary/30 transition-all text-left bg-card group"
                                    >
                                        <div className="p-1.5 rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors">
                                            <task.icon className="w-4 h-4" />
                                        </div>
                                        {task.label}
                                        <Plus className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                                    </motion.button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Main Content with Tabs */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                            <div className="border-b px-6 pt-4">
                                <TabsList className="bg-muted/50">
                                    <TabsTrigger value="list" className="gap-2" disabled={executingJob !== null}>
                                        <List className="w-4 h-4" />
                                        List View
                                    </TabsTrigger>
                                    <TabsTrigger value="visual" className="gap-2" disabled={executingJob !== null}>
                                        <LayoutGrid className="w-4 h-4" />
                                        Visual Builder
                                    </TabsTrigger>
                                    {executingJob && (
                                        <TabsTrigger value="execution" className="gap-2">
                                            <Activity className="w-4 h-4 animate-pulse" />
                                            Execution
                                        </TabsTrigger>
                                    )}
                                </TabsList>
                            </div>

                            <TabsContent value="list" className="flex-1 overflow-y-auto p-6 m-0">
                                {tasks.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60 border-2 border-dashed rounded-xl">
                                        <Layers className="w-12 h-12 mb-4 text-slate-300 dark:text-slate-700" />
                                        <p>Select a task from the library to start building</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4 max-w-2xl mx-auto">
                                        <AnimatePresence mode="popLayout">
                                            {tasks.map((task, index) => (
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                                                    key={task.id}
                                                    className="relative group"
                                                >
                                                    {index > 0 && (
                                                        <div className="absolute -top-4 left-8 w-0.5 h-4 bg-border/50 -z-10" />
                                                    )}

                                                    <div className="absolute -left-3 top-6 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground">
                                                        <GripVertical className="w-4 h-4" />
                                                    </div>

                                                    <Card className="p-4 border shadow-sm hover:shadow-md transition-shadow dark:bg-card">
                                                        <div className="flex items-start justify-between gap-4 mb-4">
                                                            <div className="flex items-center gap-3 flex-1">
                                                                <div className={cn("p-2 rounded-md", task.type === 'reviewer' ? "bg-purple-500/10 text-purple-500" : "bg-blue-500/10 text-blue-500")}>
                                                                    {task.type === 'reviewer' ? <CheckCircle className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                                                                </div>
                                                                <Input
                                                                    value={task.name}
                                                                    onChange={(e) => updateTask(index, 'name', e.target.value)}
                                                                    className="h-8 font-medium border-transparent hover:border-input focus:border-input transition-all w-full max-w-[200px]"
                                                                />
                                                                <Badge variant="outline" className="text-[10px] uppercase">{task.type}</Badge>
                                                            </div>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeTask(index)}>
                                                                <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                        </div>

                                                        <div className="pl-11 space-y-3">
                                                            {task.type === 'executor' && (
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Prompt / Instruction</Label>
                                                                    <Input
                                                                        value={task.payload?.prompt as string || ""}
                                                                        onChange={(e) => updateTask(index, "payload", e.target.value, "prompt")}
                                                                        placeholder="e.g. Write a summary of..."
                                                                        className="bg-muted/30"
                                                                    />
                                                                </div>
                                                            )}
                                                            {task.type === 'reviewer' && (
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Review Criteria</Label>
                                                                    <Input
                                                                        value={task.payload?.criteria as string || ""}
                                                                        onChange={(e) => updateTask(index, "payload", e.target.value, "criteria")}
                                                                        placeholder="e.g. Check for grammar and tone..."
                                                                        className="bg-muted/30"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </Card>
                                                </motion.div>
                                            ))}
                                        </AnimatePresence>

                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="flex justify-center pt-4 pb-12"
                                        >
                                            <div className="w-8 h-8 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/30">
                                                <Plus className="w-4 h-4" />
                                            </div>
                                        </motion.div>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="visual" className="flex-1 m-0 p-0 relative" style={{ minHeight: '400px' }}>
                                <div className="absolute inset-0">
                                    <VisualBuilderErrorBoundary onBackToList={() => setActiveTab('list')}>
                                        <WorkflowBuilder
                                            key="visual-builder"
                                            workflow={visualWorkflow || undefined}
                                            onWorkflowChange={handleVisualWorkflowChange}
                                            mode="build"
                                        />
                                    </VisualBuilderErrorBoundary>
                                </div>
                            </TabsContent>

                            {/* Execution Tab - Same as BrainPanel */}
                            <TabsContent value="execution" className="flex-1 overflow-y-auto p-6 m-0">
                                {executingJob && (
                                    <div className="space-y-6">
                                        {/* Job Status Header */}
                                        <Card className="border-l-4 border-l-indigo-500 shadow-lg">
                                            <CardHeader className="pb-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 text-lg font-semibold">
                                                        {executingJob.status === 'RUNNING' && <Activity className="h-5 w-5 text-blue-500 animate-pulse" />}
                                                        {executingJob.status === 'SUCCESS' && <CheckCircle className="h-5 w-5 text-green-500" />}
                                                        {executingJob.status === 'FAILED' && <XCircle className="h-5 w-5 text-red-500" />}
                                                        {executingJob.status === 'PENDING' && <AlertCircle className="h-5 w-5 text-yellow-500" />}
                                                        Job: {executingJob.title}
                                                    </div>
                                                    <Badge
                                                        variant={
                                                            executingJob.status === 'SUCCESS' ? 'default' :
                                                                executingJob.status === 'FAILED' ? 'destructive' :
                                                                    'secondary'
                                                        }
                                                        className={
                                                            executingJob.status === 'SUCCESS' ? 'bg-green-600' :
                                                                executingJob.status === 'RUNNING' ? 'bg-blue-500' :
                                                                    ''
                                                        }
                                                    >
                                                        {executingJob.status}
                                                    </Badge>
                                                </div>
                                            </CardHeader>
                                        </Card>

                                        {/* Workflow Visualizer */}
                                        {visualWorkflow && (
                                            <div className="rounded-md border bg-muted/20 p-3">
                                                <WorkflowVisualizer workflow={visualWorkflow} taskStatusByName={taskStatusByName} />
                                            </div>
                                        )}

                                        {/* Tasks */}
                                        {jobTasks.length > 0 && (
                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                                        <Activity className="h-4 w-4" />
                                                        Tasks ({jobTasks.filter(t => t.status === 'SUCCESS').length}/{jobTasks.length} completed)
                                                    </div>
                                                </CardHeader>
                                                <div className="p-4 pt-0 space-y-2">
                                                    {jobTasks.map(task => (
                                                        <div key={task.id} className="flex items-center gap-2 p-2 rounded bg-muted/50">
                                                            {task.status === 'SUCCESS' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                                            {task.status === 'FAILED' && <XCircle className="h-4 w-4 text-red-500" />}
                                                            {task.status === 'RUNNING' && <Activity className="h-4 w-4 text-blue-500 animate-pulse" />}
                                                            {task.status === 'PENDING' && <Clock className="h-4 w-4 text-gray-400" />}
                                                            <span className="text-sm font-medium">{task.name}</span>
                                                            <Badge variant="outline" className="text-[10px] ml-auto">{task.status}</Badge>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        )}

                                        {/* Logs */}
                                        {jobLogs.length > 0 && (
                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                                        <FileText className="h-4 w-4" />
                                                        Logs (Last {Math.min(jobLogs.length, 5)})
                                                    </div>
                                                </CardHeader>
                                                <div className="p-4 pt-0">
                                                    <div className="bg-black/90 rounded-md p-3 max-h-[200px] overflow-auto font-mono text-xs">
                                                        {jobLogs.slice(-5).map((log, i) => (
                                                            <div key={i} className="mb-1">
                                                                <span className="text-gray-500">{new Date(log.created_at).toLocaleTimeString()}</span>
                                                                <span className={`ml-2 font-bold ${log.level === 'ERROR' ? 'text-red-500' : 'text-blue-400'}`}>
                                                                    [{log.level}]
                                                                </span>
                                                                <span className="ml-2 text-gray-300">{log.message}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </Card>
                                        )}

                                        {/* Artifacts */}
                                        {jobArtifacts.length > 0 && (
                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                                        <FileText className="h-4 w-4" />
                                                        Artifacts ({jobArtifacts.length})
                                                    </div>
                                                </CardHeader>
                                                <div className="p-4 pt-0">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {jobArtifacts.map(artifact => (
                                                            <div
                                                                key={artifact.id}
                                                                className="p-2 border rounded text-xs bg-card hover:border-indigo-500 cursor-pointer transition-all"
                                                                onClick={() => viewArtifact(artifact)}
                                                            >
                                                                <div className="flex justify-between items-start mb-1">
                                                                    <Badge variant="secondary" className="text-[10px]">{artifact.type}</Badge>
                                                                    {artifact.role && <Badge variant="outline" className="text-[10px]">{artifact.role}</Badge>}
                                                                </div>
                                                                <p className="truncate font-medium">{artifact.filename}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </Card>
                                        )}
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                <DialogFooter className="p-4 border-t bg-muted/10">
                    {error && <span className="text-sm text-destructive mr-auto flex items-center self-center">{error}</span>}
                    <Button variant="ghost" onClick={handleClose}>
                        {executingJob ? "Close & Reset" : "Cancel"}
                    </Button>
                    {!executingJob && (
                        <Button onClick={handleSubmit} disabled={loading} className="px-8">
                            {loading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                            {saveTemplate ? "Create & Save Template" : "Start Job"}
                        </Button>
                    )}
                </DialogFooter>

                {/* Artifact Viewer Modal */}
                {selectedArtifact && (
                    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6" onClick={() => setSelectedArtifact(null)}>
                        <div className="bg-card border shadow-2xl rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                            <div className="p-4 border-b flex justify-between items-center">
                                <div>
                                    <h3 className="font-semibold">{selectedArtifact.filename}</h3>
                                    <div className="flex gap-2 mt-1">
                                        <Badge variant="secondary" className="text-xs">{selectedArtifact.type}</Badge>
                                        {selectedArtifact.role && <Badge variant="outline" className="text-xs">{selectedArtifact.role}</Badge>}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="secondary" size="sm" onClick={() => downloadArtifact(selectedArtifact)}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Download
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => setSelectedArtifact(null)}>
                                        <XCircle className="h-5 w-5" />
                                    </Button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto p-4 bg-muted/20">
                                {selectedArtifact.mime_type?.startsWith('image/') ? (
                                    <img src={artifactObjectUrl} alt="artifact" className="max-w-full rounded mx-auto shadow-md" />
                                ) : selectedArtifact.mime_type === 'application/pdf' ? (
                                    <iframe src={artifactObjectUrl} className="w-full h-[600px] rounded border" />
                                ) : (
                                    <pre className="text-xs p-4 bg-black/90 text-green-400 rounded overflow-auto font-mono">
                                        {artifactText || "Loading..."}
                                    </pre>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
