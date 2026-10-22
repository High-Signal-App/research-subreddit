import assert from "node:assert/strict";
import test from "node:test";
import { createWranglerRunner } from "./wrangler-client.mjs";

test("concurrent storage calls share one pinned CLI resolution and version check", async () => {
  const calls = [], binary = "/tmp/pinned-wrangler/bin/wrangler", cwd = "/tmp/publication";
  const run = createWranglerRunner(async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "npx") return { stdout: `${binary}\n` };
    if (args[0] === "--version") return { stdout: "4.120.0\n" };
    return { stdout: args.join(" ") };
  }, cwd);
  const get = ["r2", "object", "get", "bucket/key", "--remote"];
  const put = ["r2", "object", "put", "bucket/key", "--file", "/tmp/body", "--remote"];
  const results = await Promise.all([run(get), run(put)]);
  assert.equal(calls.filter(call => call.command === "npx").length, 1);
  assert.deepEqual(calls[0].args, ["--yes", "--package=wrangler@4.120.0", "--call", "command -v wrangler"]);
  assert.equal(calls.filter(call => call.args[0] === "--version").length, 1);
  assert.deepEqual(calls.slice(2).map(call => call.args), [get, put]);
  assert.ok(calls.slice(1).every(call => call.command === binary));
  assert.ok(calls.every(call => call.options.cwd === cwd));
  assert.deepEqual(results.map(result => result.stdout), [get.join(" "), put.join(" ")]);
});

test("invalid paths, wrong versions and resolution errors cannot start storage operations", async () => {
  for (const mode of ["relative", "multiline", "version", "unavailable"]) {
    let operations = 0, resolutions = 0;
    const run = createWranglerRunner(async (command, args) => {
      if (command === "npx") {
        resolutions++;
        if (mode === "unavailable") throw new Error("CLI unavailable");
        return { stdout: mode === "relative" ? "wrangler" : mode === "multiline" ? "/tmp/wrangler\nextra" : "/tmp/wrangler" };
      }
      if (args[0] === "--version") return { stdout: "4.119.0\n" };
      operations++;
    }, "/tmp/publication");
    await assert.rejects(run(["r2", "object", "get"]));
    await assert.rejects(run(["r2", "object", "put"]));
    assert.equal(resolutions, 1);
    assert.equal(operations, 0);
  }
});
