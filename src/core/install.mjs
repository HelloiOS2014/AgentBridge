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
import { installHostSkills, KINDS, userSkillsRoot } from "./skill-install.mjs";

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

/**
 * 卸载。target 为 null → 全量：移除 wrapper / lock / PATH 链接 + 全部已装 target 的 skills。
 * target 非空 → 目标级：只删该 target 的 skill 目录（精确 `${target}-${kind}`，不碰
 * wrapper / lock / PATH 链接），lock 重写为去掉该 target。
 * 两种模式都只删本工具安装的目录，不碰 userSkillsRoot 里其它内容
 * （如 ~/.claude/skills 下的用户自有 skill）。
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string | null} [target] 指定则只卸载该 target 的 skills
 */
export function runUninstall(host, env = process.env, target = null) {
  const removed = [];
  const skillsRoot = userSkillsRoot(host, env);
  const removeSkillDirs = (ts) => {
    for (const t of ts) {
      for (const kind of KINDS) {
        const dir = path.join(skillsRoot, `${t}-${kind}`);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          removed.push(dir);
        }
      }
    }
  };

  if (target) {
    // 目标级：只删该 target 的 4 个 skill 目录，wrapper / lock / PATH 链接保留
    removeSkillDirs([target]);
    const lock = readHostLock(host, env);
    if (lock && Array.isArray(lock.targets) && lock.targets.includes(target)) {
      lock.targets = lock.targets.filter((t) => t !== target);
      fs.writeFileSync(hostLockPath(host, env), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    }
    return { host, removed };
  }

  // 全量：先读 lock（删掉 lock 后就拿不到 targets 列表了），再移除 wrapper / lock / link
  const lock = readHostLock(host, env);
  const wrapper = hostWrapperPath(host, env);
  const lockFile = hostLockPath(host, env);
  if (fs.existsSync(wrapper)) {
    fs.rmSync(wrapper, { force: true });
    removed.push(wrapper);
  }
  if (fs.existsSync(lockFile)) {
    fs.rmSync(lockFile, { force: true });
    removed.push(lockFile);
  }
  const localBin = path.join(env.HOME || env.USERPROFILE || "", ".local", "bin");
  const pathLink = path.join(localBin, `agent-bridge-${host}`);
  if (fs.existsSync(pathLink)) {
    fs.rmSync(pathLink, { force: true });
    removed.push(pathLink);
  }
  if (lock?.targets?.length > 0 && fs.existsSync(skillsRoot)) {
    removeSkillDirs(lock.targets);
  }
  return { host, removed };
}
