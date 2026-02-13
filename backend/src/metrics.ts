import client from "prom-client";

// Enable default Node.js metrics (CPU, memory, event loop)
client.collectDefaultMetrics();

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
});

export const jobsCreatedTotal = new client.Counter({
  name: "jobs_created_total",
  help: "Total jobs created",
});

export const tasksStateTotal = new client.Counter({
  name: "tasks_state_total",
  help: "Task state transitions",
  labelNames: ["state"],
});

export const workerExecutionsTotal = new client.Counter({
  name: "worker_executions_total",
  help: "Total task executions by workers",
  labelNames: ["result"],
});

export function metricsMiddleware(req: any, res: any, next: any) {
  res.on("finish", () => {
    httpRequestsTotal.inc({
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });
  });
  next();
}

export async function metricsHandler(_req: any, res: any) {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
}
