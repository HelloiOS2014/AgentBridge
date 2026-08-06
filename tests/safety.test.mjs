import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXIT } from "../src/core/exit-codes.mjs";
import { allowedTargets } from "../src/core/ids.mjs";
import { assertNoForbiddenFlags, evaluateGates } from "../src/core/safety.mjs";

describe("allowedTargets", () => {
  it("excludes self", () => {
    assert.deepEqual(allowedTargets("codex").sort(), ["antigravity", "claude", "grok"]);
    assert.deepEqual(allowedTargets("claude").sort(), ["antigravity", "codex", "grok"]);
    assert.deepEqual(allowedTargets("grok").sort(), ["antigravity", "claude", "codex"]);
  });
});

describe("evaluateGates", () => {
  it("refuses nested", () => {
    const r = evaluateGates({
      command: "plan",
      target: "claude",
      hostFlag: "codex",
      env: { AGENT_BRIDGE_NESTED: "1", AGENT_BRIDGE_LOCKED_HOST: "codex" }
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.exitCode, EXIT.NESTED);
    }
  });

  it("refuses missing host lock", () => {
    const r = evaluateGates({
      command: "plan",
      target: "claude",
      env: {}
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.exitCode, EXIT.USAGE);
    }
  });

  it("refuses self delegation", () => {
    const r = evaluateGates({
      command: "plan",
      target: "codex",
      env: { AGENT_BRIDGE_LOCKED_HOST: "codex" }
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.exitCode, EXIT.SELF);
    }
  });

  it("allows cross-agent with lock", () => {
    const r = evaluateGates({
      command: "plan",
      target: "claude",
      env: { AGENT_BRIDGE_LOCKED_HOST: "codex" }
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.host, "codex");
    }
  });

  it("status does not require host", () => {
    const r = evaluateGates({ command: "status", env: {} });
    assert.equal(r.ok, true);
  });

  it("allow self only with env", () => {
    const r = evaluateGates({
      command: "plan",
      target: "codex",
      env: { AGENT_BRIDGE_LOCKED_HOST: "codex", AGENT_BRIDGE_ALLOW_SELF: "1" }
    });
    assert.equal(r.ok, true);
  });
});

describe("assertNoForbiddenFlags", () => {
  it("blocks bare and yolo", () => {
    assert.throws(() => assertNoForbiddenFlags(["--bare"]), /Forbidden/);
    assert.throws(() => assertNoForbiddenFlags(["--yolo"]), /Forbidden/);
    assert.throws(() => assertNoForbiddenFlags(["--permission-mode", "bypassPermissions"]), /Forbidden/);
  });

  it("allows normal flags", () => {
    assert.doesNotThrow(() => assertNoForbiddenFlags(["-p", "--output-format", "json"]));
  });
});
