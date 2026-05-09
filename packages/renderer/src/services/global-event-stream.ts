/**
 * Global event stream — stub.
 * Previously used SSE for server-push events; now replaced by WebSocket.
 * This file exists only to satisfy imports from Workbench.tsx.
 */

export const globalEventStream = {
  connect: () => {
    // No-op: replaced by wsClient.connect() in main.tsx
  },
  disconnect: () => {
    // No-op
  },
};
