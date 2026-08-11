import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runSelfUpdate } from "../src/core/self-update.mjs";

function makePluginCache(root, pluginName, version) {
  const dir = path.join(root, "cache", "agent-bridge-claude", pluginName, version);
  fs.mkdirSync(path.join(dir, "src", "core"), { recursive: true });
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "version"), `${version}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "agent-bridge", version }), "utf8");
  fs.writeFileSync(path.join(dir, "src", "cli.mjs"), `// engine ${version}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "src", "core", "x.mjs"), `// core ${version}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "bin", "agent-bridge-claude"), `#!/usr/bin/env node\n// wrapper ${version}\n`, "utf8");
  fs.chmodSync(path.join(dir, "bin", "agent-bridge-claude"), 0o755);
  return dir;
}

function makeEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-upd-"));
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ab-plugroot-"));
  return {
    AGENT_BRIDGE_HOME: home,
    AGENT_BRIDGE_PLUGIN_ROOT: pluginRoot,
    pluginRoot
  };
}

describe("self update", () => {
  it("updates engine from highest installed plugin version", () => {
    const env = makeEnv();
    makePluginCache(env.pluginRoot, "antigravity-bridge", "0.1.1");
    makePluginCache(env.pluginRoot, "antigravity-bridge", "0.1.6");

    const res = runSelfUpdate(env);
    assert.equal(res.from, null);
    assert.equal(res.to, "0.1.6");
    assert.equal(fs.readFileSync(path.join(env.AGENT_BRIDGE_HOME, "engine", "version"), "utf8").trim(), "0.1.6");
    assert.match(fs.readFileSync(path.join(env.AGENT_BRIDGE_HOME, "engine", "src", "cli.mjs"), "utf8"), /0\.1\.6/);
    const wrapper = path.join(env.AGENT_BRIDGE_HOME, "bin", "agent-bridge-claude");
    assert.equal(fs.existsSync(wrapper), true);
    assert.equal(fs.statSync(wrapper).mode & 0o111, 0o111, "wrapper executable");
  });

  it("already at latest is a no-op", () => {
    const env = makeEnv();
    makePluginCache(env.pluginRoot, "grok-bridge", "0.1.6");
    makePluginCache(env.pluginRoot, "grok-bridge", "0.1.6");
    const first = runSelfUpdate(env);
    assert.equal(first.updated.length > 0, true);
    const second = runSelfUpdate(env);
    assert.equal(second.from, "0.1.6");
    assert.equal(second.updated.length, 0);
  });

  it("no plugins found reports nulls", () => {
    const env = makeEnv();
    const res = runSelfUpdate(env);
    assert.equal(res.to, null);
  });
});
