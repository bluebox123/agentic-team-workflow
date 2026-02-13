import amqp from "amqplib";
import { transitionTask } from "./stateMachine";
import pool from "./db";

const RABBIT_URL =
  process.env.RABBIT_URL || "amqp://guest:guest@localhost:5672/";

const TASK_QUEUE = "executor.tasks";
const DLQ_QUEUE = "executor.tasks.dlq";

let channel: amqp.Channel | null = null;

async function getChannel() {
  if (channel) return channel;

  const conn = await amqp.connect(RABBIT_URL);
  channel = await conn.createChannel();

  // DLQ
  await channel.assertQueue(DLQ_QUEUE, {
    durable: true,
  });

  // Main queue (explicit, simple)
  await channel.assertQueue(TASK_QUEUE, {
    durable: true,
  });

  return channel;
}

/**
 * Enqueue a task for execution
 */
export async function enqueueTask(taskId: string, payload: any) {
  const { rowCount } = await pool.query(
    `
    UPDATE tasks
    SET status = 'QUEUED'
    WHERE id = $1 AND status = 'PENDING'
    `,
    [taskId]
  );

  if (rowCount === 0) return;

  const ch = await getChannel();
  ch.sendToQueue(
    TASK_QUEUE,
    Buffer.from(JSON.stringify({ task_id: taskId, ...payload })),
    { persistent: true }
  );

  console.log("[MQ] enqueued task", taskId);
}

/**
 * Send task to DLQ
 */
export async function sendToDLQ(taskId: string, payload: any) {
  const ch = await getChannel();
  ch.sendToQueue(
    DLQ_QUEUE,
    Buffer.from(JSON.stringify({ task_id: taskId, ...payload })),
    { persistent: true }
  );

  console.warn("[MQ] task sent to DLQ", taskId);
}
