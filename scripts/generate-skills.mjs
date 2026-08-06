#!/usr/bin/env node
// Generate Host skill packs from skills-templates into hosts/*/plugins.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedTargets } from "../src/core/ids.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = path.join(root, "skills-templates");

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

const KINDS = ["plan", "review", "rescue", "result-handling"];

/**
 * @param {string} host
 */
function pluginRootFor(host, target) {
  if (host === "codex") {
    return path.join(root, "hosts/codex/plugins", `${target}-bridge`);
  }
  if (host === "claude") {
    return path.join(root, "hosts/claude/plugins", `${target}-bridge`);
  }
  // Grok: flat skills under hosts/grok/skills
  return path.join(root, "hosts/grok");
}

/**
 * @param {string} host
 * @param {string} target
 * @param {string} kind
 */
function skillDir(host, target, kind) {
  if (host === "grok") {
    return path.join(root, "hosts/grok/skills", `${target}-${kind}`);
  }
  return path.join(pluginRootFor(host, target), "skills", `${target}-${kind}`);
}

/**
 * @param {string} tpl
 * @param {Record<string, string>} vars
 */
function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function main() {
  const dry = process.argv.includes("--dry-run");
  let count = 0;

  for (const host of ["codex", "claude", "grok"]) {
    const targets = allowedTargets(/** @type {import("../src/core/ids.mjs").HostId} */ (host));
    // default wrapper path (install may rewrite to absolute realpath)
    const wrapper = `$HOME/.agent-bridge/bin/agent-bridge-${host}`;

    for (const target of targets) {
      for (const kind of KINDS) {
        const tplPath = path.join(templatesDir, `${kind}.md.tpl`);
        if (!fs.existsSync(tplPath)) {
          throw new Error(`missing template ${tplPath}`);
        }
        const tpl = fs.readFileSync(tplPath, "utf8");
        const body = render(tpl, {
          HOST: host,
          HOST_LABEL: HOST_LABEL[host],
          TARGET: target,
          TARGET_LABEL: TARGET_LABEL[target],
          WRAPPER: wrapper
        });
        const dir = skillDir(host, target, kind);
        const out = path.join(dir, "SKILL.md");
        if (!dry) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(out, body, "utf8");
        }
        count += 1;
        console.log(dry ? `would write ${path.relative(root, out)}` : `wrote ${path.relative(root, out)}`);
      }
    }
  }

  console.log(`generate-skills: ${count} skills ${dry ? "(dry-run)" : "written"}`);
}

main();
