import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
    const r = run(["claude", "plan", "--json", "--prompt", "x"], {
      AGENT_BRIDGE_LOCKED_HOST: "",
      env: undefined
    });
    // clear lock
    const r2 = spawnSync(process.execPath, [cli, "claude", "plan", "--json", "--prompt", "x"], {
      encoding: "utf8",
      env: { ...process.env, AGENT_BRIDGE_LOCKED_HOST: undefined }
    });
    // ensure unset
    const env = { ...process.env };
    delete env.AGENT_BRIDGE_LOCKED_HOST;
    const r3 = spawnSync(process.execPath, [cli, "claude", "plan", "--json", "--prompt", "x"], {
      encoding: "utf8",
      env
    });
    assert.equal(r3.status, EXIT.USAGE);
  });

  it("nested exit 4", () => {
    const env = { ...process.env, AGENT_BRIDGE_NESTED: "1", AGENT_BRIDGE_LOCKED_HOST: "codex" };
    const r = spawnSync(process.execPath, [cli, "claude", "plan", "--json"], {
      encoding: "utf8",
      env
    });
    assert.equal(r.status, EXIT.NESTED);
  });

  it("install rejects self targets", () => {
    const r = spawnSync(
      process.execPath,
      [cli, "install", "--host", "codex", "--targets", "codex", "--json"],
      { encoding: "utf8", env: process.env }
    );
    assert.equal(r.status, EXIT.USAGE);
  });
});
