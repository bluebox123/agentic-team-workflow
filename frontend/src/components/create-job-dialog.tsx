import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, GripVertical, Play, CheckCircle, Smartphone, Layers, RefreshCcw, BarChart, PenTool, Calculator, FileText, Shield, ArrowLeftRight, Bell, Globe, LayoutGrid, List } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowBuilder, type WorkflowDAG } from "./WorkflowBuilder";
import { createWorkflow } from "../api/workflows";
import { createJob, type TaskConfig } from "../api/jobs";
import { cn } from "@/lib/utils";

interface CreateJobDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

type TaskType = "executor" | "reviewer" | "designer" | "chart" | "analyzer" | "summarizer" | "validator" | "transformer" | "notifier" | "scraper";

interface BuilderTask extends TaskConfig {
    id: string;
    type: TaskType;
}

const availableTasks: { type: TaskType; label: string; icon: React.ElementType; defaultPayload: Record<string, unknown> }[] = [
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

    const handleVisualWorkflowChange = (workflow: WorkflowDAG) => {
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
    };

    const handleSubmit = async () => {
        if (!title) { setError("Title is required"); return; }
        if (tasks.length === 0) { setError("Add at least one task"); return; }

        setLoading(true);
        setError(null);

        try {
            const jobPayload = {
                title,
                tasks: tasks.map((t) => ({ ...t, id: undefined, type: undefined })).map(({ id: _id, type: _type, ...rest }) => rest)
            };
            await createJob(jobPayload);

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

            onSuccess();
            onOpenChange(false);
            setTitle("");
            setDescription("");
            setTasks([]);
            setSaveTemplate(false);
            setVisualWorkflow(null);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create job";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
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
                                    <TabsTrigger value="list" className="gap-2">
                                        <List className="w-4 h-4" />
                                        List View
                                    </TabsTrigger>
                                    <TabsTrigger value="visual" className="gap-2">
                                        <LayoutGrid className="w-4 h-4" />
                                        Visual Builder
                                    </TabsTrigger>
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

                            <TabsContent value="visual" className="flex-1 overflow-hidden m-0 p-0">
                                <WorkflowBuilder
                                    workflow={visualWorkflow || undefined}
                                    onWorkflowChange={handleVisualWorkflowChange}
                                    mode="build"
                                />
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                <DialogFooter className="p-4 border-t bg-muted/10">
                    {error && <span className="text-sm text-destructive mr-auto flex items-center self-center">{error}</span>}
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={loading} className="px-8">
                        {loading ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                        {saveTemplate ? "Create & Save Template" : "Start Job"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
