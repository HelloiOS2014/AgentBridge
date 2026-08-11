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

describe("doctor version drift", () => {
  function seedPlugin(root, version) {
    const dir = path.join(root, "cache", "mp", "antigravity-bridge", version);
    fs.mkdirSync(path.join(dir, "src", "core"), { recursive: true });
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "version"), `${version}\n`, "utf8");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }), "utf8");
    fs.writeFileSync(path.join(dir, "src", "cli.mjs"), "// x\n", "utf8");
    fs.writeFileSync(path.join(dir, "bin", "agent-bridge-claude"), "#!/usr/bin/env node\n", "utf8");
    return dir;
  }

  it("flags engine lagging installed plugin", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-drift-"));
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ab-drift-plug-"));
    seedPlugin(pluginRoot, "0.1.9");
    const engineDir = path.join(home, "engine");
    fs.mkdirSync(engineDir, { recursive: true });
    fs.writeFileSync(path.join(engineDir, "version"), "0.1.7\n", "utf8");
    const report = await runDoctor({
      env: { ...process.env, AGENT_BRIDGE_HOME: home, AGENT_BRIDGE_PLUGIN_ROOT: pluginRoot, HOME: home },
      cwd: process.cwd()
    });
    assert.ok(report.issues.some((i) => /Engine version 0\.1\.7 lags installed plugin 0\.1\.9/.test(i)), JSON.stringify(report.issues));
  });

  it("no drift issue when versions match", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-drift2-"));
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ab-drift2-plug-"));
    seedPlugin(pluginRoot, "0.1.9");
    const engineDir = path.join(home, "engine");
    fs.mkdirSync(engineDir, { recursive: true });
    fs.writeFileSync(path.join(engineDir, "version"), "0.1.9\n", "utf8");
    const report = await runDoctor({
      env: { ...process.env, AGENT_BRIDGE_HOME: home, AGENT_BRIDGE_PLUGIN_ROOT: pluginRoot, HOME: home },
      cwd: process.cwd()
    });
    assert.ok(!report.issues.some((i) => /Engine version/.test(i)), JSON.stringify(report.issues));
  });
});
