import { Router } from "express";
import amqp from "amqplib";
import { authMiddleware } from "./auth";

const router = Router();

const RABBIT_URL =
  process.env.RABBIT_URL || "amqp://guest:guest@localhost:5672/";
const DLQ_QUEUE = "executor.tasks.dlq";

router.get("/dlq", authMiddleware, async (_req, res) => {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();

  const messages: any[] = [];

  for (let i = 0; i < 10; i++) {
    const msg = await ch.get(DLQ_QUEUE, { noAck: true });
    if (!msg) break;
    messages.push(JSON.parse(msg.content.toString()));
  }

  await ch.close();
  await conn.close();

  res.json(messages);
});

export default router;
