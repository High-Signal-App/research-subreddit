// Drop-in App Health log client (JavaScript port of ping.ts). One POST per
// call, never throws, silent no-op until APP_HEALTH_INGEST_KEY is set.
// Source: app-health/examples/dropin-log-client/ping.ts.

const DEFAULT_URL = 'https://ingest.sassmaker.com/v1/logs';

function cleanProps(props = {}) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function buildBody(event, options, environment) {
  return JSON.stringify({
    batch_id: crypto.randomUUID(),
    schema_version: 'v1',
    environment,
    logs: [
      {
        log_id: crypto.randomUUID(),
        timestamp: Date.now(),
        event,
        level: options.level ?? 'info',
        title: options.title,
        description: options.description,
        icon: options.icon,
        props: cleanProps(options.props),
      },
    ],
  });
}

export function createPing(config = {}) {
  const send = async (event, options = {}) => {
    const key = config.key;
    if (!key) return false;
    const url = config.url ?? DEFAULT_URL;
    const environment = config.environment ?? 'production';
    const fetchImpl = config.fetch ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 3000);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: buildBody(event, options, environment),
        signal: controller.signal,
      });
      if (res.ok) return true;
      config.onError?.(new Error(`ping ${event}: HTTP ${res.status}`));
      return false;
    } catch (err) {
      config.onError?.(err);
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  const withLevel = (level) => (event, options = {}) => send(event, { ...options, level });
  return Object.assign(send, {
    debug: withLevel('debug'),
    info: withLevel('info'),
    warn: withLevel('warn'),
    error: withLevel('error'),
  });
}

/** Ping bound to the Worker env binding. No-op until APP_HEALTH_INGEST_KEY exists. */
export function pingFor(env) {
  return createPing({
    key: typeof env.APP_HEALTH_INGEST_KEY === 'string' && env.APP_HEALTH_INGEST_KEY ? env.APP_HEALTH_INGEST_KEY : undefined,
    environment: typeof env.APP_HEALTH_ENVIRONMENT === 'string' && env.APP_HEALTH_ENVIRONMENT ? env.APP_HEALTH_ENVIRONMENT : 'production',
    onError: (err) => console.warn(JSON.stringify({ event: 'app_health_log_failed', error: err instanceof Error ? err.message : String(err) })),
  });
}
