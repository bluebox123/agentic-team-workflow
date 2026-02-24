import { useState, useEffect, useCallback } from 'react';
import { fetchJobs, fetchJobTasks, cancelJob, pauseJob, resumeJob, deleteJob, type Job, type Task } from './api/jobs';
import { fetchWorkflows, createWorkflow, runWorkflow, fetchWorkflowVersion, fetchWorkflow, createWorkflowFromJob, type WorkflowTemplate, type DagDefinition } from './api/workflows';
import { fetchArtifacts, fetchArtifactBlob, fetchArtifactText, type Artifact } from './api/artifacts';
import { fetchDLQ } from './api/dlq';
import { retryTask, skipTask, failTask, reviewTask } from './api/tasks';
import { fetchLogs } from './api/logs';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JobTable } from "@/components/JobTable";
import { ThemeProvider } from "@/components/theme-provider"
import { ModeToggle } from "@/components/mode-toggle"
import { CreateJobDialog } from "@/components/create-job-dialog"
import { BrainPanel } from "@/components/BrainPanel";
// import { TiltCard } from "@/components/tilt-card" // Removed 3D effect
import { LayoutDashboard, Activity, AlertCircle, FileText, Layers, RefreshCcw, LogOut, Play, CheckCircle, XCircle, Sparkles, Save } from "lucide-react";
import { WorkflowBuilder } from "@/components/WorkflowBuilder";
import type { WorkflowDAG } from "./api/brain";

function getErrorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const possible = e as { response?: { data?: { error?: string } }, message?: string };
    return possible.response?.data?.error || possible.message || 'Request failed';
  }
  return 'Request failed';
}

