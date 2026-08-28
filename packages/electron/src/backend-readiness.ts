import { request } from "node:http";

export interface BackendEndpoint {
  host: string;
  port: number;
}

export interface BackendReadinessOptions extends BackendEndpoint {
  timeoutMs?: number;
}

export async function probeBackendHealth({
  host,
  port,
  timeoutMs = 500,
}: BackendReadinessOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };

    const req = request(
      {
        host,
        port,
        path: "/api/health",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        finish((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
      },
    );
    req.on("error", () => finish(false));
    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

export async function waitForBackendReady(
  endpoint: BackendEndpoint,
  isProcessAlive: () => boolean,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive()) {
      throw new Error("Gateway 在 ready 探测完成前退出");
    }
    if (await probeBackendHealth(endpoint)) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Gateway ready 探测超时（${timeoutMs}ms，${endpoint.host}:${endpoint.port}）`);
}
