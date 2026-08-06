import fs from "node:fs";
import path from "node:path";
import { allowedTargets, isHostId, isTargetId } from "./ids.mjs";
import {
  agentBridgeHome,
  ensureDir,
  hostLockPath,
  hostWrapperPath,
  packageRoot
} from "./paths.mjs";
import { installHostSkills } from "./skill-install.mjs";

/**
 * @param {string} host
 * @param {string | null} targetsCsv
 */
export function resolveInstallTargets(host, targetsCsv) {
  if (!isHostId(host)) {
    throw new Error(`Invalid host: ${host}`);
  }
  const allowed = allowedTargets(host);
  if (!targetsCsv || !String(targetsCsv).trim()) {
    return [...allowed];
  }
  const requested = String(targetsCsv)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const t of requested) {
    if (!isTargetId(t)) {
      throw new Error(`Unknown target: ${t}`);
    }
    if (t === host) {
      throw new Error(`Cannot install self-target for host ${host}: ${t}`);
    }
    if (!allowed.includes(/** @type {import("./ids.mjs").TargetId} */ (t))) {
      throw new Error(`Target ${t} not allowed for host ${host}`);
    }
  }
  return requested;
}

/**
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 */
export function writeHostWrapper(host, env = process.env) {
  const wrapper = hostWrapperPath(host, env);
  ensureDir(path.dirname(wrapper));
  const cliPath = path.join(packageRoot(), "src", "cli.mjs");
  // CJS so the wrapper works without a package.json "type"
  const body = `#!/usr/bin/env node
"use strict";
process.env.AGENT_BRIDGE_LOCKED_HOST = ${JSON.stringify(host)};
const { spawn } = require("node:child_process");
const cli = ${JSON.stringify(cliPath)};
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 1 : code);
});
`;
  fs.writeFileSync(wrapper, body, { mode: 0o755 });
  try {
    fs.chmodSync(wrapper, 0o755);
  } catch {
    // ignore on platforms without chmod
  }
  return wrapper;
}

/**
 * @param {{
 *   host: string,
 *   targets: string[],
 *   apply: boolean,
 *   env?: NodeJS.ProcessEnv
 * }} opts
 */
export function runInstall(opts) {
  const env = opts.env ?? process.env;
  const host = opts.host;
  const targets = opts.targets;
  const home = agentBridgeHome(env);
  const lockFile = hostLockPath(host, env);
  const wrapper = hostWrapperPath(host, env);
  const plan = {
    host,
    targets,
    home,
    lockFile,
    wrapper,
    applied: false
  };

  if (!opts.apply) {
    return plan;
  }

  ensureDir(path.join(home, "hosts"));
  ensureDir(path.join(home, "bin"));
  writeHostWrapper(host, env);
  const lock = {
    host,
    targets,
    installedAt: new Date().toISOString(),
    cliPath: path.join(packageRoot(), "src", "cli.mjs"),
    wrapperPath: wrapper
  };
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  // Best-effort: put wrapper name on PATH without user exports
  const localBin = path.join(env.HOME || env.USERPROFILE || "", ".local", "bin");
  let pathLink = null;
  if (localBin && fs.existsSync(path.dirname(localBin))) {
    try {
      ensureDir(localBin);
      const linkPath = path.join(localBin, `agent-bridge-${host}`);
      try {
        fs.unlinkSync(linkPath);
      } catch {
        // ignore
      }
      fs.symlinkSync(wrapper, linkPath);
      pathLink = linkPath;
    } catch {
      // optional
    }
  }

  const skills = installHostSkills({
    host,
    targets,
    env,
    apply: true
  });

  plan.applied = true;
  plan.pathLink = pathLink;
  plan.skills = skills;
  plan.userNote =
    "No env exports needed. " +
    `Wrapper: ${wrapper}` +
    (pathLink ? ` (linked ${pathLink})` : "") +
    `. Skills installed under ${skills.destRoot} with absolute wrapper path.`;
  return plan;
}

/**
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readHostLock(host, env = process.env) {
  const p = hostLockPath(host, env);
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
