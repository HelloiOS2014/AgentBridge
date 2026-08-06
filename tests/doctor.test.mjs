import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runDoctor } from "../src/core/doctor.mjs";
import { runInstall } from "../src/core/install.mjs";

const fakeClaude = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-claude.mjs");

describe("doctor", () => {
  it("flags missing wrapper before install", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-doc-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const env = {
      HOME: home,
      USERPROFILE: home,
      AGENT_BRIDGE_HOME: path.join(home, ".agent-bridge"),
      AGENT_BRIDGE_CLAUDE_BIN: fakeClaude
    };
    const report = await runDoctor({ host: "codex", env, cwd: process.cwd() });
    assert.ok(report.issues.some((i) => /wrapper/i.test(i) || /install/i.test(i)));
  });

  it("after install wrapper exists", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-doc2-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const env = {
      HOME: home,
      USERPROFILE: home,
      AGENT_BRIDGE_HOME: path.join(home, ".agent-bridge"),
      AGENT_BRIDGE_CLAUDE_BIN: fakeClaude,
      AGENT_BRIDGE_ANTIGRAVITY_BIN: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agy.mjs"),
      AGENT_BRIDGE_GROK_BIN: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-grok.mjs"),
      AGENT_BRIDGE_CODEX_BIN: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs")
    };
    runInstall({ host: "codex", targets: ["claude"], apply: true, env });
    const report = await runDoctor({ host: "codex", env, cwd: process.cwd() });
    assert.equal(report.hosts.codex.wrapperExists, true);
    assert.equal(report.hosts.codex.lock, true);
    assert.ok(report.hosts.codex.skillCount >= 4);
    assert.equal(report.targets.claude.ready, true);
  });
});
