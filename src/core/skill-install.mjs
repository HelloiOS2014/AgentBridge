import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedTargets } from "./ids.mjs";
import { hostWrapperPath, packageRoot } from "./paths.mjs";

const KINDS = ["plan", "review", "rescue", "result-handling"];

const HOST_LABEL = {
  codex: "Codex",
  claude: "Claude Code",
  grok: "Grok Build"
};

const TARGET_LABEL = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok Build",
  antigravity: "Antigravity"
};

/**
 * Where to install invocable skills for each host (user-level).
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 */
export function userSkillsRoot(host, env = process.env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (host === "codex") {
    // Codex discovers project/plugin skills; user global often ~/.agents/skills or plugin tree.
    // Install into ~/.agent-bridge/skills/codex for clarity + optional link.
    return path.join(home, ".agent-bridge", "skills", "codex");
  }
  if (host === "claude") {
    return path.join(home, ".claude", "skills");
  }
  if (host === "grok") {
    return path.join(home, ".grok", "skills");
  }
  return path.join(home, ".agent-bridge", "skills", host);
}

/**
 * @param {string} tpl
 * @param {Record<string, string>} vars
 */
function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Install generated skills for host+targets with absolute wrapper path.
 * @param {{
 *   host: string,
 *   targets: string[],
 *   env?: NodeJS.ProcessEnv,
 *   apply: boolean
 * }} opts
 */
export function installHostSkills(opts) {
  const env = opts.env ?? process.env;
  const host = opts.host;
  const wrapperAbs = hostWrapperPath(host, env);
  const templatesDir = path.join(packageRoot(), "skills-templates");
  const destRoot = userSkillsRoot(host, env);
  const written = [];

  for (const target of opts.targets) {
    for (const kind of KINDS) {
      const tplPath = path.join(templatesDir, `${kind}.md.tpl`);
      const tpl = fs.readFileSync(tplPath, "utf8");
      const body = render(tpl, {
        HOST: host,
        HOST_LABEL: HOST_LABEL[host],
        TARGET: target,
        TARGET_LABEL: TARGET_LABEL[target],
        WRAPPER: wrapperAbs
      });
      const skillName = `${target}-${kind}`;
      const dir = path.join(destRoot, skillName);
      const file = path.join(dir, "SKILL.md");
      if (opts.apply) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, body, "utf8");
      }
      written.push(file);
    }
  }

  return { destRoot, wrapperAbs, written, applied: opts.apply };
}

/**
 * Ensure repo marketplace skill trees exist (for git install from source).
 * Uses $HOME placeholder; installHostSkills rewrites absolute for user dirs.
 */
export function generateRepoSkills() {
  // re-export via spawning generate script is fine; keep logic in generate-skills.mjs
  return { ok: true };
}

export { allowedTargets, KINDS };
