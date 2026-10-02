import { createAppHealthClient } from "@saas-maker/app-health";

const INGEST_ENDPOINT = "https://ingest.sassmaker.com/v1/ingest";

/** Create optional endpoint reporting without exposing Reddit request URLs. */
export function createEndpointHealthRecorder(createClient = createAppHealthClient) {
  let cachedKey;
  let cachedEnvironment;
  let cachedClient;

  return (request, status, durationMs, env, ctx) => {
    if (request.method === "OPTIONS" || !env || typeof env !== "object") return;

    const key =
      typeof env.APP_HEALTH_INGEST_KEY === "string" ? env.APP_HEALTH_INGEST_KEY.trim() : "";
    if (!key) {
      cachedKey = undefined;
      cachedEnvironment = undefined;
      cachedClient = undefined;
      return;
    }

    const environment =
      typeof env.APP_HEALTH_ENVIRONMENT === "string"
        ? env.APP_HEALTH_ENVIRONMENT.trim() || "production"
        : "production";

    if (!cachedClient || cachedKey !== key || cachedEnvironment !== environment) {
      try {
        cachedClient = createClient({
          key,
          environment,
          endpoint: INGEST_ENDPOINT,
          runtime: "worker",
          maxQueueSize: 100,
          maxBatchSize: 20,
          requestTimeoutMs: 1_000,
          maxRetries: 1,
          disableTimer: true,
        });
        cachedKey = key;
        cachedEnvironment = environment;
      } catch {
        cachedClient = undefined;
        cachedKey = undefined;
        cachedEnvironment = undefined;
        return;
      }
    }

    try {
      const pathname = new URL(request.url).pathname;
      cachedClient.record({
        method: request.method,
        route: pathname === "/" ? "/health" : "/proxy",
        status_code: status,
        duration_ms: Math.max(0, Math.round(durationMs)),
      });
      const delivery = cachedClient.flush().catch(() => undefined);
      try {
        ctx?.waitUntil(delivery);
      } catch {
        void delivery;
      }
    } catch {
      // Optional endpoint monitoring must never change a proxy response.
    }
  };
}

export const recordEndpointHealth = createEndpointHealthRecorder();

/** Wrap the Worker handler while preserving the original response or error. */
export function withEndpointHealth(handler, observe = recordEndpointHealth) {
  return async (request, env, ctx) => {
    const startedAt = performance.now();
    let response;
    try {
      response = await handler(request, env, ctx);
    } catch (error) {
      try {
        observe(request, 500, performance.now() - startedAt, env, ctx);
      } catch {
        // Monitoring is best-effort even if an injected observer fails.
      }
      throw error;
    }

    try {
      observe(request, response.status, performance.now() - startedAt, env, ctx);
    } catch {
      // Monitoring is best-effort even if an injected observer fails.
    }
    return response;
  };
}
