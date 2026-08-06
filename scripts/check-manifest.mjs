#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedTargets } from "../src/core/ids.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} file
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * @param {string} host
 * @param {string[]} pluginNames
 */
function assertNoSelf(host, pluginNames) {
  const selfNames = new Set([
    `${host}-bridge`,
    host,
    `${host}_bridge`
  ]);
  for (const name of pluginNames) {
    const n = name.toLowerCase();
    if (n === `${host}-bridge` || n === host || n.includes(`${host}-bridge`)) {
      // codex host must not have codex-bridge
      if (n.startsWith(host) && n.includes("bridge")) {
        throw new Error(`Self plugin not allowed for host=${host}: ${name}`);
      }
    }
    if (selfNames.has(n)) {
      throw new Error(`Self plugin not allowed for host=${host}: ${name}`);
    }
  }
  // stronger: plugin name must map to allowed target
  const allowed = new Set(allowedTargets(/** @type {import("../src/core/ids.mjs").HostId} */ (host)).map((t) => `${t}-bridge`));
  for (const name of pluginNames) {
    if (!allowed.has(name) && !name.endsWith("-bridge")) {
      // allow only *-bridge pattern for now
      throw new Error(`Unexpected plugin name (want <target>-bridge): ${name}`);
    }
    if (name.endsWith("-bridge") && !allowed.has(name)) {
      throw new Error(`Plugin ${name} not in allowed_targets for host=${host}: ${[...allowed].join(", ")}`);
    }
  }
}

/** 递归收集目录下相对路径（排序），返回 { rels: string[], hashes: Record<rel, sha256> } */
function collectTree(dir) {
  const rels = [];
  const hashes = {};
  if (!fs.existsSync(dir)) {
    return { rels, hashes };
  }
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        rels.push(childRel);
        hashes[childRel] = crypto.createHash("sha256").update(fs.readFileSync(childAbs)).digest("hex");
      }
    }
  }
  rels.sort((a, b) => a.localeCompare(b));
  return { rels, hashes };
}

/**
 * 插件自足断言：src/cli.mjs + bin/agent-bridge-<host> + version + package.json +
 * skills-templates + skills（Grok skills 平铺在 hosts/grok/skills）+ 插件内 src 与根 src
 * 文件清单与哈希一致（防多份引擎副本漂移）+ 生成的 skill 含自举段。
 * @param {string} host
 * @param {string[]} errors
 */
function assertPluginPackaging(host, errors) {
  const version = readJson(path.join(root, "package.json")).version;
  const rootSrc = collectTree(path.join(root, "src"));

  for (const target of allowedTargets(/** @type {import("../src/core/ids.mjs").HostId} */ (host))) {
    const pluginDir = path.join(root, "hosts", host, "plugins", `${target}-bridge`);
    const tag = `host=${host} plugin=${target}-bridge`;

    if (!fs.existsSync(path.join(pluginDir, "src", "cli.mjs"))) {
      errors.push(`${tag}: missing src/cli.mjs`);
    }
    const bin = path.join(pluginDir, "bin", `agent-bridge-${host}`);
    if (!fs.existsSync(bin)) {
      errors.push(`${tag}: missing bin/agent-bridge-${host}`);
    }
    const versionFile = path.join(pluginDir, "version");
    if (!fs.existsSync(versionFile) || fs.readFileSync(versionFile, "utf8").trim() !== version) {
      errors.push(`${tag}: version file != package.json version (${version})`);
    }
    if (!fs.existsSync(path.join(pluginDir, "package.json"))) {
      errors.push(`${tag}: missing package.json (engine self-containment)`);
    }
    for (const tpl of ["plan", "review", "rescue", "result-handling"]) {
      if (!fs.existsSync(path.join(pluginDir, "skills-templates", `${tpl}.md.tpl`))) {
        errors.push(`${tag}: missing skills-templates/${tpl}.md.tpl`);
      }
    }

    // 插件内 src 与根 src 一致性（文件清单 + 哈希）
    const pluginSrc = collectTree(path.join(pluginDir, "src"));
    if (pluginSrc.rels.length !== rootSrc.rels.length) {
      errors.push(`${tag}: src file list differs from root src`);
    } else {
      for (const rel of rootSrc.rels) {
        if (pluginSrc.hashes[rel] !== rootSrc.hashes[rel]) {
          errors.push(`${tag}: src/${rel} content differs from root src`);
        }
      }
    }

    // skills 位置：grok 平铺，其余在插件内
    const skillsRoot = host === "grok" ? path.join(root, "hosts", "grok", "skills") : path.join(pluginDir, "skills");
    for (const kind of ["plan", "review", "rescue", "result-handling"]) {
      const skill = path.join(skillsRoot, `${target}-${kind}`, "SKILL.md");
      if (!fs.existsSync(skill)) {
        errors.push(`${tag}: missing skill ${target}-${kind}`);
      } else {
        const content = fs.readFileSync(skill, "utf8");
        if (!content.includes("# Self-bootstrap")) {
          errors.push(`${tag}: skill ${target}-${kind} missing self-bootstrap block (re-run generate-skills)`);
        }
        if (!content.includes(`agent-bridge-${host}`)) {
          errors.push(`${tag}: skill ${target}-${kind} missing host wrapper reference`);
        }
      }
    }
  }
}

function main() {
  const errors = [];

  const codexMp = path.join(root, ".agents/plugins/marketplace.json");
  if (!fs.existsSync(codexMp)) {
    errors.push(`missing ${codexMp}`);
  } else {
    const mp = readJson(codexMp);
    const names = (mp.plugins ?? []).map((p) => p.name);
    try {
      assertNoSelf("codex", names);
    } catch (e) {
      errors.push(String(e instanceof Error ? e.message : e));
    }
  }

  const claudeMp = path.join(root, ".claude-plugin/marketplace.json");
  if (!fs.existsSync(claudeMp)) {
    errors.push(`missing ${claudeMp}`);
  } else {
    const mp = readJson(claudeMp);
    const names = (mp.plugins ?? []).map((p) => p.name);
    try {
      assertNoSelf("claude", names);
    } catch (e) {
      errors.push(String(e instanceof Error ? e.message : e));
    }
  }

  const grokMarker = path.join(root, "hosts/grok/README.md");
  if (!fs.existsSync(grokMarker)) {
    errors.push(`missing ${grokMarker}`);
  }

  for (const host of ["codex", "claude", "grok"]) {
    assertPluginPackaging(host, errors);
  }

  // forbid bare flags in skill stubs if any
  // (phase 0 may have empty skills)

  if (errors.length) {
    console.error("check-manifest FAILED:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }
  console.log("check-manifest OK");
}

main();
