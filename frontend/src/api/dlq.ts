import { api } from "./client";

export async function fetchDLQ(): Promise<Array<{
  task_id: string;
  job_id: string;
  error?: string;
  retries?: number;
}>> {
  const res = await api.get("/dlq");
  return res.data;
}
