#!/usr/bin/env node
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
