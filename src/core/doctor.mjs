import fs from "node:fs";
import path from "node:path";
import { ADAPTERS } from "../adapters/index.mjs";
import { allowedTargets, HOST_IDS, isHostId } from "./ids.mjs";
import { readHostLock } from "./install.mjs";
import { agentBridgeHome, hostWrapperPath } from "./paths.mjs";
import { userSkillsRoot } from "./skill-install.mjs";

/**
 * @param {{ host?: string | null, env?: NodeJS.ProcessEnv, cwd?: string }} opts
 */
export async function runDoctor(opts = {}) {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const cwd = opts.cwd ?? process.cwd();
  const host = opts.host && isHostId(opts.host) ? opts.host : null;
  const home = agentBridgeHome(env);

  const hosts = {};
  for (const h of HOST_IDS) {
    const lock = readHostLock(h, env);
    const wrapper = hostWrapperPath(h, env);
    const wrapperExists = fs.existsSync(wrapper);
    const skillsRoot = userSkillsRoot(h, env);
    let skillCount = 0;
    if (fs.existsSync(skillsRoot)) {
      skillCount = fs.readdirSync(skillsRoot).filter((n) => {
        return fs.existsSync(path.join(skillsRoot, n, "SKILL.md"));
      }).length;
    }
    hosts[h] = {
      lock: Boolean(lock),
      lockTargets: lock?.targets ?? [],
      wrapper,
      wrapperExists,
      skillsRoot,
      skillCount,
      allowedTargets: allowedTargets(h)
    };
  }

  const targets = {};
  const list = host ? allowedTargets(host) : ["claude", "codex", "grok", "antigravity"];
  for (const t of list) {
    const adapter = ADAPTERS[t];
    if (!adapter) {
      targets[t] = { ready: false, message: "no adapter" };
      continue;
    }
    try {
      targets[t] = await adapter.setup({ cwd, env, timeoutMs: 8000 });
    } catch (error) {
      targets[t] = {
        ready: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const issues = [];
  if (host) {
    const h = hosts[host];
    if (!h.wrapperExists) {
      issues.push(`Missing wrapper for ${host}. Run: agent-bridge install --host ${host} --apply`);
    }
    if (!h.lock) {
      issues.push(`No install lock for ${host}. Run: agent-bridge install --host ${host} --apply`);
    }
    if (h.skillCount === 0) {
      issues.push(`No user skills under ${h.skillsRoot}. Re-run install --apply.`);
    }
  }
  for (const [t, info] of Object.entries(targets)) {
    if (!info.ready && host && allowedTargets(host).includes(/** @type {*} */ (t))) {
      issues.push(`Target ${t} not ready: ${info.message || "check install/login"}`);
    }
  }

  const ready = issues.length === 0;
  return {
    status: "completed",
    kind: "doctor",
    summary: ready
      ? host
        ? `Host ${host} looks ready`
        : "Doctor snapshot (pass --host for focused checks)"
      : `Issues: ${issues.length}`,
    host,
    home,
    hosts,
    targets,
    issues,
    ready: host ? ready : undefined,
    note: "Users do not need to export env vars. Install creates wrapper + skills with absolute paths."
  };
}
