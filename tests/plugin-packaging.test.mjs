import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pluginRootFor, renderBootstrapBlock } from "../scripts/generate-skills.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeAgy = path.join(root, "tests", "fixtures", "fake-agy.mjs");
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

/** 模拟 Claude 插件缓存布局：~/.claude/plugins/cache/<marketplace>/<plugin> */
function mockPluginHome(host = "claude", target = "antigravity") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-pluginhome-"));
  const plugin = path.join(home, ".claude", "plugins", "cache", "agent-bridge", `${target}-bridge`);
  fs.mkdirSync(plugin, { recursive: true });
  fs.cpSync(pluginRootFor(host, target), plugin, { recursive: true });
  return { home, plugin };
}

function runBootstrap(block, env) {
  return spawnSync("bash", ["-c", block], { encoding: "utf8", env });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describe("plugin packaging (generate output)", () => {
  it("each bridge plugin ships engine payload + wrapper + skills + version", () => {
    for (const host of ["codex", "claude", "grok"]) {
      for (const target of ["claude", "codex", "grok", "antigravity"].filter((t) => t !== host)) {
        const dir = pluginRootFor(host, target);
        assert.ok(fs.existsSync(path.join(dir, "src", "cli.mjs")), `${host}/${target} src/cli.mjs`);
        assert.ok(fs.existsSync(path.join(dir, "bin", `agent-bridge-${host}`)), `${host}/${target} bin wrapper`);
        assert.equal(fs.readFileSync(path.join(dir, "version"), "utf8").trim(), packageVersion);
        assert.ok(fs.existsSync(path.join(dir, "package.json")), `${host}/${target} package.json`);
        assert.ok(fs.existsSync(path.join(dir, "skills-templates", "plan.md.tpl")), `${host}/${target} templates`);
        // 静态 wrapper 指向引擎固定路径（运行时解析 $HOME）
        const wrapper = fs.readFileSync(path.join(dir, "bin", `agent-bridge-${host}`), "utf8");
        assert.ok(wrapper.includes('AGENT_BRIDGE_LOCKED_HOST = "' + host + '"'), `${host}/${target} host lock`);
        assert.ok(wrapper.includes('.agent-bridge", "engine", "src", "cli.mjs"'), `${host}/${target} engine cliPath`);
        // 插件内 src 与根 src 一致（防漂移）
        for (const rel of ["core/run.mjs", "adapters/antigravity.mjs", "cli.mjs"]) {
          assert.equal(
            sha256(path.join(dir, "src", rel)),
            sha256(path.join(root, "src", rel)),
            `${host}/${target} src/${rel} drift`
          );
        }
      }
    }
  });

  it("bootstrap block references host plugin root and target pattern", () => {
    const block = renderBootstrapBlock("claude", "antigravity");
    assert.ok(block.includes('find "$HOME/.claude/plugins" -path "*antigravity-bridge*"'));
    assert.ok(block.includes("agent-bridge-claude"));
    const codex = renderBootstrapBlock("codex", "claude");
    assert.ok(codex.includes('find "$HOME/.codex" -path "*claude-bridge*"'));
  });
});

describe("skill self-bootstrap", () => {
  it("installs engine + wrapper from plugin into $HOME/.agent-bridge", () => {
    const { home } = mockPluginHome();
    const env = { ...process.env, HOME: home };
    const r = runBootstrap(renderBootstrapBlock("claude", "antigravity"), env);
    assert.equal(r.status, 0, r.stderr);

    const engineCli = path.join(home, ".agent-bridge", "engine", "src", "cli.mjs");
    const wrapper = path.join(home, ".agent-bridge", "bin", "agent-bridge-claude");
    assert.ok(fs.existsSync(engineCli), "engine cli installed");
    assert.ok(fs.existsSync(wrapper), "wrapper installed");
    assert.ok(fs.statSync(wrapper).mode & 0o100, "wrapper executable");
    assert.equal(fs.readFileSync(path.join(home, ".agent-bridge", "engine", "version"), "utf8").trim(), packageVersion);
    assert.ok(fs.existsSync(path.join(home, ".agent-bridge", "engine", "package.json")));
  });

  it("second run is a no-op (version matches)", () => {
    const { home } = mockPluginHome();
    const env = { ...process.env, HOME: home };
    const block = renderBootstrapBlock("claude", "antigravity");
    assert.equal(runBootstrap(block, env).status, 0);
    const engineCli = path.join(home, ".agent-bridge", "engine", "src", "cli.mjs");
    const before = fs.statSync(engineCli).mtimeMs;
    assert.equal(runBootstrap(block, env).status, 0);
    assert.equal(fs.statSync(engineCli).mtimeMs, before, "no recopy when versions match");
  });

  it("plugin version bump re-installs engine (update drift guard)", () => {
    const { home, plugin } = mockPluginHome();
    const env = { ...process.env, HOME: home };
    const block = renderBootstrapBlock("claude", "antigravity");
    assert.equal(runBootstrap(block, env).status, 0);
    const engineCli = path.join(home, ".agent-bridge", "engine", "src", "cli.mjs");
    const before = fs.statSync(engineCli).mtimeMs;
    fs.writeFileSync(path.join(plugin, "version"), "9.9.9\n", "utf8");
    assert.equal(runBootstrap(block, env).status, 0);
    assert.ok(fs.statSync(engineCli).mtimeMs > before, "engine re-copied on version change");
    assert.equal(fs.readFileSync(path.join(home, ".agent-bridge", "engine", "version"), "utf8").trim(), "9.9.9");
  });

  it("engine + wrapper work end-to-end: delegation with fake agy bin", () => {
    const { home } = mockPluginHome();
    const env = {
      ...process.env,
      HOME: home,
      AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy
    };
    const block = renderBootstrapBlock("claude", "antigravity");
    assert.equal(runBootstrap(block, env).status, 0);

    const wrapper = path.join(home, ".agent-bridge", "bin", "agent-bridge-claude");
    const r = spawnSync(process.execPath, [wrapper, "antigravity", "plan", "--json", "--prompt", "marketplace e2e"], {
      encoding: "utf8",
      env
    });
    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.status, "completed");
    assert.equal(payload.target, "antigravity");
    assert.equal(payload.host, "claude");
    assert.match(payload.rendered, /marketplace e2e/);
  });

  it("no plugin present: bootstrap is a no-op (no engine dir)", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-noplugin-"));
    const r = runBootstrap(renderBootstrapBlock("claude", "antigravity"), { ...process.env, HOME: home });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(home, ".agent-bridge")), false);
  });
});
