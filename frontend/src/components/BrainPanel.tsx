
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { WorkflowVisualizer } from './WorkflowVisualizer';
import { analyzeRequest, type BrainAnalysisResult } from '../api/brain';
import { createJob, fetchJobTasks, fetchJobs, type Job } from '../api/jobs';
import { fetchArtifacts, fetchArtifactBlob, fetchArtifactText, type Artifact } from '../api/artifacts';
import { fetchLogs } from '../api/logs';
import { Loader2, Play, Sparkles, Save, Trash2, Clock, CheckCircle, XCircle, AlertCircle, FileText, Activity, Download } from 'lucide-react';

interface SavedPrompt {
    id: string;
    prompt: string;
    timestamp: number;
}

export function BrainPanel() {
    const [prompt, setPrompt] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<BrainAnalysisResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionStatus, setExecutionStatus] = useState<string | null>(null);

    // Prompt History
    const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);

    // Job Status Tracking
    const [executingJob, setExecutingJob] = useState<Job | null>(null);
    const [jobLogs, setJobLogs] = useState<Array<{ level: string; message: string; created_at: string }>>([]);
    const [jobArtifacts, setJobArtifacts] = useState<Artifact[]>([]);
    const [jobTasks, setJobTasks] = useState<any[]>([]);
    const [autoRefreshInterval, setAutoRefreshInterval] = useState<number | null>(null);

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

        const mime = artifact.mime_type || "";
        if (mime.startsWith("text/") || mime === "" || mime === "application/json") {
            try {
                const text = await fetchArtifactText(artifact.id);
                setArtifactText(text);
            } catch (error) {
                console.error('Failed to fetch artifact text:', error);
                setArtifactText("Failed to load artifact content.");
            }
            return;
        }

        if (mime.startsWith('image/') || mime === 'application/pdf') {
            try {
                const blob = await fetchArtifactBlob(artifact.id);
                const url = URL.createObjectURL(blob);
                setArtifactObjectUrl(url);
            } catch (error) {
                console.error('Failed to fetch artifact blob:', error);
            }
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
                    const [tasks, artifacts] = await Promise.all([
                        fetchJobTasks(jobId),
                        fetchArtifacts(jobId)
                    ]);

                    setJobTasks(tasks);
                    setJobArtifacts(artifacts);

                    // Get logs from the latest task
                    if (tasks.length > 0) {
                        const latestTask = tasks[tasks.length - 1];
                        const logs = await fetchLogs(latestTask.id);
                        setJobLogs(logs);
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
        setAutoRefreshInterval(interval as any);
    }, [autoRefreshInterval]);

    const handleAnalyze = async () => {
        if (!prompt.trim()) return;
        setIsAnalyzing(true);
        setAnalysisResult(null);
        setExecutionStatus(null);
        try {
            const result = await analyzeRequest(prompt);
            setAnalysisResult(result);
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

            const tasks = executionOrder.map((nodeId, index) => {
                const node = analysisResult.workflow!.nodes.find(n => n.id === nodeId);
                if (!node) return null;

                let parentIndex: number | undefined = undefined;
                if (node.dependencies.length > 0) {
                    const parentId = node.dependencies[0];
                    parentIndex = executionOrder.indexOf(parentId);
                    if (parentIndex === -1 || parentIndex >= index) {
                        console.warn(`Dependency ${parentId} for ${nodeId} not found or invalid order.`);
                        parentIndex = undefined;
                    }
                }

                return {
                    name: node.id, // Use node ID as task name for template placeholder matching
                    agent_type: node.agentType,
                    payload: node.inputs,
                    parent_task_index: parentIndex
                };
            }).filter(t => t !== null) as any[];

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
                                                <WorkflowVisualizer workflow={analysisResult.workflow} />
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
        </>
    );
}
