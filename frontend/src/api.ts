const API_BASE = "http://localhost:4000/api";

async function request<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem("token");

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await res.json()) as T;
  }

  return (await res.text()) as T;
}

export const api = {
  listJobs: () => request("/jobs"),
  createJob: (payload: unknown) =>
    request("/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getJobTasks: (jobId: string) => request(`/jobs/${jobId}/tasks`),

  listTemplates: () => request("/workflows"),
  createTemplate: (payload: unknown) =>
    request("/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTemplate: (templateId: string) => request(`/workflows/${templateId}`),
  getTemplateVersion: (templateId: string, version: number) =>
    request(`/workflows/${templateId}/versions/${version}`),
  runTemplate: (templateId: string, payload: unknown) =>
    request(`/workflows/${templateId}/run`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getOrgs: () => request("/orgs"),

  // Phase 8.5.3: Artifact diff API
  getArtifactDiff: (artifactId: string) => 
    request(`/artifacts/${artifactId}/diff`),
  
  getArtifactVersions: (jobId: string, type: string, role?: string) =>
    request(`/artifacts/versions/${jobId}/${type}${role ? `/${role}` : ''}`),

  // Generic request method for custom endpoints
  get: <T = unknown>(path: string, options?: { params?: Record<string, string> }) => {
    const url = new URL(`${API_BASE}${path}`);
    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }
    return request<T>(url.pathname + url.search);
  },

  // Generic POST method
  post: <T = unknown>(path: string, data?: unknown) => {
    return request<T>(path, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
