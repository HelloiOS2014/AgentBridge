import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EXIT } from "../src/core/exit-codes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

describe("cli gates", () => {
  it("self delegation exit 3", () => {
    const r = run(["--host", "codex", "codex", "plan", "--json", "--prompt", "x"], {
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    });
    // --host and LOCKED both codex; target codex -> self
    assert.equal(r.status, EXIT.SELF);
    const j = JSON.parse(r.stdout);
    assert.equal(j.errorCode, "self_delegation");
  });

  it("missing lock exit 2", () => {
    const env = { ...process.env };
    delete env.AGENT_BRIDGE_LOCKED_HOST;
    const r = run(["claude", "plan", "--json", "--prompt", "x"], env);
    assert.equal(r.status, EXIT.USAGE);
  });

  it("nested exit 4", () => {
    const r = run(["claude", "plan", "--json"], {
      AGENT_BRIDGE_NESTED: "1",
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    });
    assert.equal(r.status, EXIT.NESTED);
  });

  it("status on corrupt job exits 1 with job_corrupt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-cli-"));
    const stateDir = path.join(home, "state");
    const id = crypto.randomUUID();
    const jobFile = path.join(stateDir, "codex", "claude", "ws", "jobs", `${id}.json`);
    fs.mkdirSync(path.dirname(jobFile), { recursive: true });
    fs.writeFileSync(jobFile, "{ broken", "utf8");
    fs.writeFileSync(
      path.join(stateDir, "job-index.json"),
      JSON.stringify({ [id]: { host: "codex", target: "claude", workspaceHash: "ws", path: jobFile } }, null, 2),
      "utf8"
    );
    const r = run(["status", id, "--json"], {
      AGENT_BRIDGE_STATE_DIR: stateDir,
      AGENT_BRIDGE_HOME: home
    });
    assert.equal(r.status, EXIT.FAIL);
    assert.equal(JSON.parse(r.stdout).errorCode, "job_corrupt");
  });

  it("install rejects self targets", () => {
    const r = run(["install", "--host", "codex", "--targets", "codex", "--json"]);
    assert.equal(r.status, EXIT.USAGE);
  });

  it("--worker and --background are mutually exclusive (exit 2)", () => {
    const r = run(["claude", "plan", "--background", "--worker", "abc", "--json", "--prompt", "x"], {
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    });
    assert.equal(r.status, EXIT.USAGE);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });

  it("--worker without a value exits 2", () => {
    const r = run(["claude", "plan", "--worker", "--json", "--prompt", "x"], {
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    });
    assert.equal(r.status, EXIT.USAGE);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });

  it("--wait without --background exits 2", () => {
    const r = run(["claude", "plan", "--wait", "--json", "--prompt", "x"], {
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    });
    assert.equal(r.status, EXIT.USAGE);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });
});
