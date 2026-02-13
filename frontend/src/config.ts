// Central place for API and socket base URLs
// Uses Vite env vars in production, falls back to localhost for local dev.

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000";

export { API_BASE_URL, SOCKET_URL };

