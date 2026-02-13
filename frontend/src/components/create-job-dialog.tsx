import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, GripVertical, Play, CheckCircle, Smartphone, Layers, RefreshCcw, BarChart, PenTool, Calculator, FileText, Shield, ArrowLeftRight, Bell, Globe } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    id: string; // temporary for UI key
    type: TaskType;
}

const availableTasks: { type: TaskType; label: string; icon: any; defaultPayload: any }[] = [
    {
        type: "executor",
        label: "Executor Agent",
        icon: Smartphone,
        defaultPayload: { prompt: "" }
    },
    {
        type: "reviewer",
        label: "Reviewer Agent",
        icon: CheckCircle,
        defaultPayload: { criteria: "" }
    },
    {
        type: "designer",
        label: "Designer Agent",
        icon: PenTool,
        defaultPayload: { title: "New Report", sections: [{ heading: "Introduction", content: "This is a default section." }] }
    },
    {
        type: "chart",
        label: "Chart Agent",
        icon: BarChart,
        defaultPayload: { type: "bar", title: "New Chart", x: [1, 2, 3], y: [10, 20, 30], x_label: "X", y_label: "Y" }
    },
    {
        type: "analyzer",
        label: "Analyzer Agent",
        icon: Calculator,
        defaultPayload: { data: [1, 2, 3, 4, 5], analysis_type: "summary" }
    },
    {
        type: "summarizer",
        label: "Summarizer Agent",
        icon: FileText,
        defaultPayload: { text: "", max_sentences: 3 }
    },
    {
        type: "validator",
        label: "Validator Agent",
        icon: Shield,
        defaultPayload: { data: {}, rules: {} }
    },
    {
        type: "transformer",
        label: "Transformer Agent",
        icon: ArrowLeftRight,
        defaultPayload: { data: [], transform: "uppercase" }
    },
    {
        type: "notifier",
        label: "Notifier Agent",
        icon: Bell,
        defaultPayload: { channel: "email", recipients: [], message: "" }
    },
    {
        type: "scraper",
        label: "Scraper Agent",
        icon: Globe,
        defaultPayload: { url: "", selector: "" }
    },
];

