import assert from "node:assert/strict";
import { test } from "node:test";
import { createEndpointHealthRecorder, withEndpointHealth } from "./endpoint-health.js";
import proxyWorker from "./worker.js";

function createClientFactory() {
  const events = [];
  const client = {
    record(event) {
      events.push(event);
    },
    async flush() {},
  };
  const options = [];
  const createClient = config => {
    options.push(config);
    return client;
  };
  return { client, createClient, events, options };
}

test("no optional key means no client and no send", () => {
  const { createClient, events, options } = createClientFactory();
  const observe = createEndpointHealthRecorder(createClient);

  observe(new Request("https://proxy.example/r/private/posts?q=secret"), 200, 3, {}, {});

  assert.equal(options.length, 0);
  assert.deepEqual(events, []);
});

test("reports only a fixed proxy route and approved request metadata", async () => {
  const { createClient, events, options } = createClientFactory();
  const observe = createEndpointHealthRecorder(createClient);
  let delivery;
  const context = { waitUntil(promise) { delivery = promise; } };
  const env = {
    APP_HEALTH_INGEST_KEY: "synthetic-test-key",
    APP_HEALTH_ENVIRONMENT: "staging",
  };

  observe(
    new Request("https://proxy.example/r/private-community/comments/secret-post?search=private+phrase"),
    503,
    11.6,
    env,
    context,
  );
  await delivery;

  assert.deepEqual(events, [{
    method: "GET",
    route: "/proxy",
    status_code: 503,
    duration_ms: 12,
  }]);
  assert.equal(JSON.stringify(events).includes("private-community"), false);
  assert.equal(JSON.stringify(events).includes("secret-post"), false);
  assert.equal(JSON.stringify(events).includes("private phrase"), false);
  assert.equal(JSON.stringify(events).includes("synthetic-test-key"), false);
  assert.deepEqual(options, [{
    key: "synthetic-test-key",
    environment: "staging",
    endpoint: "https://ingest.sassmaker.com/v1/ingest",
    runtime: "worker",
    maxQueueSize: 100,
    maxBatchSize: 20,
    requestTimeoutMs: 1_000,
    maxRetries: 1,
    disableTimer: true,
  }]);
});

test("labels the root health path and excludes OPTIONS preflight", async () => {
  const { createClient, events, options } = createClientFactory();
  const observe = createEndpointHealthRecorder(createClient);
  const waits = [];
  const context = { waitUntil(promise) { waits.push(promise); } };
  const env = { APP_HEALTH_INGEST_KEY: "synthetic-test-key" };

  observe(new Request("https://proxy.example/"), 200, 1, env, context);
  observe(new Request("https://proxy.example/r/private", { method: "OPTIONS" }), 204, 0, env, context);
  await Promise.all(waits);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    method: "GET",
    route: "/health",
    status_code: 200,
    duration_ms: 1,
  });
  assert.equal(options.length, 1);
});

test("optional observation preserves the response and the original thrown error", async () => {
  const response = new Response("unchanged", { status: 201, headers: { "x-test": "kept" } });
  const observe = withEndpointHealth(async () => response, () => {
    throw new Error("synthetic observer failure");
  });
  const returned = await observe(new Request("https://proxy.example/anything"), {}, {});
  assert.equal(returned, response);
  assert.equal(await returned.text(), "unchanged");

  const expected = new Error("handler failure");
  const failing = withEndpointHealth(async () => {
    throw expected;
  }, () => {
    throw new Error("synthetic observer failure");
  });
  await assert.rejects(failing(new Request("https://proxy.example/anything"), {}, {}), error => error === expected);
});

test("collector failure cannot delay or replace the proxy response", async () => {
  const { client, createClient } = createClientFactory();
  client.flush = async () => {
    throw new Error("synthetic collector failure");
  };
  const observe = createEndpointHealthRecorder(createClient);
  const response = new Response("proxied body", { status: 202 });
  let delivery;
  const fetch = withEndpointHealth(async () => response, observe);

  const returned = await fetch(
    new Request("https://proxy.example/r/private?query=private"),
    { APP_HEALTH_INGEST_KEY: "synthetic-test-key" },
    { waitUntil(promise) { delivery = promise; } },
  );
  await delivery;

  assert.equal(returned, response);
  assert.equal(returned.status, 202);
  assert.equal(await returned.text(), "proxied body");
});

test("proxy health and OPTIONS responses are unchanged when monitoring is disabled", async () => {
  const health = await proxyWorker.fetch(new Request("https://proxy.example/"), {});
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "reddit-proxy ok (oauth)");

  const preflight = await proxyWorker.fetch(
    new Request("https://proxy.example/r/private-community/search?q=private", { method: "OPTIONS" }),
    {},
  );
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assert.equal(await preflight.text(), "");
});