function StatusBadge({ status }: { status: string }) {
  if (status === "SUCCESS") return <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 border-transparent">{status}</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">{status}</Badge>;
  if (status === "RUNNING") return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-500/20">{status}</Badge>;
  if (status === "PENDING" || status === "QUEUED") return <Badge variant="outline">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));

  const [jobs, setJobs] = useState<Job[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [artifactText, setArtifactText] = useState<string>("");
  const [artifactObjectUrl, setArtifactObjectUrl] = useState<string>("");
  const [dlqMessages, setDlqMessages] = useState<Array<Record<string, unknown>>>([]);

  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobTasks, setJobTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskLogs, setTaskLogs] = useState<Array<{ level: string; message: string; created_at: string }>>([]);

  const [refreshInterval, setRefreshInterval] = useState<number | null>(null);
  const [logsInterval, setLogsInterval] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<'jobs' | 'workflows' | 'dlq' | 'brain' | 'help'>('brain');
  const [jobsScope, setJobsScope] = useState<'mine' | 'org'>(() => (localStorage.getItem('jobsScope') as 'mine' | 'org') || 'mine');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showCreateWorkflow, setShowCreateWorkflow] = useState(false);

  // Run workflow modal state
  const [showRunModal, setShowRunModal] = useState(false);
  const [runTemplateId, setRunTemplateId] = useState<string | null>(null);
  const [runTemplateName, setRunTemplateName] = useState<string>("");
  const [runVersion, setRunVersion] = useState<number | null>(null);
  const [runPlaceholders, setRunPlaceholders] = useState<string[]>([]);
  const [runParams, setRunParams] = useState<Record<string, string>>({});
  const [runError, setRunError] = useState<string | null>(null);

  // Save job as template modal state
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [saveTemplateJobId, setSaveTemplateJobId] = useState<string | null>(null);
  const [saveTemplateError, setSaveTemplateError] = useState<string | null>(null);

  // Template detail modal state
  const [showTemplateDetailModal, setShowTemplateDetailModal] = useState(false);
  const [templateDetail, setTemplateDetail] = useState<{ id: string; name: string; description: string | null; version: number; dag: DagDefinition } | null>(null);
  const [templateDetailError, setTemplateDetailError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const [jobsData, workflowsData] = await Promise.all([
        fetchJobs(jobsScope),
        fetchWorkflows(),
      ]);
      setJobs(jobsData);
      setWorkflows(workflowsData);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, jobsScope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Cleanup intervals
  useEffect(() => {
    return () => {
      if (refreshInterval) clearInterval(refreshInterval);
      if (logsInterval) clearInterval(logsInterval);
    };
  }, [refreshInterval, logsInterval]);

  // Auto-refresh jobs list every 5s when there are RUNNING/PENDING jobs
  useEffect(() => {
    if (!isAuthenticated) return;
    const hasActiveJobs = jobs.some(j => j.status === 'RUNNING' || j.status === 'PENDING');
    if (!hasActiveJobs) return;

    const id = setInterval(async () => {
      try {
        const updated = await fetchJobs(jobsScope);
        setJobs(updated);
        // Also refresh selected job if it's still running
        if (selectedJob) {
          const fresh = updated.find(j => j.id === selectedJob.id);
          if (fresh) setSelectedJob(fresh);
        }
      } catch {
        // silently ignore auto-refresh errors
      }
    }, 5000);

    return () => clearInterval(id);
  }, [jobs, isAuthenticated, jobsScope, selectedJob]);


  useEffect(() => {
    return () => {
      if (artifactObjectUrl) URL.revokeObjectURL(artifactObjectUrl);
    };
  }, [artifactObjectUrl]);

  const viewArtifact = async (artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setArtifactText("");
    if (artifactObjectUrl) {
      URL.revokeObjectURL(artifactObjectUrl);
      setArtifactObjectUrl("");
    }

    // Use mime_type or fall back to filename extension detection
    const mime = artifact.mime_type || "";
    const filename = (artifact.filename || "").toLowerCase();
    const isPdf = mime === 'application/pdf' || filename.endsWith('.pdf');
    const isImage = mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(filename);
    const isText = !isPdf && !isImage && (mime.startsWith('text/') || mime === 'application/json' || mime === '' || /\.(txt|json|csv|md|log)$/.test(filename));

    if (isText) {
      try {
        const text = await fetchArtifactText(artifact.id);
        setArtifactText(text);
      } catch (e) {
        setError(getErrorMessage(e));
      }
      return;
    }

    if (isPdf || isImage) {
      try {
        const blob = await fetchArtifactBlob(artifact.id);
        const typedBlob = isPdf ? new Blob([blob], { type: 'application/pdf' }) : blob;
        const url = URL.createObjectURL(typedBlob);
        setArtifactObjectUrl(url);
      } catch (e) {
        setError(getErrorMessage(e));
      }
      return;
    }

    // Generic fallback: try as text
    try {
      const text = await fetchArtifactText(artifact.id);
      setArtifactText(text);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const openSaveTemplateModal = (jobId: string) => {
    setSaveTemplateError(null);
    setSaveTemplateJobId(jobId);
    setShowSaveTemplateModal(true);
  };

  const submitSaveTemplate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!saveTemplateJobId) return;
    setSaveTemplateError(null);
    try {
      const form = e.currentTarget;
      const name = (form.elements.namedItem('template_name') as HTMLInputElement).value;
      const description = (form.elements.namedItem('template_description') as HTMLInputElement).value;
      await createWorkflowFromJob({ jobId: saveTemplateJobId, name, description: description || undefined });
      setShowSaveTemplateModal(false);
      loadData();
    } catch (err) {
      setSaveTemplateError(getErrorMessage(err));
    }
  };

  const openTemplateDetail = async (wf: WorkflowTemplate) => {
    setTemplateDetailError(null);
    try {
      const detail = await fetchWorkflow(wf.id);
      const versions = Array.isArray(detail.versions) ? detail.versions : [];
      const latest = versions.length ? Math.max(...versions.map(v => v.version)) : 1;
      const { dag } = await fetchWorkflowVersion(wf.id, latest);
      setTemplateDetail({ id: wf.id, name: wf.name, description: wf.description, version: latest, dag });
      setShowTemplateDetailModal(true);
    } catch (err) {
      setTemplateDetailError(getErrorMessage(err));
    }
  };

  const runFromTemplateDetail = async () => {
    if (!templateDetail) return;
    try {
      await runWorkflow(templateDetail.id, { version: templateDetail.version, title: `${templateDetail.name} run` });
      setShowTemplateDetailModal(false);
      loadData();
    } catch (err) {
      setTemplateDetailError(getErrorMessage(err));
    }
  };

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
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleLogin = () => {
    const normalized = token.trim();
    localStorage.setItem('token', normalized);
    setToken(normalized);
    setIsAuthenticated(true);
    loadData();
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setIsAuthenticated(false);
  };

  const changeJobsScope = (scope: 'mine' | 'org') => {
    setJobsScope(scope);
    localStorage.setItem('jobsScope', scope);
  };

  const viewJobDetails = async (job: Job) => {
    setSelectedJob(job);
    setSelectedTask(null);

    if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }
    if (logsInterval) {
      clearInterval(logsInterval);
      setLogsInterval(null);
    }

    try {
      const [tasks, arts] = await Promise.all([
        fetchJobTasks(job.id),
        fetchArtifacts(job.id)
      ]);
      setJobTasks(tasks);
      setArtifacts(arts);
      setSelectedArtifact(null);
      setArtifactText("");

      if (job.status === 'RUNNING' || job.status === 'PAUSED') {
        const interval = setInterval(async () => {
          try {
            const [updatedTasks, updatedArts] = await Promise.all([
              fetchJobTasks(job.id),
              fetchArtifacts(job.id)
            ]);
            setJobTasks(updatedTasks);
            setArtifacts(updatedArts);

            const updatedJobs = await fetchJobs(jobsScope);
            setJobs(updatedJobs);

            const updatedJob = updatedJobs.find(j => j.id === job.id);
            if (updatedJob && updatedJob.status !== job.status) {
              setSelectedJob(updatedJob);
              if (updatedJob.status !== 'RUNNING' && updatedJob.status !== 'PAUSED') {
                clearInterval(interval);
                setRefreshInterval(null);
              }
            }
          } catch (e) {
            console.error('Auto-refresh failed:', e);
          }
        }, 3000);
        setRefreshInterval(interval);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const viewTaskLogs = async (task: Task) => {
    setSelectedTask(task);
    if (logsInterval) {
      clearInterval(logsInterval);
      setLogsInterval(null);
    }
    try {
      const logs = await fetchLogs(task.id);
      setTaskLogs(logs);
      if (task.status === 'RUNNING' || task.status === 'QUEUED') {
        const interval = setInterval(async () => {
          try {
            const updatedLogs = await fetchLogs(task.id);
            setTaskLogs(updatedLogs);
          } catch (e) {
            console.error('Logs auto-refresh failed:', e);
          }
        }, 2000);
        setLogsInterval(interval);
      }
    } catch (e) {
      setTaskLogs([]);
      setError(getErrorMessage(e));
    }
  };


  const handleCreateWorkflow = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const description = (form.elements.namedItem('description') as HTMLInputElement).value;
    const taskNames = (form.elements.namedItem('tasks') as HTMLTextAreaElement).value
      .split('\n').filter(n => n.trim());

    const dag = { tasks: taskNames.map((name) => ({ name: name.trim() })) };
    try {
      await createWorkflow({ name, description, dag });
      setShowCreateWorkflow(false);
      loadData();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  function extractPlaceholders(dag: unknown): string[] {
    const text = JSON.stringify(dag);
    const matches = Array.from(text.matchAll(/\{\{(\w+)\}\}/g)).map(m => m[1]);
    return Array.from(new Set(matches));
  }

  const openRunModal = async (templateId: string, version: number, name: string) => {
    setRunError(null);
    setRunTemplateId(templateId);
    setRunTemplateName(name);
    setRunVersion(version);
    try {
      const { dag } = await fetchWorkflowVersion(templateId, version);
      const ph = extractPlaceholders(dag);
      setRunPlaceholders(ph);
      const defaults: Record<string, string> = {};
      ph.forEach((k) => {
        defaults[k] = k.toLowerCase().includes('dataset') ? 'customers_v3' : '';
      });
      setRunParams(defaults);
      setShowRunModal(true);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const submitRunWorkflow = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!runTemplateId || !runVersion) return;
    setRunError(null);
    try {
      await runWorkflow(runTemplateId, { version: runVersion, title: `${runTemplateName} v${runVersion} run`, params: runParams });
      setShowRunModal(false);
      loadData();
    } catch (err) {
      setRunError(getErrorMessage(err));
    }
  };

  const handleJobAction = async (action: string, jobId: string) => {
    try {
      if (action === 'cancel') await cancelJob(jobId);
      else if (action === 'pause') await pauseJob(jobId);
      else if (action === 'resume') await resumeJob(jobId);
      else if (action === 'delete') await deleteJob(jobId);
      loadData();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleStopAndRemoveOldJobs = async () => {
    if (!confirm('This will remove jobs older than 24 hours from the UI view only. Continue?')) return;

    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const oldJobs = jobs.filter(job =>
        new Date(job.created_at) < twentyFourHoursAgo &&
        !['RUNNING', 'PAUSED', 'SCHEDULED'].includes(job.status)
      );

      // Remove old jobs from state
      setJobs(prevJobs => prevJobs.filter(job =>
        new Date(job.created_at) >= twentyFourHoursAgo ||
        ['RUNNING', 'PAUSED', 'SCHEDULED'].includes(job.status)
      ));

      setError(`UI cleanup completed: ${oldJobs.length} old jobs removed from view`);
      setTimeout(() => setError(null), 3000);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleTaskAction = async (action: string, taskId: string) => {
    try {
      if (action === 'retry') await retryTask(taskId);
      else if (action === 'skip') await skipTask(taskId);
      else if (action === 'fail') await failTask(taskId);
      if (selectedJob) viewJobDetails(selectedJob);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleReviewTask = async (taskId: string, decision: 'APPROVE' | 'REJECT') => {
    try {
      await reviewTask(taskId, { score: decision === 'APPROVE' ? 90 : 30, decision });
      if (selectedJob) viewJobDetails(selectedJob);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const loadDLQ = async () => {
    try {
      const msgs = await fetchDLQ();
      setDlqMessages(msgs);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <Card className="w-[400px]">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">AI Workflow Platform</CardTitle>
            <CardDescription>Enterprise-grade orchestration</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              type="password"
              placeholder="Enter JWT token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mb-4"
            />
            <Button onClick={handleLogin} className="w-full">Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        {/* Header */}
        <header className="border-b bg-card px-6 py-3 flex items-center justify-between sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              AI Workflow
            </h1>
            <Badge variant="secondary" className="text-xs">v2.0</Badge>
          </div>

          <nav className="flex items-center gap-2">
            <Button variant={activeTab === 'brain' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('brain')}>
              <Sparkles className="mr-2 h-4 w-4 text-indigo-400" /> AI Creator
            </Button>
            <Button variant={activeTab === 'jobs' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('jobs')}>
              <LayoutDashboard className="mr-2 h-4 w-4" /> Jobs
            </Button>
            <Button variant={activeTab === 'workflows' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('workflows')}>
              <FileText className="mr-2 h-4 w-4" /> Workflows
            </Button>
            <Button variant={activeTab === 'help' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('help')}>
              <FileText className="mr-2 h-4 w-4" /> How to use
            </Button>
            <Button variant={activeTab === 'dlq' ? "secondary" : "ghost"} size="sm" onClick={() => { setActiveTab('dlq'); loadDLQ(); }}>
              <AlertCircle className="mr-2 h-4 w-4" /> DLQ
            </Button>
          </nav>

          <div className="flex items-center gap-3">
            <ModeToggle />
            <div className="flex items-center bg-muted rounded-lg p-1">
              <Button
                variant={jobsScope === 'mine' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => changeJobsScope('mine')}
              >
                My Jobs
              </Button>
              <Button
                variant={jobsScope === 'org' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => changeJobsScope('org')}
              >
                Org Jobs
              </Button>
            </div>

            <Button variant="outline" size="icon" onClick={loadData} disabled={loading}>
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="destructive" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {error && (
          <div className="bg-destructive/15 text-destructive px-6 py-3 flex justify-between items-center text-sm font-medium">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-auto p-1 text-destructive hover:bg-destructive/20">
              Dismiss
            </Button>
          </div>
        )}

        <main className="flex-1 p-6 overflow-auto">
          {activeTab === 'jobs' && (
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold tracking-tight">Active Jobs</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleStopAndRemoveOldJobs}>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Cleanup Old Jobs
                    </Button>
                    <Button onClick={() => setShowCreateJob(true)}>+ New Job</Button>
                  </div>
                </div>
                <JobTable
                  jobs={jobs}
                  selectedJobId={selectedJob?.id}
                  onSelectJob={viewJobDetails}
                  onAction={handleJobAction}
                />
              </div>

              <div className="lg:col-span-1">
                {selectedJob ? (
                  <Card className="h-full border-l-4 border-l-primary/50 shadow-lg bg-card/80 backdrop-blur">
                    <CardHeader>
                      <CardTitle className="flex justify-between items-center text-lg">
                        {selectedJob.title}
                        {(refreshInterval || selectedJob.status === 'RUNNING') && (
                          <span className="text-xs text-emerald-500 animate-pulse flex items-center gap-1">
                            <RefreshCcw className="h-3 w-3" /> Live
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>{selectedJob.id}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => openSaveTemplateModal(selectedJob.id)}>
                          <Save className="mr-2 h-4 w-4" /> Save as Template
                        </Button>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wider">Tasks</h4>
                        <div className="space-y-2">
                          {jobTasks.map(task => (
                            <div key={task.id} className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-muted/50 transition-colors">
                              <div className="flex items-center gap-3">
                                <StatusBadge status={task.status} />
                                <span className="text-sm font-medium">{task.name}</span>
                              </div>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => viewTaskLogs(task)} title="View Logs">
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                </Button>
                                {task.status === 'FAILED' && (
                                  <Button variant="ghost" size="icon" onClick={() => handleTaskAction('retry', task.id)} title="Retry">
                                    <RefreshCcw className="h-4 w-4 text-orange-500" />
                                  </Button>
                                )}
                                {task.status === 'PENDING' && (
                                  <Button variant="ghost" size="icon" onClick={() => handleTaskAction('skip', task.id)} title="Skip">
                                    <Play className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                )}
                                {task.agent_type === 'reviewer' && task.status === 'RUNNING' && (
                                  <div className="flex gap-1">
                                    <Button size="icon" variant="outline" className="h-7 w-7 text-green-500" onClick={() => handleReviewTask(task.id, 'APPROVE')}>
                                      <CheckCircle className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" variant="outline" className="h-7 w-7 text-red-500" onClick={() => handleReviewTask(task.id, 'REJECT')}>
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {artifacts.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wider">Artifacts</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {artifacts.map(art => (
                              <div
                                key={art.id}
                                className="p-3 border rounded-lg bg-card/50 hover:border-primary/50 cursor-pointer transition-all"
                                onClick={() => viewArtifact(art)}
                              >
                                <div className="flex justify-between items-start mb-1">
                                  <Badge variant="secondary" className="text-[10px]">{art.type}</Badge>
                                  {art.role && <Badge variant="outline" className="text-[10px]">{art.role}</Badge>}
                                </div>
                                <p className="text-xs truncate font-medium text-foreground/80">{art.filename}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="h-full flex items-center justify-center border-2 border-dashed rounded-lg p-12 text-muted-foreground bg-muted/20">
                    <div className="text-center space-y-2">
                      <LayoutDashboard className="h-10 w-10 mx-auto text-muted-foreground/50" />
                      <p>Select a job to view details</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'workflows' && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold tracking-tight">Workflow Templates</h2>
                <Button onClick={() => setShowCreateWorkflow(true)}>+ New Template</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {workflows.map(wf => (
                  <Card key={wf.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => openTemplateDetail(wf)}>
                    <CardHeader>
                      <CardTitle className="text-lg">{wf.name}</CardTitle>
                      <CardDescription>{wf.description || "No description"}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between text-sm text-muted-foreground mb-4">
                        <span>Versions: {wf.version_count}</span>
                        <span>{new Date(wf.created_at).toLocaleDateString()}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="flex gap-2 flex-wrap">
                      {[...Array(wf.version_count)].map((_, i) => (
                        <Button
                          key={i}
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRunModal(wf.id, i + 1, wf.name);
                          }}
                        >
                          Run v{i + 1}
                        </Button>
                      ))}
                    </CardFooter>
                  </Card>
                ))}
              </div>
              {templateDetailError && (
                <div className="text-sm text-destructive">{templateDetailError}</div>
              )}
            </div>
          )}

          {activeTab === 'dlq' && (
            <div className="max-w-4xl mx-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold tracking-tight">Dead Letter Queue</h2>
                <Button variant="outline" size="sm" onClick={loadDLQ}>Refresh</Button>
              </div>
              {dlqMessages.length === 0 ? (
                <div className="text-center p-12 border rounded-lg bg-card text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-emerald-500" />
                  <p>No messages in DLQ. System is healthy.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dlqMessages.map((msg, i) => (
                    <Card key={i} className="border-destructive/50 bg-destructive/5">
                      <CardHeader>
                        <CardTitle className="text-sm font-mono text-destructive">Failed Message</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <pre className="text-xs overflow-auto p-2 bg-black/50 rounded text-foreground">{JSON.stringify(msg, null, 2)}</pre>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

          )}

          {activeTab === 'brain' && (
            <BrainPanel />
          )}

          {activeTab === 'help' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">How to use this system</h2>
                <p className="text-sm text-muted-foreground">
                  This app lets you build and run multi-step AI workflows locally. The simplest way is AI Creator. For full control, use Manual Jobs.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">1) AI Creator (recommended)</CardTitle>
                  <CardDescription>Describe what you want in plain English, then run the generated workflow.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Step A:</span> Open the <span className="font-mono">AI Creator</span> tab and enter a prompt.
                  </div>
                  <div>
                    <span className="font-medium">Step B:</span> Click <span className="font-mono">Generate Plan</span> to preview the workflow.
                  </div>
                  <div>
                    <span className="font-medium">Step C:</span> Click <span className="font-mono">Execute Workflow</span>.
                  </div>
                  <div>
                    <span className="font-medium">Tip:</span> After a successful run, click <span className="font-mono">Save as Template</span> to reuse it later.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">2) Manual Jobs (visual builder or list)</CardTitle>
                  <CardDescription>Build the workflow yourself for maximum control.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Step A:</span> Go to <span className="font-mono">Jobs</span> and click <span className="font-mono">+ New Job</span>.
                  </div>
                  <div>
                    <span className="font-medium">Step B:</span> Use <span className="font-mono">Visual Builder</span> to drag agents, connect them, and fill inputs.
                  </div>
                  <div>
                    <span className="font-medium">Auto-wiring:</span> When you connect nodes, inputs are auto-filled with templates like <span className="font-mono">{'{{tasks.upstream.outputs.field}}'}</span>.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">3) Templates (Workflows tab)</CardTitle>
                  <CardDescription>Save a job as a template and run it again with one click.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Save:</span> From a job detail panel (or AI Creator run), click <span className="font-mono">Save as Template</span>.
                  </div>
                  <div>
                    <span className="font-medium">View:</span> Go to <span className="font-mono">Workflows</span> and click a template.
                  </div>
                  <div>
                    <span className="font-medium">Run:</span> Click <span className="font-mono">Run</span> in the template details modal.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">4) Reports & Artifacts (PDFs, charts, JSON)</CardTitle>
                  <CardDescription>Artifacts are files produced by tasks (PDF reports, charts, JSON outputs).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Designer:</span> Produces a PDF report. In workflows, prefer connecting charts into designer so the PDF embeds them.
                  </div>
                  <div>
                    <span className="font-medium">Artifacts:</span> Open a job, then click an artifact to preview or download it.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">5) Notifier (sending results)</CardTitle>
                  <CardDescription>Use notifier as the last step to email the result link (and attach the PDF when available).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Typical pattern:</span> <span className="font-mono">{'designer -> notifier'}</span>
                  </div>
                  <div>
                    <span className="font-medium">Message content:</span> If you connect designer into notifier, it will auto-fill a message containing the PDF link.
                  </div>
                  <div>
                    <span className="font-medium">Recipients:</span> Set <span className="font-mono">channel=email</span> and add one or more emails in <span className="font-mono">recipients</span>.
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedArtifact && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6" onClick={() => setSelectedArtifact(null)}>
              <div className="bg-card border shadow-2xl rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-semibold">{selectedArtifact.filename}</h3>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => downloadArtifact(selectedArtifact)}>Download</Button>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedArtifact(null)}><XCircle className="h-5 w-5" /></Button>
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
                      <div className="text-center p-8 text-muted-foreground"><p>Loading PDF...</p></div>
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

          {/* Create Job Dialog (Replaces Modal) */}
          <CreateJobDialog
            open={showCreateJob}
            onOpenChange={setShowCreateJob}
            onSuccess={loadData}
          />

          {/* Workflow Creation, Run Modal etc remain the same for now, or could use builder too later */}
          {(showCreateWorkflow) && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <Card className="w-full max-w-md">
                <CardHeader>
                  <CardTitle>Create Workflow</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateWorkflow} id="createWorkflowForm" className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Name</label>
                      <Input name="name" required />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Description</label>
                      <Input name="description" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tasks (one per line)</label>
                      <textarea
                        name="tasks"
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        required
                      />
                    </div>
                  </form>
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowCreateWorkflow(false)}>Cancel</Button>
                  <Button type="submit" form="createWorkflowForm">Create</Button>
                </CardFooter>
              </Card>
            </div>
          )}

          {showSaveTemplateModal && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSaveTemplateModal(false)}>
              <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <CardHeader>
                  <CardTitle>Save Job as Template</CardTitle>
                  <CardDescription>Save this job configuration so you can re-run it later.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={submitSaveTemplate} id="saveTemplateForm" className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Template name</label>
                      <Input name="template_name" required defaultValue={selectedJob ? selectedJob.title : ''} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Description</label>
                      <Input name="template_description" />
                    </div>
                    {saveTemplateError && (
                      <div className="text-sm text-destructive">{saveTemplateError}</div>
                    )}
                  </form>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowSaveTemplateModal(false)}>Cancel</Button>
                  <Button type="submit" form="saveTemplateForm">Save</Button>
                </CardFooter>
              </Card>
            </div>
          )}

          {showTemplateDetailModal && templateDetail && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowTemplateDetailModal(false)}>
              <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    <span>{templateDetail.name}</span>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={runFromTemplateDetail}>Run</Button>
                      <Button variant="ghost" onClick={() => setShowTemplateDetailModal(false)}>Close</Button>
                    </div>
                  </CardTitle>
                  <CardDescription>{templateDetail.description || 'No description'}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto space-y-4">
                  {typeof templateDetail.dag?.meta?.prompt === 'string' && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Prompt</div>
                      <pre className="text-xs p-3 bg-black/50 rounded overflow-auto">{String(templateDetail.dag.meta.prompt)}</pre>
                    </div>
                  )}

                  {templateDetail.dag?.meta?.visualDag && typeof templateDetail.dag.meta.visualDag === 'object' ? (
                    <div className="h-[520px] border rounded-lg overflow-hidden">
                      <WorkflowBuilder workflow={templateDetail.dag.meta.visualDag as unknown as WorkflowDAG} mode="view" readOnly />
                    </div>
                  ) : (
                    <pre className="text-xs p-3 bg-black/50 rounded overflow-auto">{JSON.stringify(templateDetail.dag, null, 2)}</pre>
                  )}

                  {templateDetailError && (
                    <div className="text-sm text-destructive">{templateDetailError}</div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {showRunModal && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <Card className="w-full max-w-md">
                <CardHeader>
                  <CardTitle>Run {runTemplateName} v{runVersion}</CardTitle>
                  {runError && <div className="text-xs text-destructive mt-2">{runError}</div>}
                </CardHeader>
                <CardContent>
                  <form onSubmit={submitRunWorkflow} id="runForm" className="space-y-4">
                    {runPlaceholders.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No parameters required for this version.</p>
                    ) : (
                      runPlaceholders.map((key) => (
                        <div key={key} className="space-y-2">
                          <label className="text-sm font-medium">{key}</label>
                          <Input
                            value={runParams[key] ?? ''}
                            onChange={(e) => setRunParams({ ...runParams, [key]: e.target.value })}
                            placeholder={key === 'dataset' ? 'customers_v3' : ''}
                          />
                        </div>
                      ))
                    )}
                  </form>
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowRunModal(false)}>Cancel</Button>
                  <Button type="submit" form="runForm">Run Workflow</Button>
                </CardFooter>
              </Card>
            </div>
          )}

          {selectedTask && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setSelectedTask(null)}>
              <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <CardHeader className="flex flex-row items-center justify-between border-b py-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Logs: {selectedTask.name}</CardTitle>
                    {(logsInterval || selectedTask.status === 'RUNNING') && <Activity className="h-4 w-4 text-emerald-500 animate-pulse" />}
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedTask(null)}><XCircle className="h-5 w-5" /></Button>
                </CardHeader>
                <div className="flex-1 overflow-auto p-0 bg-black/95 font-mono text-xs">
                  {taskLogs.length > 0 ? (
                    <table className="w-full">
                      <tbody>
                        {taskLogs.map((log, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="p-2 text-gray-500 whitespace-nowrap align-top border-r border-gray-800 select-none w-[1%]">
                              {new Date(log.created_at).toLocaleTimeString()}
                            </td>
                            <td className={`p-2 align-top w-[1%] font-bold border-r border-gray-800 ${log.level === 'ERROR' ? 'text-red-500' : 'text-blue-400'}`}>
                              {log.level}
                            </td>
                            <td className="p-2 text-gray-300 break-words whitespace-pre-wrap">
                              {log.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-gray-500">No logs available</div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </main>
      </div >
    </ThemeProvider >
  );
}

export default App;
