import { api } from "./client";

export interface TaskLog {
  level: string;
  message: string;
  created_at: string;
}

export async function fetchLogs(taskId: string): Promise<TaskLog[]> {
  const res = await api.get(`/tasks/${taskId}/logs`);
  return res.data;
}