export function CreateJobDialog({ open, onOpenChange, onSuccess }: CreateJobDialogProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [tasks, setTasks] = useState<BuilderTask[]>([]);
    const [saveTemplate, setSaveTemplate] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        // Re-link parents is complex, for simple MVP we just remove and let user fix logic or assume sequential
        // A smarter builder would auto-relink. Let's keep it simple: linear chain by default.
        newTasks.forEach((t, i) => {
            if (i > 0) t.parent_task_index = i - 1;
            else delete t.parent_task_index;
        });
        setTasks(newTasks);
    };

    const updateTask = (index: number, field: keyof BuilderTask | "payload_key", value: any, payloadKey?: string) => {
        const newTasks = [...tasks];
        if (field === "payload" && payloadKey) {
            newTasks[index].payload = { ...newTasks[index].payload, [payloadKey]: value };
        } else {
            (newTasks[index] as any)[field] = value;
        }
        setTasks(newTasks);
    };

    const handleSubmit = async () => {
        if (!title) { setError("Title is required"); return; }
        if (tasks.length === 0) { setError("Add at least one task"); return; }

        setLoading(true);
        setError(null);

        try {
            // 1. Create Job
            const jobPayload = {
                title,
                tasks: tasks.map(({ id, type, ...rest }) => rest)
            };
            await createJob(jobPayload);

            // 2. Save Template if requested
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
                            params: t.payload // mapping payload to params for template
                        }))
                    }
                });
            }

            onSuccess();
            onOpenChange(false);
            // Reset form
            setTitle("");
            setDescription("");
            setTasks([]);
            setSaveTemplate(false);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || "Failed to create job");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-background/95 backdrop-blur-md border-border/60">
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

                    {/* Builder Canvas */}
                    <div className="flex-1 p-6 overflow-y-auto bg-slate-50/50 dark:bg-black/20">
                        {tasks.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60 border-2 border-dashed rounded-xl m-4">
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
                                                    {task.type === 'designer' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Report Title</Label>
                                                                <Input
                                                                    value={task.payload?.title as string || ""}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "title")}
                                                                    className="bg-muted/30"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Sections (JSON)</Label>
                                                                <Input
                                                                    value={JSON.stringify(task.payload?.sections || [])}
                                                                    onChange={(e) => {
                                                                        try {
                                                                            const parsed = JSON.parse(e.target.value);
                                                                            updateTask(index, "payload", parsed, "sections");
                                                                        } catch (err) {
                                                                            // Allow typing invalid json but maybe show error? 
                                                                            // For now just don't update if invalid or maybe handle differently.
                                                                            // Actually, simpler to just treat as string in a textarea and parse on submit?
                                                                            // Or just let them edit a JSON string.
                                                                        }
                                                                    }}
                                                                    placeholder='[{"heading": "Intro", "content": "..."}]'
                                                                    className="bg-muted/30 font-mono text-xs"
                                                                />
                                                                <p className="text-[10px] text-muted-foreground">Enter valid JSON array of sections.</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'chart' && (
                                                        <div className="space-y-3">
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Chart Title</Label>
                                                                    <Input
                                                                        value={task.payload?.title as string || ""}
                                                                        onChange={(e) => updateTask(index, "payload", e.target.value, "title")}
                                                                        className="bg-muted/30"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Type</Label>
                                                                    <select
                                                                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                                        value={task.payload?.type as string || "bar"}
                                                                        onChange={(e) => updateTask(index, "payload", e.target.value, "type")}
                                                                    >
                                                                        <option value="bar">Bar</option>
                                                                        <option value="line">Line</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">X Data (JSON)</Label>
                                                                    <Input
                                                                        value={JSON.stringify(task.payload?.x || [])}
                                                                        onChange={(e) => {
                                                                            try { updateTask(index, "payload", JSON.parse(e.target.value), "x"); } catch (e) { }
                                                                        }}
                                                                        className="bg-muted/30 font-mono text-xs"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Y Data (JSON)</Label>
                                                                    <Input
                                                                        value={JSON.stringify(task.payload?.y || [])}
                                                                        onChange={(e) => {
                                                                            try { updateTask(index, "payload", JSON.parse(e.target.value), "y"); } catch (e) { }
                                                                        }}
                                                                        className="bg-muted/30 font-mono text-xs"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'analyzer' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Data (JSON Array)</Label>
                                                                <Input
                                                                    value={JSON.stringify(task.payload?.data || [])}
                                                                    onChange={(e) => {
                                                                        try { updateTask(index, "payload", JSON.parse(e.target.value), "data"); } catch (e) { }
                                                                    }}
                                                                    placeholder='[1, 2, 3, 4, 5]'
                                                                    className="bg-muted/30 font-mono text-xs"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Analysis Type</Label>
                                                                <select
                                                                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    value={task.payload?.analysis_type as string || "summary"}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "analysis_type")}
                                                                >
                                                                    <option value="summary">Summary (mean, median, min, max)</option>
                                                                    <option value="trend">Trend Detection</option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'summarizer' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Text to Summarize</Label>
                                                                <Input
                                                                    value={task.payload?.text as string || ""}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "text")}
                                                                    placeholder="Enter long text here..."
                                                                    className="bg-muted/30"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Max Sentences</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={task.payload?.max_sentences as number || 3}
                                                                    onChange={(e) => updateTask(index, "payload", parseInt(e.target.value), "max_sentences")}
                                                                    className="bg-muted/30"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'validator' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Data to Validate (JSON)</Label>
                                                                <Input
                                                                    value={JSON.stringify(task.payload?.data || {})}
                                                                    onChange={(e) => {
                                                                        try { updateTask(index, "payload", JSON.parse(e.target.value), "data"); } catch (e) { }
                                                                    }}
                                                                    placeholder='{"email": "test@test.com", "age": 25}'
                                                                    className="bg-muted/30 font-mono text-xs"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Validation Rules (JSON)</Label>
                                                                <Input
                                                                    value={JSON.stringify(task.payload?.rules || {})}
                                                                    onChange={(e) => {
                                                                        try { updateTask(index, "payload", JSON.parse(e.target.value), "rules"); } catch (e) { }
                                                                    }}
                                                                    placeholder='{"email": {"required": true}, "age": {"type": "number", "min": 18}}'
                                                                    className="bg-muted/30 font-mono text-xs"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'transformer' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Data to Transform (JSON Array)</Label>
                                                                <Input
                                                                    value={JSON.stringify(task.payload?.data || [])}
                                                                    onChange={(e) => {
                                                                        try { updateTask(index, "payload", JSON.parse(e.target.value), "data"); } catch (e) { }
                                                                    }}
                                                                    placeholder='["a", "b", "c"]'
                                                                    className="bg-muted/30 font-mono text-xs"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Transform Type</Label>
                                                                <select
                                                                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    value={task.payload?.transform as string || "uppercase"}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "transform")}
                                                                >
                                                                    <option value="uppercase">Uppercase</option>
                                                                    <option value="lowercase">Lowercase</option>
                                                                    <option value="reverse">Reverse Order</option>
                                                                    <option value="unique">Remove Duplicates</option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'notifier' && (
                                                        <div className="space-y-3">
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Channel</Label>
                                                                    <select
                                                                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                                        value={task.payload?.channel as string || "email"}
                                                                        onChange={(e) => updateTask(index, "payload", e.target.value, "channel")}
                                                                    >
                                                                        <option value="email">Email</option>
                                                                        <option value="slack">Slack</option>
                                                                        <option value="sms">SMS</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-xs text-muted-foreground">Recipients (JSON Array)</Label>
                                                                    <Input
                                                                        value={JSON.stringify(task.payload?.recipients || [])}
                                                                        onChange={(e) => {
                                                                            try { updateTask(index, "payload", JSON.parse(e.target.value), "recipients"); } catch (e) { }
                                                                        }}
                                                                        placeholder='["user@test.com"]'
                                                                        className="bg-muted/30 font-mono text-xs"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">Message</Label>
                                                                <Input
                                                                    value={task.payload?.message as string || ""}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "message")}
                                                                    placeholder="Notification message..."
                                                                    className="bg-muted/30"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {task.type === 'scraper' && (
                                                        <div className="space-y-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">URL to Scrape</Label>
                                                                <Input
                                                                    value={task.payload?.url as string || ""}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "url")}
                                                                    placeholder="https://example.com"
                                                                    className="bg-muted/30"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs text-muted-foreground">CSS Selector</Label>
                                                                <Input
                                                                    value={task.payload?.selector as string || ""}
                                                                    onChange={(e) => updateTask(index, "payload", e.target.value, "selector")}
                                                                    placeholder=".content or #main"
                                                                    className="bg-muted/30"
                                                                />
                                                            </div>
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
        </Dialog >
    );
}
