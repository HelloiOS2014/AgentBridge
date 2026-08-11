import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 插件缓存根：AGENT_BRIDGE_PLUGIN_ROOT 覆盖（测试用），否则各 Host 默认位置。 */
function pluginRoots(env) {
  if (env.AGENT_BRIDGE_PLUGIN_ROOT) {
    return [path.resolve(env.AGENT_BRIDGE_PLUGIN_ROOT)];
  }
  return [
    path.join(os.homedir(), ".claude", "plugins"),
    path.join(os.homedir(), ".codex"),
    path.join(os.homedir(), ".grok")
  ];
}

function agentBridgeHome(env) {
  return env.AGENT_BRIDGE_HOME
    ? path.resolve(env.AGENT_BRIDGE_HOME)
    : path.join(os.homedir(), ".agent-bridge");
}

/**
 * 在插件缓存里找所有 bridge 插件的版本文件，返回最高版本对应的插件目录。
 * 引擎更新不依赖自举/skill 缓存——本命令直接从插件源重建引擎。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<{ host: string, version: string, pluginDir: string }>}
 */
export function findInstalledPlugins(env = process.env) {
  const found = [];
  for (const root of pluginRoots(env)) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
        } else if (entry.name === "version" && dir.includes("-bridge")) {
          try {
            const version = fs.readFileSync(p, "utf8").trim();
            const host = dir.match(/bin\/agent-bridge-([a-z]+)/)?.[1]
              ?? path.basename(dir).split("-")[0] // 回退：从插件名猜 host
              ?? "unknown";
            if (version) {
              found.push({ host, version, pluginDir: path.dirname(p) });
            }
          } catch {
            // 损坏的版本文件跳过
          }
        }
      }
    };
    walk(root);
  }
  // 取每个插件目录的最高版本（版本号排序）
  const best = new Map();
  for (const item of found) {
    const key = `${item.pluginDir.split(path.sep).filter((s) => s.includes("-bridge")).pop()}:${item.host}`;
    const prev = best.get(key);
    if (!prev || compareVersions(item.version, prev.version) > 0) {
      best.set(key, item);
    }
  }
  return [...best.values()];
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

/**
 * 显式更新：从已安装插件（最高版本）重建引擎与 wrapper。
 * 不依赖 skill 触发/自举时机——任何旧引擎版本都能执行。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ from: string | null, to: string | null, engine: string, updated: string[] }}
 */
export function runSelfUpdate(env = process.env) {
  const plugins = findInstalledPlugins(env);
  const engineTarget = path.join(agentBridgeHome(env), "engine");
  const binTarget = path.join(agentBridgeHome(env), "bin");
  const result = { from: null, to: null, engine: engineTarget, updated: [] };
  const engineVersionFile = path.join(engineTarget, "version");
  result.from = fs.existsSync(engineVersionFile) ? fs.readFileSync(engineVersionFile, "utf8").trim() : null;

  // 取所有插件中的最高版本作为目标
  let best = null;
  for (const item of plugins) {
    if (!best || compareVersions(item.version, best.version) > 0) {
      best = item;
    }
  }
  if (!best) {
    return result;
  }
  result.to = best.version;
  if (result.from === best.version) {
    result.updated = [];
    return result;
  }

  const srcDir = path.join(best.pluginDir, "src");
  if (!fs.existsSync(srcDir)) {
    return result;
  }
  fs.rmSync(engineTarget, { recursive: true, force: true });
  fs.mkdirSync(engineTarget, { recursive: true });
  fs.mkdirSync(binTarget, { recursive: true });
  fs.cpSync(srcDir, path.join(engineTarget, "src"), { recursive: true });
  for (const f of ["package.json", "version"]) {
    const s = path.join(best.pluginDir, f);
    if (fs.existsSync(s)) {
      fs.copyFileSync(s, path.join(engineTarget, f));
    }
  }
  const templates = path.join(best.pluginDir, "skills-templates");
  if (fs.existsSync(templates)) {
    fs.cpSync(templates, path.join(engineTarget, "skills-templates"), { recursive: true });
  }
  // wrapper：插件里所有 bin/agent-bridge-<host> 都复制到 ~/.agent-bridge/bin/
  const binDir = path.join(best.pluginDir, "bin");
  if (fs.existsSync(binDir)) {
    for (const name of fs.readdirSync(binDir)) {
      if (name.startsWith("agent-bridge-")) {
        const target = path.join(binTarget, name);
        fs.copyFileSync(path.join(binDir, name), target);
        fs.chmodSync(target, 0o755);
        result.updated.push(target);
      }
    }
  }
  result.updated.push(path.join(engineTarget, "version"));
  return result;
}
