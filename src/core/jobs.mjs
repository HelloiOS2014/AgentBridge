import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, stateRoot } from "./paths.mjs";

/**
 * @returns {string}
 */
export function newJobId() {
  return crypto.randomUUID();
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function jobIndexPath(env = process.env) {
  return path.join(stateRoot(env), "job-index.json");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, { host: string, target: string, workspaceHash: string, path: string }>}
 */
export function readJobIndex(env = process.env) {
  const p = jobIndexPath(env);
  if (!fs.existsSync(p)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} index
 * @param {NodeJS.ProcessEnv} [env]
 */
export function writeJobIndex(index, env = process.env) {
  const p = jobIndexPath(env);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/**
 * @param {{
 *   id: string,
 *   host: string,
 *   target: string,
 *   workspaceHash: string,
 *   jobFile: string,
 *   env?: NodeJS.ProcessEnv
 * }} entry
 */
export function registerJob(entry) {
  const env = entry.env ?? process.env;
  const index = readJobIndex(env);
  index[entry.id] = {
    host: entry.host,
    target: entry.target,
    workspaceHash: entry.workspaceHash,
    path: entry.jobFile
  };
  writeJobIndex(index, env);
}

/**
 * @param {string} jobId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function lookupJob(jobId, env = process.env) {
  const index = readJobIndex(env);
  const hit = index[jobId];
  if (!hit) {
    return null;
  }
  if (!fs.existsSync(hit.path)) {
    return { ...hit, missing: true };
  }
  const job = JSON.parse(fs.readFileSync(hit.path, "utf8"));
  return { meta: hit, job };
}
