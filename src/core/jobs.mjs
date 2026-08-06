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

function writeJsonAtomic(p, value) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, p);
}

/**
 * @param {Record<string, unknown>} index
 * @param {NodeJS.ProcessEnv} [env]
 */
export function writeJobIndex(index, env = process.env) {
  const p = jobIndexPath(env);
  ensureDir(path.dirname(p));
  writeJsonAtomic(p, index);
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
 * 扫描 $STATE 下 <host>/<target>/<hash>/jobs/<id>.json（目录名精确为 "jobs"），命中返回 {meta, path}
 */
function scanJobFile(jobId, env) {
  const root = stateRoot(env);
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile() && entry.name === `${jobId}.json` && path.basename(path.dirname(p)) === "jobs") {
        const rel = path.relative(root, p).split(path.sep); // [host, target, hash, "jobs", "<id>.json"]
        return { meta: { host: rel[0], target: rel[1], workspaceHash: rel[2], path: p }, path: p };
      }
    }
  }
  return null;
}

/**
 * @param {string} jobId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function lookupJob(jobId, env = process.env) {
  const index = readJobIndex(env);
  let hit = index[jobId];
  if (!hit || !fs.existsSync(hit.path)) {
    const scanned = scanJobFile(jobId, env);
    if (!scanned) {
      return hit ? { ...hit, missing: true } : null;
    }
    hit = scanned.meta;
    registerJob({ id: jobId, ...hit, jobFile: hit.path, env }); // 回写索引，下次 O(1)
  }
  try {
    const job = JSON.parse(fs.readFileSync(hit.path, "utf8"));
    return { meta: hit, job };
  } catch {
    return { ...hit, corrupt: true };
  }
}

/**
 * 扫描 state 树收集全部 job（损坏文件跳过）。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<{ jobId: string, host: string, target: string, workspaceHash: string, summary: string | null, completedAt: string | null, path: string }>}
 */
export function listJobs(env = process.env) {
  const root = stateRoot(env);
  const jobs = [];
  if (!fs.existsSync(root)) return jobs;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile() && entry.name.endsWith(".json") && path.basename(path.dirname(p)) === "jobs") {
        try {
          const job = JSON.parse(fs.readFileSync(p, "utf8"));
          const rel = path.relative(root, p).split(path.sep); // [host, target, hash, "jobs", "<id>.json"]
          jobs.push({
            jobId: String(job.id ?? entry.name.replace(/\.json$/, "")),
            host: String(job.host ?? rel[0] ?? "unknown"),
            target: String(job.target ?? rel[1] ?? "unknown"),
            workspaceHash: rel[2] ?? "unknown",
            summary: job.summary ?? null,
            completedAt: job.completedAt ?? null,
            path: p
          });
        } catch {
          // 跳过损坏 job 文件
        }
      }
    }
  }
  return jobs.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function stateReport(env = process.env) {
  const jobs = listJobs(env);
  const counts = new Map();
  let totalBytes = 0;
  for (const j of jobs) {
    totalBytes += fs.statSync(j.path, { throwIfNoEntry: false })?.size ?? 0;
    const bucket = `${j.host}/${j.target}`;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return {
    stateRoot: stateRoot(env),
    jobCount: jobs.length,
    totalBytes,
    buckets: [...counts.entries()].map(([bucket, count]) => ({ bucket, count })).sort((a, b) => a.bucket.localeCompare(b.bucket))
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ host?: string | null, target?: string | null, all?: boolean }} opts
 */
export function cleanupJobs(env = process.env, opts = {}) {
  const { host = null, target = null, all = false } = opts;
  if (!all && !host && !target) {
    throw new Error("cleanup requires --all or --host/--target scope");
  }
  const jobs = listJobs(env);
  let deleted = 0;
  for (const j of jobs) {
    if (host && j.host !== host) continue;
    if (target && j.target !== target) continue;
    fs.rmSync(j.path, { force: true });
    deleted += 1;
  }
  // 重建索引，清掉孤儿条目
  const index = {};
  for (const j of listJobs(env)) {
    index[j.jobId] = { host: j.host, target: j.target, workspaceHash: j.workspaceHash, path: j.path };
  }
  writeJobIndex(index, env);
  return { deleted, remaining: Object.keys(index).length };
}
