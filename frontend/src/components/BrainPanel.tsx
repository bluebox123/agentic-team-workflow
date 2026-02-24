
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { WorkflowVisualizer } from './WorkflowVisualizer';
import { analyzeRequest, type BrainAnalysisResult } from '../api/brain';
import { createJob, fetchJobTasks, fetchJobs, type Job, type TaskConfig } from '../api/jobs';
import { fetchArtifacts, fetchArtifactBlob, fetchArtifactText, type Artifact } from '../api/artifacts';
import { fetchLogs } from '../api/logs';
import { Loader2, Play, Sparkles, Save, Trash2, Clock, CheckCircle, XCircle, AlertCircle, FileText, Activity, Download } from 'lucide-react';
import type { WorkflowDAG } from '../api/brain';
import { Input } from './ui/input';
import { createWorkflowFromJob } from '../api/workflows';

interface SavedPrompt {
    id: string;
    prompt: string;
    timestamp: number;
}

interface JobTask {
    id: string;
    name: string;
    status: string;
}

function toJobTask(value: unknown): JobTask | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as { id?: unknown; name?: unknown; status?: unknown };
    if (typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.status !== 'string') return null;
    return { id: v.id, name: v.name, status: v.status };
}

export function BrainPanel() {
    const [prompt, setPrompt] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<BrainAnalysisResult | null>(null);
    const [plannedWorkflow, setPlannedWorkflow] = useState<WorkflowDAG | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionStatus, setExecutionStatus] = useState<string | null>(null);

    const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
    const [saveTemplateError, setSaveTemplateError] = useState<string | null>(null);

    // Prompt History
    const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);

    // Job Status Tracking
    const [executingJob, setExecutingJob] = useState<Job | null>(null);
    const [jobLogs, setJobLogs] = useState<Array<{ level: string; message: string; created_at: string }>>([]);
    const [jobArtifacts, setJobArtifacts] = useState<Artifact[]>([]);
    const [jobTasks, setJobTasks] = useState<JobTask[]>([]);
    const [autoRefreshInterval, setAutoRefreshInterval] = useState<ReturnType<typeof setInterval> | null>(null);

    const taskStatusByName = useMemo(() => {
        const map: Record<string, string> = {};
        for (const t of jobTasks) {
            map[t.name] = t.status;
        }
        return map;
    }, [jobTasks]);

    // Artifact Viewing
    const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
    const [artifactText, setArtifactText] = useState<string>("");
    const [artifactObjectUrl, setArtifactObjectUrl] = useState<string>("");

    // Load saved prompts from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('aiPromptHistory');
        if (saved) {
            try {
                setSavedPrompts(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to load prompt history', e);
            }
        }
    }, []);

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

    // Save prompt to history
    const savePrompt = () => {
        if (!prompt.trim()) return;

        const newPrompt: SavedPrompt = {
            id: Date.now().toString(),
            prompt: prompt.trim(),
            timestamp: Date.now()
        };

        const updated = [newPrompt, ...savedPrompts].slice(0, 10); // Keep only last 10
        setSavedPrompts(updated);
        localStorage.setItem('aiPromptHistory', JSON.stringify(updated));

        setExecutionStatus('Prompt saved to history!');
        setTimeout(() => setExecutionStatus(null), 2000);
    };

    // Delete prompt from history
    const deletePrompt = (id: string) => {
        const updated = savedPrompts.filter(p => p.id !== id);
        setSavedPrompts(updated);
        localStorage.setItem('aiPromptHistory', JSON.stringify(updated));
    };

    // Load prompt from history
    const loadPrompt = (savedPrompt: SavedPrompt) => {
        setPrompt(savedPrompt.prompt);
        setExecutionStatus('Prompt loaded from history!');
        setTimeout(() => setExecutionStatus(null), 2000);
    };

    // View artifact content
    const viewArtifact = async (artifact: Artifact) => {
        setSelectedArtifact(artifact);
        setArtifactText("");
        if (artifactObjectUrl) {
            URL.revokeObjectURL(artifactObjectUrl);
            setArtifactObjectUrl("");
        }

        // Detect mime type: use metadata or fall back to filename extension
        const mime = artifact.mime_type || "";
        const filename = (artifact.filename || "").toLowerCase();
        const isPdf = mime === 'application/pdf' || filename.endsWith('.pdf');
        const isImage = mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(filename);
        const isText = !isPdf && !isImage && (mime.startsWith('text/') || mime === 'application/json' || mime === '' || /\.(txt|json|csv|md|log)$/.test(filename));

        if (isText) {
            try {
                const text = await fetchArtifactText(artifact.id);
                setArtifactText(text);
            } catch (error) {
                console.error('Failed to fetch artifact text:', error);
                setArtifactText("Failed to load artifact content.");
            }
            return;
        }

        if (isPdf || isImage) {
            try {
                const blob = await fetchArtifactBlob(artifact.id);
                // Ensure the blob has the correct content type
                const typedBlob = isPdf
                    ? new Blob([blob], { type: 'application/pdf' })
                    : blob;
                const url = URL.createObjectURL(typedBlob);
                setArtifactObjectUrl(url);
            } catch (error) {
                console.error('Failed to fetch artifact blob:', error);
                setArtifactText("Failed to load binary artifact.");
            }
            return;
        }

        // Generic fallback: try as text
        try {
            const text = await fetchArtifactText(artifact.id);
            setArtifactText(text);
        } catch (error) {
            console.error('Failed to fetch artifact:', error);
            setArtifactText("Unable to display this artifact type.");
        }
    };

    // Download artifact
    const downloadArtifact = async (artifact: Artifact) => {
        try {
            const blob = await fetchArtifactBlob(artifact.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = artifact.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download artifact:', error);
        }
    };

    // Auto-refresh job status
    const startJobTracking = useCallback(async (jobId: string) => {
        const refreshJobStatus = async () => {
            try {
                const jobs = await fetchJobs('mine');
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
                        if (latestTask?.id && typeof latestTask.id === 'string') {
                            const logs = await fetchLogs(latestTask.id);
                            setJobLogs(logs);
                        }
                    }

                    // Stop tracking if job is complete
                    if (job.status !== 'RUNNING' && job.status !== 'PENDING') {
                        if (autoRefreshInterval) {
                            clearInterval(autoRefreshInterval);
                            setAutoRefreshInterval(null);
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to refresh job status', error);
            }
        };

        // Initial fetch
        await refreshJobStatus();

        // Set up auto-refresh
        const interval = setInterval(refreshJobStatus, 3000);
        setAutoRefreshInterval(interval);
    }, [autoRefreshInterval]);

    const handleAnalyze = async () => {
        if (!prompt.trim()) return;
        setIsAnalyzing(true);
        setAnalysisResult(null);
        setExecutionStatus(null);
        try {
            const result = await analyzeRequest(prompt);
            setAnalysisResult(result);
            if (result.workflow) setPlannedWorkflow(result.workflow);
        } catch (error) {
            console.error(error);
            setExecutionStatus("Analysis failed. See console.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleExecute = async () => {
        if (!analysisResult?.workflow) return;
        setIsExecuting(true);
        setExecutionStatus(null);
        try {
            const executionOrder = analysisResult.workflow.executionOrder || analysisResult.workflow.nodes.map(n => n.id);

            const tasks: TaskConfig[] = [];
            for (let index = 0; index < executionOrder.length; index++) {
                const nodeId = executionOrder[index];
                const node = analysisResult.workflow.nodes.find(n => n.id === nodeId);
                if (!node) continue;

                // For tasks with multiple dependencies, find the LAST dependency in execution order
                // This ensures the task waits for ALL dependencies to complete before running
                let parentIndex: number | undefined = undefined;
                if (node.dependencies.length > 0) {
                    // Find the dependency that appears LATEST in execution order
                    // This ensures task waits for ALL dependencies
                    const dependencyIndices = node.dependencies
                        .map(depId => executionOrder.indexOf(depId))
                        .filter(idx => idx !== -1 && idx < index);

                    if (dependencyIndices.length > 0) {
                        // Use the last dependency (highest index) as the parent
                        // This ensures all previous dependencies complete first
                        parentIndex = Math.max(...dependencyIndices);
                    }
                }

                tasks.push({
                    name: node.id, // Use node ID as task name for template placeholder matching
                    agent_type: node.agentType,
                    payload: node.inputs,
                    parent_task_index: parentIndex,
                });
            }

            const createdJobResponse = await createJob({
                title: `AI Job: ${prompt.substring(0, 30)}...`,
                tasks: tasks
            });

            setExecutionStatus("Job started successfully!");
            setAnalysisResult(null);

            // Start tracking the job
            if (createdJobResponse && createdJobResponse.jobId) {
                await startJobTracking(createdJobResponse.jobId);
            }
        } catch (error) {
            console.error(error);
            setExecutionStatus("Execution failed.");
        } finally {
            setIsExecuting(false);
        }
    };

    const submitSaveTemplate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!executingJob) return;
        setSaveTemplateError(null);
        try {
            const form = e.currentTarget;
            const name = (form.elements.namedItem('template_name') as HTMLInputElement).value;
            const description = (form.elements.namedItem('template_description') as HTMLInputElement).value;
            await createWorkflowFromJob({
                jobId: executingJob.id,
                name,
                description: description || undefined,
                prompt: prompt.trim() || undefined,
                visualDag: plannedWorkflow ?? undefined,
            });
            setShowSaveTemplateModal(false);
            setExecutionStatus('Saved as template!');
            setTimeout(() => setExecutionStatus(null), 2000);
        } catch (err) {
            const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : 'Failed to save template';
            setSaveTemplateError(msg);
        }
    };

    return (
        <>
            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
                {/* Main Content Area */}
                <div className="space-y-6">
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-indigo-500" />
                                AI Workflow Creator
                            </CardTitle>
                            <CardDescription>
                                Describe your task in plain English, and the Brain will plan a workflow for you.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Textarea
                                    placeholder="e.g. 'Scrape https://example.com, summarize the content, and email it to user@example.com'"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onInput={(e) => setPrompt(e.currentTarget.value)}
                                    onPasteCapture={(e) => {
                                        // Give the DOM a tick to update the textarea value after paste
                                        setTimeout(() => {
                                            if (e.target instanceof HTMLTextAreaElement) {
                                                setPrompt(e.target.value);
                                            }
                                        }, 10);
                                    }}
                                    className="flex-1 min-h-[120px]"
                                />
                            </div>
                            <div className="flex justify-between items-center">
                                <Button
                                    variant="outline"
                                    onClick={savePrompt}
                                    disabled={!prompt.trim()}
                                    size="sm"
                                >
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Prompt
                                </Button>
                                <Button
                                    onClick={handleAnalyze}
                                    disabled={isAnalyzing || !prompt.trim()}
                                >
                                    {isAnalyzing ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Analyzing...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="mr-2 h-4 w-4" />
                                            Generate Plan
                                        </>
                                    )}
                                </Button>
                            </div>

                            {executionStatus && (
                                <div className={`p-3 rounded-md text-sm transition-all duration-300 ${executionStatus.includes("failed") || executionStatus.includes("Execution failed")
                                    ? "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                                    : "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                    }`}>
                                    {executionStatus}
                                </div>
                            )}

                            {analysisResult && (
                                <div className="mt-6 border-t pt-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold">Proposed Workflow</h3>
                                        {analysisResult.canExecute && (
                                            <Button onClick={handleExecute} disabled={isExecuting}>
                                                {isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                                                Execute Workflow
                                            </Button>
                                        )}
                                    </div>

                                    {!analysisResult.canExecute ? (
                                        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
                                            <p className="font-semibold">Cannot Execute:</p>
                                            <p>{analysisResult.reasonIfCannot}</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="bg-muted p-4 rounded-md text-sm text-muted-foreground">
                                                {analysisResult.explanation}
                                            </div>
                                            {analysisResult.workflow && (
                                                <WorkflowVisualizer workflow={analysisResult.workflow} taskStatusByName={taskStatusByName} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Job Execution Status */}
                    {executingJob && (
                        <Card className="w-full border-l-4 border-l-indigo-500 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        {executingJob.status === 'RUNNING' && <Activity className="h-4 w-4 text-blue-500 animate-pulse" />}
                                        {executingJob.status === 'SUCCESS' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                        {executingJob.status === 'FAILED' && <XCircle className="h-4 w-4 text-red-500" />}
                                        {executingJob.status === 'PENDING' && <AlertCircle className="h-4 w-4 text-yellow-500" />}
                                        Job Execution: {executingJob.title}
                                    </CardTitle>
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
                            <CardContent className="space-y-4">
                                <div className="flex gap-2">
                                    <Button variant="secondary" size="sm" onClick={() => { setSaveTemplateError(null); setShowSaveTemplateModal(true); }}>
                                        <Save className="mr-2 h-4 w-4" /> Save as Template
                                    </Button>
                                </div>
                                {plannedWorkflow && (
                                    <div className="rounded-md border bg-muted/20 p-3">
                                        <WorkflowVisualizer workflow={plannedWorkflow} taskStatusByName={taskStatusByName} />
                                    </div>
                                )}
                                {/* Tasks */}
                                {jobTasks.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                            <Activity className="h-4 w-4" />
                                            Tasks ({jobTasks.filter(t => t.status === 'SUCCESS').length}/{jobTasks.length} completed)
                                        </h4>
                                        <div className="space-y-2">
                                            {jobTasks.map(task => (
                                                <div key={task.id} className="flex items-center gap-2 p-2 rounded bg-muted/50 transition-all duration-300">
                                                    {task.status === 'SUCCESS' && <CheckCircle className="h-3 w-3 text-green-500" />}
                                                    {task.status === 'FAILED' && <XCircle className="h-3 w-3 text-red-500" />}
                                                    {task.status === 'RUNNING' && <Activity className="h-3 w-3 text-blue-500 animate-pulse" />}
                                                    {task.status === 'PENDING' && <Clock className="h-3 w-3 text-gray-400" />}
                                                    <span className="text-xs font-medium">{task.name}</span>
                                                    <Badge variant="outline" className="text-[10px] ml-auto">{task.status}</Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Logs */}
                                {jobLogs.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                            <FileText className="h-4 w-4" />
                                            Logs (Last {Math.min(jobLogs.length, 5)})
                                        </h4>
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
                                )}

                                {/* Artifacts */}
                                {jobArtifacts.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                            <FileText className="h-4 w-4" />
                                            Artifacts ({jobArtifacts.length})
                                        </h4>
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
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Prompt History Sidebar */}
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Clock className="h-4 w-4 text-indigo-500" />
                                Prompt History
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Your last {savedPrompts.length} saved prompts
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {savedPrompts.length === 0 ? (
                                <div className="text-center p-8 text-sm text-muted-foreground">
                                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p>No saved prompts yet</p>
                                    <p className="text-xs mt-1">Click "Save Prompt" to save</p>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[600px] overflow-auto">
                                    {savedPrompts.map((saved) => (
                                        <div
                                            key={saved.id}
                                            className="group p-3 border rounded-lg hover:border-indigo-500 hover:bg-muted/50 transition-all duration-200 cursor-pointer"
                                            onClick={() => loadPrompt(saved)}
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <span className="text-[10px] text-muted-foreground">
                                                    {new Date(saved.timestamp).toLocaleString()}
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deletePrompt(saved.id);
                                                    }}
                                                >
                                                    <Trash2 className="h-3 w-3 text-red-500" />
                                                </Button>
                                            </div>
                                            <p className="text-xs line-clamp-3">{saved.prompt}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

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
                            {selectedArtifact.mime_type?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test((selectedArtifact.filename || '').toLowerCase()) ? (
                                <img src={artifactObjectUrl} alt="artifact" className="max-w-full rounded mx-auto shadow-md" />
                            ) : selectedArtifact.mime_type === 'application/pdf' || (selectedArtifact.filename || '').toLowerCase().endsWith('.pdf') ? (
                                artifactObjectUrl ? (
                                    <embed
                                        src={artifactObjectUrl}
                                        type="application/pdf"
                                        className="w-full h-[600px] rounded border"
                                        title={selectedArtifact.filename}
                                    />
                                ) : (
                                    <div className="text-center p-8 text-muted-foreground">
                                        <p>Loading PDF...</p>
                                    </div>
                                )
                            ) : (
                                <pre className="text-xs p-4 bg-black/90 text-green-400 rounded overflow-auto font-mono">
                                    {artifactText || "Loading..."}
                                </pre>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showSaveTemplateModal && executingJob && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6" onClick={() => setShowSaveTemplateModal(false)}>
                    <div className="bg-card border shadow-2xl rounded-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b">
                            <div className="font-semibold">Save as Template</div>
                            <div className="text-xs text-muted-foreground mt-1">Save this AI Creator job so it can be re-run from Templates.</div>
                        </div>
                        <div className="p-4">
                            <form onSubmit={submitSaveTemplate} id="saveTemplateForm" className="space-y-4">
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">Template name</div>
                                    <Input name="template_name" required defaultValue={executingJob.title} />
                                </div>
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">Description</div>
                                    <Input name="template_description" />
                                </div>
                                {saveTemplateError && (
                                    <div className="text-sm text-destructive">{saveTemplateError}</div>
                                )}
                            </form>
                        </div>
                        <div className="p-4 border-t flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setShowSaveTemplateModal(false)}>Cancel</Button>
                            <Button type="submit" form="saveTemplateForm">Save</Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
