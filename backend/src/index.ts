import express from "express";
// Restarting (Revert to gemini-1.5-flash)
import dotenv from "dotenv";
import http from "http";
import cors from "cors";

import tasksControlRouter from "./tasksControl";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import logsRouter from "./logs";
import internalTasksRouter from "./internalTasks";
import dlqRouter from "./dlq";
import workflowsRouter from "./workflows";
import orgRoutes from "./orgRoutes";
import artifactRoutes from "./artifacts/artifactRoutes";
import artifactDownload from "./artifacts/artifactDownload";
import brainRouter from "./routes/brain";

import { initSocket } from "./socket";
import { startScheduler } from "./scheduler";
import { authMiddleware } from "./auth";
import { metricsMiddleware, metricsHandler } from "./metrics";
import { ensureBucket } from "./storage";

dotenv.config();

ensureBucket().catch(err => {
  console.error("MinIO init failed (Proceeding without storage):", err.message);
});

// Prevent crashes from unhandled rejections (e.g. MinIO background retries)
process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception:", err);
});

const app = express();

app.use(express.json());
app.use(cors());
app.use(metricsMiddleware);

app.use("/api/health", healthRouter);

// Public metrics endpoint for Prometheus
app.get("/metrics", metricsHandler);

// protected routes
app.use("/api/jobs", authMiddleware, jobsRouter);
app.use("/api/tasks", authMiddleware, tasksControlRouter);
app.use("/api/workflows", authMiddleware, workflowsRouter);
app.use("/api", authMiddleware, orgRoutes);
app.use("/api", authMiddleware, artifactRoutes);
app.use("/api", authMiddleware, artifactDownload);
app.use("/api", authMiddleware, logsRouter);
app.use("/api/brain", brainRouter);
app.use("/api", dlqRouter);

/**
 * INTERNAL ROUTES (WORKERS)
 * DO NOT PROTECT THESE
 * ❗ DO NOT PROTECT THESE
 */
app.use("/internal", internalTasksRouter);

const port = Number(process.env.PORT || 4000);
const server = http.createServer(app);

initSocket(server);
startScheduler(500);

server.listen(port, () => {
  console.log(`orchestrator listening on ${port}`);
});
