import { api } from "./client";

export interface Task {
  id: string;
  name: string;
  status: string;
  retry_count: number;
  started_at: string | null;
  finished_at: string | null;
  agent_type: string;
  payload: Record<string, unknown> | null;
  review_score?: number | null;
  review_decision?: string | null;
}

export async function fetchTasks(jobId: string): Promise<Task[]> {
  const res = await api.get(`/jobs/${jobId}/tasks`);
  return res.data;
}

export async function retryTask(taskId: string): Promise<void> {
  await api.post(`/tasks/${taskId}/retry`);
}

export async function skipTask(taskId: string): Promise<void> {
  await api.post(`/tasks/${taskId}/skip`);
}

export async function failTask(taskId: string): Promise<void> {
  await api.post(`/tasks/${taskId}/fail`);
}

export async function reviewTask(taskId: string, review: {
  score: number;
  decision: "APPROVE" | "REJECT";
  feedback?: string;
}): Promise<void> {
  await api.post(`/tasks/${taskId}/review`, review);
}
