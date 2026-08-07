#!/usr/bin/env node
// Generate Host skill packs + self-contained bridge plugin packages from skills-templates.
// Each <target>-bridge plugin ships: src/ (engine copy), bin/agent-bridge-<host> (static
// wrapper), skills/, version (package version), package.json, skills-templates/ — so the
// host marketplace install is fully self-sufficient (skill bootstrap copies engine on first use).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedTargets } from "../src/core/ids.mjs";
import { wrapperBody } from "../src/core/install.mjs";

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

/** find 根：skill 自举段在每个 host 的插件安装根下定位 <target>-bridge 插件。 */
const BOOTSTRAP_FIND_ROOT = {
  codex: "$HOME/.codex",
  claude: "$HOME/.claude/plugins",
  grok: "$HOME/.grok"
};

/** Engine install 目标（与 skill 自举段、wrapper 静态 cliPath 三方一致）。 */
export const ENGINE_TARGET = {
  engine: "$HOME/.agent-bridge/engine",
  wrapper: "$HOME/.agent-bridge/bin/agent-bridge"
};

/**
 * @param {string} host
 * @param {string} target
 */
export function pluginRootFor(host, target) {
  if (host === "codex") {
    return path.join(root, "hosts/codex/plugins", `${target}-bridge`);
  }
  if (host === "claude") {
    return path.join(root, "hosts/claude/plugins", `${target}-bridge`);
  }
  // Grok: 平铺 skills 在 hosts/grok/skills；插件树只放引擎 payload（src/bin/version）
  return path.join(root, "hosts/grok/plugins", `${target}-bridge`);
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

/**
 * skill 自举段（bash）：首次调用把插件内引擎复制到 ~/.agent-bridge/engine 与
 * ~/.agent-bridge/bin/agent-bridge-<host>。幂等：engine 携带 version 文件，
 * 与插件内 version 一致即跳过；不一致则整体重装（插件新则覆盖，防更新漂移）。
 * @param {string} host
 * @param {string} target
 */
export function renderBootstrapBlock(host, target) {
  const wrapper = `${ENGINE_TARGET.wrapper}-${host}`;
  const findRoot = BOOTSTRAP_FIND_ROOT[host];
  const engine = ENGINE_TARGET.engine;
  return [
    `# Self-bootstrap: install engine from plugin on first use (idempotent, version-guarded)`,
    `AB_PLUGIN_VERSION="$(find "${findRoot}" -path "*${target}-bridge*" -name version -type f -not -path "*/.git/*" 2>/dev/null | head -n1)"`,
    `if [ -n "$AB_PLUGIN_VERSION" ] && { [ ! -x "${wrapper}" ] || [ "$(cat "${engine}/version" 2>/dev/null)" != "$(cat "$AB_PLUGIN_VERSION")" ]; }; then`,
    `  AB_PLUGIN="$(dirname "$AB_PLUGIN_VERSION")"`,
    `  rm -rf "${engine}" && mkdir -p "${engine}" "$(dirname "${wrapper}")" && \\`,
    `  cp -R "$AB_PLUGIN/src" "${engine}/" && cp "$AB_PLUGIN/package.json" "${engine}/" && cp -R "$AB_PLUGIN/skills-templates" "${engine}/" && \\`,
    `  cp "$AB_PLUGIN/version" "${engine}/version" && cp "$AB_PLUGIN/bin/agent-bridge-${host}" "$(dirname "${wrapper}")/" && \\`,
    `  chmod +x "${wrapper}"`,
    `fi`
  ].join("\n");
}

/**
 * 写插件 payload：src（引擎整树）+ bin/agent-bridge-<host>（静态 wrapper）+
 * version（package version）+ package.json + skills-templates（install-from-engine 用）。
 * @param {string} host
 * @param {string} target
 */
function writePluginPayload(host, target) {
  const dir = pluginRootFor(host, target);
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

  fs.rmSync(path.join(dir, "src"), { recursive: true, force: true });
  fs.cpSync(path.join(root, "src"), path.join(dir, "src"), { recursive: true });

  const binDir = path.join(dir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const body = wrapperBody(
    host,
    `require("node:path").join(require("node:os").homedir(), ".agent-bridge", "engine", "src", "cli.mjs")`,
    { rawExpression: true }
  );
  const bin = path.join(binDir, `agent-bridge-${host}`);
  fs.writeFileSync(bin, body, { mode: 0o755 });
  try {
    fs.chmodSync(bin, 0o755);
  } catch {
    // ignore
  }

  fs.writeFileSync(path.join(dir, "version"), `${version}\n`, "utf8");
  fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
  fs.rmSync(path.join(dir, "skills-templates"), { recursive: true, force: true });
  fs.cpSync(templatesDir, path.join(dir, "skills-templates"), { recursive: true });
}

/**
 * 版本闸门：引擎/模板相对 HEAD 有改动但 package.json version 未 bump 时拒绝生成——
 * 自举只按 version 文件决定是否覆盖引擎，版本不 bump 则用户机器永远跑旧代码。
 */
function assertVersionBumped() {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const headVersion = (() => {
    const r = spawnSync("git", ["show", `HEAD:package.json`], { cwd: root, encoding: "utf8" });
    return r.status === 0 ? JSON.parse(r.stdout).version : null;
  })();
  if (headVersion === null) {
    return; // 非 git 环境（如 npm 打包目录）：跳过闸门
  }
  if (headVersion === version) {
    const dirty = spawnSync("git", ["diff", "--quiet", "HEAD", "--", "src/", "skills-templates/"], { cwd: root });
    if (dirty.status === 1) {
      console.error(
        `[generate-skills] 引擎/模板已修改但 package.json version 仍是 ${version}（HEAD 相同）。\n` +
          `自举的版本闸门不会触发，用户机器上的引擎将停留在旧版。\n` +
          `请先 bump package.json version（如 ${version} → ${version.replace(/(\d+)$/, (n) => String(Number(n) + 1))}）再重新生成。`
      );
      process.exit(1);
    }
  }
}

/**
 * marketplace 清单版本同步：顶层 marketplace.json 与各插件 plugin.json 都
 * 从 package.json 单一来源重写（claude plugin update 按插件清单版本判断最新，
 * 不同步用户永远看不到新版本）。
 */
function syncMarketplaceManifests(version) {
  const manifestPath = path.join(root, ".claude-plugin", "marketplace.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.metadata.version = version;
    for (const plugin of manifest.plugins ?? []) {
      plugin.version = version;
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  // 各插件自身 manifest：hosts/claude/plugins/*/.claude-plugin 与 hosts/codex/plugins/*/.codex-plugin
  for (const host of ["claude", "codex"]) {
    const base = path.join(root, "hosts", host, "plugins");
    for (const name of fs.readdirSync(base)) {
      for (const manifestName of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
        const p = path.join(base, name, manifestName);
        if (!fs.existsSync(p)) {
          continue;
        }
        const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
        if (typeof manifest.version === "string") {
          manifest.version = version;
          fs.writeFileSync(p, `${JSON.stringify(manifest, null, 2)}\n`);
        }
      }
    }
  }
}

function main() {
  const dry = process.argv.includes("--dry-run");
  let count = 0;
  if (!dry) {
    assertVersionBumped();
    syncMarketplaceManifests(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  }

  for (const host of ["codex", "claude", "grok"]) {
    const targets = allowedTargets(/** @type {import("../src/core/ids.mjs").HostId} */ (host));
    // default wrapper path (install may rewrite to absolute realpath)
    const wrapper = `${ENGINE_TARGET.wrapper}-${host}`;

    for (const target of targets) {
      const pluginDir = pluginRootFor(host, target);
      if (!dry) {
        writePluginPayload(host, target);
      } else {
        console.log(`would write plugin ${path.relative(root, pluginDir)}`);
      }
      count += 1;

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
          WRAPPER: wrapper,
          BOOTSTRAP: renderBootstrapBlock(host, target)
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

  console.log(`generate-skills: ${count} artifacts ${dry ? "(dry-run)" : "written"}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
