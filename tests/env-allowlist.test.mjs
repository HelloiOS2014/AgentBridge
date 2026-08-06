import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runAntigravity } from "../src/adapters/antigravity.mjs";
import { buildTargetEnv } from "../src/core/env-allowlist.mjs";

const fakeAgy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agy.mjs");

describe("env allowlist (design §11.5)", () => {
  it("filters the inherited layer but keeps req.env explicit passthrough", () => {
    process.env.AB_INHERITED_SECRET = "s3cret";
    try {
      const env = buildTargetEnv({ FAKE_AGY_TOUCH: "1", PATH: process.env.PATH });
      assert.equal(env.FAKE_AGY_TOUCH, "1", "req.env passes through unfiltered");
      assert.equal(env.AGENT_BRIDGE_NESTED, "1");
      assert.equal(env.AB_INHERITED_SECRET, undefined, "inherited layer filtered");
      assert.ok(env.PATH, "default allowlist keeps PATH");
    } finally {
      delete process.env.AB_INHERITED_SECRET;
    }
  });

  it("AGENT_BRIDGE_* inherited vars and AGENT_BRIDGE_ENV_ALLOWLIST extras pass through", () => {
    process.env.AGENT_BRIDGE_ALLOW_SELF = "1";
    process.env.MY_BRIDGE_EXTRA = "kept";
    process.env.AB_DROPPED = "dropped";
    process.env.AGENT_BRIDGE_ENV_ALLOWLIST = "MY_BRIDGE_EXTRA";
    try {
      const env = buildTargetEnv({});
      assert.equal(env.AGENT_BRIDGE_ALLOW_SELF, "1");
      assert.equal(env.MY_BRIDGE_EXTRA, "kept", "AGENT_BRIDGE_ENV_ALLOWLIST appends names");
      assert.equal(env.AB_DROPPED, undefined);
    } finally {
      delete process.env.AGENT_BRIDGE_ALLOW_SELF;
      delete process.env.MY_BRIDGE_EXTRA;
      delete process.env.AB_DROPPED;
      delete process.env.AGENT_BRIDGE_ENV_ALLOWLIST;
    }
  });

  it("target child process env inherits only allowlisted vars plus explicit req.env", async () => {
    process.env.AB_INHERITED_SECRET = "top-secret";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-env-"));
    try {
      const result = await runAntigravity({
        kind: "plan",
        prompt: "env dump",
        cwd: dir,
        env: { AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy, FAKE_AGY_DUMP_ENV: "1" }
      });
      assert.equal(result.ok, true);
      const childEnv = JSON.parse(result.rawOutput);
      assert.equal(childEnv.AB_INHERITED_SECRET, undefined, "inherited secret not passed to child");
      assert.equal(childEnv.AGENT_BRIDGE_NESTED, "1");
      assert.equal(childEnv.FAKE_AGY_DUMP_ENV, "1", "explicit req.env var preserved");
      assert.ok(childEnv.PATH);
      assert.ok(childEnv.HOME);
    } finally {
      delete process.env.AB_INHERITED_SECRET;
    }
  });
});
