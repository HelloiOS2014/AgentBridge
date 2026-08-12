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

describe("doctor marketplace form", () => {
  function seedMarketplacePlugin(root, version) {
    // marketplace 名 agent-bridge-claude → host claude；插件 antigravity-bridge 带 skills
    const dir = path.join(root, "cache", "agent-bridge-claude", "antigravity-bridge", version);
    fs.mkdirSync(path.join(dir, "skills", "antigravity-rescue"), { recursive: true });
    fs.writeFileSync(path.join(dir, "version"), `${version}\n`, "utf8");
    fs.writeFileSync(path.join(dir, "skills", "antigravity-rescue", "SKILL.md"), "# antigravity-rescue\n", "utf8");
    return dir;
  }

  it("marketplace-installed host passes without install lock or user skills", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mp-"));
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mp-plug-"));
    t.after(() => {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(pluginRoot, { recursive: true, force: true });
    });
    seedMarketplacePlugin(pluginRoot, "0.1.20");
    // marketplace 形态的 wrapper 由自举生成（存在但无 lock、无 user skills）
    const wrapper = path.join(home, "bin", "agent-bridge-claude");
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.writeFileSync(wrapper, "#!/usr/bin/env node\n", { mode: 0o755 });
    const report = await runDoctor({
      host: "claude",
      env: { ...process.env, HOME: home, AGENT_BRIDGE_HOME: home, AGENT_BRIDGE_PLUGIN_ROOT: pluginRoot },
      cwd: process.cwd()
    });
    assert.ok(!report.issues.some((i) => /install lock|No user skills/.test(i)), JSON.stringify(report.issues));
  });

  it("still flags missing install when no marketplace plugin installed", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mp2-"));
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mp2-plug-"));
    t.after(() => {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(pluginRoot, { recursive: true, force: true });
    });
    const report = await runDoctor({
      host: "claude",
      env: { ...process.env, HOME: home, AGENT_BRIDGE_HOME: home, AGENT_BRIDGE_PLUGIN_ROOT: pluginRoot },
      cwd: process.cwd()
    });
    assert.ok(report.issues.some((i) => /install lock/.test(i)), JSON.stringify(report.issues));
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

describe("doctor interrupted-write scan", () => {
  it("reports stranded output for a stale marker", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-int-"));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ab-int-scr-"));
    const marker = path.join(scratch, ".agent-bridge-run-123.marker");
    fs.writeFileSync(marker, JSON.stringify({ targetDir: "/tmp/x", startedAt: new Date(Date.now() - 600000).toISOString() }), "utf8");
    const past = new Date(Date.now() - 600000);
    fs.utimesSync(marker, past, past); // 6 分钟前 → 过期
    fs.writeFileSync(path.join(scratch, "stranded.txt"), "leftover\n");
    const strandedTime = new Date(Date.now() - 10000);
    fs.utimesSync(path.join(scratch, "stranded.txt"), strandedTime, strandedTime);

    const report = await runDoctor({
      env: { ...process.env, AGENT_BRIDGE_HOME: home, AGENT_BRIDGE_PLUGIN_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "ab-int-plug-")), AGENT_BRIDGE_ANTIGRAVITY_SCRATCH: scratch, HOME: home },
      cwd: process.cwd()
    });
    assert.ok(report.issues.some((i) => /Interrupted antigravity write.*stranded\.txt/.test(i)), JSON.stringify(report.issues));
  });

  it("fresh marker is not reported", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-int2-"));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ab-int2-scr-"));
    const marker = path.join(scratch, ".agent-bridge-run-456.marker");
    fs.writeFileSync(marker, JSON.stringify({ targetDir: "/tmp/x", startedAt: new Date().toISOString() }), "utf8");
    const report = await runDoctor({
      env: { ...process.env, AGENT_BRIDGE_HOME: home, AGENT_BRIDGE_PLUGIN_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "ab-int2-plug-")), AGENT_BRIDGE_ANTIGRAVITY_SCRATCH: scratch, HOME: home },
      cwd: process.cwd()
    });
    assert.ok(!report.issues.some((i) => /Interrupted antigravity write/.test(i)), JSON.stringify(report.issues));
  });
});
