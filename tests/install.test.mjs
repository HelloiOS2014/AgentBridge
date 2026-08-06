import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveInstallTargets, runInstall, runUninstall } from "../src/core/install.mjs";

describe("resolveInstallTargets", () => {
  it("defaults to allowed", () => {
    assert.deepEqual(resolveInstallTargets("codex", null).sort(), ["antigravity", "claude", "grok"]);
  });

  it("rejects self", () => {
    assert.throws(() => resolveInstallTargets("codex", "codex"), /self-target/);
  });

  it("accepts subset", () => {
    assert.deepEqual(resolveInstallTargets("claude", "codex,grok").sort(), ["codex", "grok"]);
  });
});

describe("runInstall", () => {
  it("dry-run does not write", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-home-"));
    const env = { AGENT_BRIDGE_HOME: home, HOME: home };
    const plan = runInstall({
      host: "codex",
      targets: ["claude"],
      apply: false,
      env
    });
    assert.equal(plan.applied, false);
    assert.equal(fs.existsSync(plan.lockFile), false);
  });

  it("apply writes lock and wrapper", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-home-"));
    const env = { AGENT_BRIDGE_HOME: home, HOME: home };
    const plan = runInstall({
      host: "codex",
      targets: ["claude", "grok"],
      apply: true,
      env
    });
    assert.equal(plan.applied, true);
    assert.ok(fs.existsSync(plan.lockFile));
    assert.ok(fs.existsSync(plan.wrapper));
    const lock = JSON.parse(fs.readFileSync(plan.lockFile, "utf8"));
    assert.equal(lock.host, "codex");
    assert.deepEqual(lock.targets, ["claude", "grok"]);
    const wrapper = fs.readFileSync(plan.wrapper, "utf8");
    assert.match(wrapper, /AGENT_BRIDGE_LOCKED_HOST = "codex"/);
  });
});

describe("runUninstall", () => {
  it("whole-host removes wrapper, lock, and installed skills only", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-home-"));
    const env = { AGENT_BRIDGE_HOME: home, HOME: home };
    runInstall({ host: "codex", targets: ["claude"], apply: true, env });
    const skillsRoot = path.join(home, ".agent-bridge", "skills", "codex");
    const userSkill = path.join(home, ".agent-bridge", "skills", "codex", "user-own-skill");
    fs.mkdirSync(userSkill, { recursive: true });
    const res = runUninstall("codex", env, null);
    const removed = new Set(res.removed);
    assert.equal(fs.existsSync(path.join(home, "hosts", "codex.lock.json")), false);
    assert.equal(fs.existsSync(path.join(home, "bin", "agent-bridge-codex")), false);
    assert.ok(removed.has(path.join(skillsRoot, "claude-plan"))); // installed skill dirs
    assert.equal(fs.existsSync(path.join(skillsRoot, "claude-plan")), false);
    assert.equal(fs.existsSync(userSkill), true); // 不碰非本工具安装的 skill
    assert.equal(fs.existsSync(skillsRoot), true); // 根目录本身保留
  });

  it("target-scoped removes only that target's skill dirs", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-home-"));
    const env = { AGENT_BRIDGE_HOME: home, HOME: home };
    runInstall({ host: "codex", targets: ["claude", "grok"], apply: true, env });
    const skillsRoot = path.join(home, ".agent-bridge", "skills", "codex");
    runUninstall("codex", env, "claude");
    assert.equal(fs.existsSync(path.join(skillsRoot, "claude-plan")), false);
    assert.equal(fs.existsSync(path.join(skillsRoot, "grok-plan")), true);
  });
});
