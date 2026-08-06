import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInstall } from "../src/core/install.mjs";
import { installHostSkills, userSkillsRoot } from "../src/core/skill-install.mjs";

describe("skill install", () => {
  it("writes absolute wrapper into user skills", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-skills-"));
    const env = { HOME: home, USERPROFILE: home, AGENT_BRIDGE_HOME: path.join(home, ".agent-bridge") };
    // wrapper must exist path-wise
    const plan = runInstall({ host: "claude", targets: ["codex"], apply: true, env });
    assert.equal(plan.applied, true);
    const dest = userSkillsRoot("claude", env);
    const skill = path.join(dest, "codex-plan", "SKILL.md");
    assert.ok(fs.existsSync(skill));
    const body = fs.readFileSync(skill, "utf8");
    assert.ok(body.includes(plan.wrapper));
    assert.ok(body.includes("codex plan"));
    assert.ok(!body.includes("--bare"));
    assert.ok(!body.includes("export AGENT_BRIDGE"));
    assert.ok(!body.includes("--bare"));
  });

  it("dry-run skills does not write", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-skills-dry-"));
    const env = { HOME: home, AGENT_BRIDGE_HOME: path.join(home, ".agent-bridge") };
    const r = installHostSkills({ host: "grok", targets: ["claude"], apply: false, env });
    assert.equal(r.applied, false);
    assert.ok(!fs.existsSync(r.written[0]));
  });
});
