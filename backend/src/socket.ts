// backend/src/socket.ts
import { Server } from "socket.io";
import http from "http";

let io: Server | null = null;

export function initSocket(server: http.Server) {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("[WS] client connected", socket.id);
  });
}

export function emitEvent(event: string, payload: any) {
  if (!io) return;
  io.emit(event, payload);
}
