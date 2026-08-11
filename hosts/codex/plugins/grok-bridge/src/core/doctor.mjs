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

  let targets;
  const list = host ? allowedTargets(host) : ["claude", "codex", "grok", "antigravity"];
  const entries = list.map(async (t) => {
    const adapter = ADAPTERS[t];
    if (!adapter) {
      return [t, { ready: false, message: "no adapter" }];
    }
    try {
      return [t, await adapter.setup({ cwd, env, timeoutMs: 8000 })];
    } catch (error) {
      return [t, { ready: false, message: error instanceof Error ? error.message : String(error) }];
    }
  });
  targets = Object.fromEntries(await Promise.all(entries));

  const issues = [];
  // 版本漂移检测：引擎 vs 插件缓存最高版本——告诉用户"该不该更新"，而不是盲目更
  try {
    const { findInstalledPlugins } = await import("./self-update.mjs");
    const { readFileSync } = await import("node:fs");
    const engineVersionFile = path.join(agentBridgeHome(env), "engine", "version");
    const engineVersion = fs.existsSync(engineVersionFile)
      ? readFileSync(engineVersionFile, "utf8").trim()
      : null;
    const latest = findInstalledPlugins(env)
      .map((p) => p.version)
      .sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
          const d = (pa[i] ?? 0) - (pb[i] ?? 0);
          if (d !== 0) return d;
        }
        return 0;
      })
      .pop();
    if (latest && engineVersion !== latest) {
      issues.push(
        `Engine version ${engineVersion ?? "missing"} lags installed plugin ${latest}. Run: agent-bridge update`
      );
    }
  } catch {
    // 版本检测失败不阻塞 doctor
  }
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
  const note = `Users do not need to export env vars. Install creates wrapper + skills with absolute paths.${
    "antigravity" in targets
      ? " Antigravity: agy print 模式需 -p 值形式 + settings 权限规则，工具类任务依赖模型完成度；见 docs/agent-differences.md"
      : ""
  }`;
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
    note
  };
}
