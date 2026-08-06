import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ADAPTERS, RUNNERS } from "../adapters/index.mjs";
import {
  attachmentPromptNote,
  placeWorkspaceAttachments,
  removeWorkspaceAttachments,
  resolveAttachments,
  rewritePromptPaths
} from "./attachments.mjs";
import { collectReviewContext } from "./git-context.mjs";
import { newJobId, pruneExpiredJobs, registerJob } from "./jobs.mjs";
import { ensureDir, stateRoot } from "./paths.mjs";
import { composePlanPrompt, composeRescuePrompt, composeReviewPrompt } from "./prompts.mjs";
import { compareFingerprints, gitFingerprint } from "./write-probe.mjs";

/**
 * @param {string} cwd
 */
function workspaceHash(cwd) {
  const real = fs.existsSync(cwd) ? fs.realpathSync.native(cwd) : path.resolve(cwd);
  return crypto.createHash("sha256").update(real).digest("hex").slice(0, 12);
}

/**
 * @param {{ host: string, target: string, cwd: string, env?: NodeJS.ProcessEnv }} opts
 */
export function jobDir(opts) {
  const env = opts.env ?? process.env;
  const hash = workspaceHash(opts.cwd);
  return path.join(stateRoot(env), opts.host || "unknown", opts.target, hash, "jobs");
}

/**
 * @param {object} job
 * @param {object} opts
 */
export function persistJob(job, opts) {
  const env = opts.env ?? process.env;
  const dir = jobDir(opts);
  ensureDir(dir);
  pruneExpiredJobs(env); // 机会式 TTL 清理（跳过 running）
  const jobFile = path.join(dir, `${job.id}.json`);
  fs.writeFileSync(jobFile, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  registerJob({
    id: job.id,
    host: opts.host || "unknown",
    target: opts.target,
    workspaceHash: workspaceHash(opts.cwd),
    jobFile,
    env: opts.env
  });
  return jobFile;
}

/**
 * @param {{
 *   host: string | null,
 *   target: string,
 *   command: string,
 *   prompt?: string,
 *   write?: boolean,
 *   cwd?: string,
 *   model?: string,
 *   background?: boolean,
 *   attachments?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   jobId?: string
 * }} req
 */
export async function runDelegation(req) {
  const cwd = path.resolve(req.cwd || process.cwd());
  const env = req.env ?? process.env;
  const host = req.host || "unknown";
  const kind = req.command === "adversarial-review" ? "adversarial-review" : req.command;
  const target = req.target;
  const adapter = ADAPTERS[target];

  if (!adapter) {
    return {
      status: "failed",
      kind,
      target,
      host,
      errorCode: "not_implemented",
      errorMessage: `Adapter not implemented for target=${target}`,
      summary: "adapter_pending"
    };
  }

  if (kind === "setup") {
    const setup = await adapter.setup({ cwd, env });
    return {
      status: setup.ready ? "completed" : "failed",
      kind: "setup",
      target,
      host,
      summary: setup.message,
      ready: setup.ready,
      setup,
      capabilities: setup.capabilities ?? adapter.capabilities(),
      errorCode: setup.ready ? null : "not_ready",
      errorMessage: setup.ready ? null : setup.message
    };
  }

  const promptText = (req.prompt ?? "").trim();
  if (!promptText && kind !== "review") {
    return {
      status: "failed",
      kind,
      target,
      host,
      errorCode: "usage",
      errorMessage: "Prompt required",
      summary: "missing prompt"
    };
  }

  let precollectedContext = "";
  let reviewMeta = null;
  if (kind === "review" || kind === "adversarial-review") {
    const context = await collectReviewContext(cwd, { scope: "auto" });
    precollectedContext = context.content ?? "";
    reviewMeta = {
      changedFiles: context.changedFiles,
      baseline: context.baseline,
      truncated: context.truncated,
      isGitRepository: context.isGitRepository
    };
  }

  let prompt;
  if (kind === "plan") {
    prompt = composePlanPrompt(promptText);
  } else if (kind === "review") {
    prompt = composeReviewPrompt(precollectedContext, false, promptText);
  } else if (kind === "adversarial-review") {
    prompt = composeReviewPrompt(precollectedContext, true, promptText);
  } else if (kind === "rescue") {
    prompt = composeRescuePrompt(promptText, Boolean(req.write));
  } else {
    return {
      status: "failed",
      kind,
      errorCode: "usage",
      errorMessage: `Unknown kind ${kind}`
    };
  }

  const write = kind === "rescue" && Boolean(req.write);

  // 附件：antigravity 只读 → 由 adapter 放进隔离快照（随快照删除）；
  // 其余（含 antigravity --write）→ 复制进真实工作区 untracked 区。
  let attachments = [];
  try {
    attachments = resolveAttachments(req.attachments ?? [], env);
  } catch (error) {
    return {
      status: "failed",
      kind,
      target,
      host,
      errorCode: "usage",
      errorMessage: error instanceof Error ? error.message : String(error),
      summary: "invalid attachment"
    };
  }
  const snapshotAttachments = target === "antigravity" && !write ? attachments : [];
  const workspaceAttachments = snapshotAttachments.length ? [] : attachments;

  // WriteProbe 顺序约束：附件放置必须在 gitFingerprint(before) 之前、
  // 附件清理必须在 gitFingerprint(after) 之后（防止附件本身被记成篡改）。
  let placed = [];
  let promptOut = prompt;
  if (workspaceAttachments.length) {
    placed = placeWorkspaceAttachments(workspaceAttachments, cwd);
    promptOut = rewritePromptPaths(prompt, placed);
    promptOut += attachmentPromptNote(placed);
  }

  // Workspace WriteProbe for tool/sandbox targets; Antigravity uses isolation probe inside adapter.
  const useWorkspaceProbe = !write && target !== "antigravity";
  const before = useWorkspaceProbe ? await gitFingerprint(cwd, env) : null;

  let result;
  let probe = null;
  try {
    result = await RUNNERS[target]({
      kind,
      write,
      prompt: promptOut,
      cwd,
      model: req.model,
      env: req.env, // 显式层直通；无 env 的调用者（CLI 路径）由 adapter 按 allowlist 过滤继承层
      attachments: snapshotAttachments.length ? snapshotAttachments : undefined
    });

    if (useWorkspaceProbe && before) {
      const after = await gitFingerprint(cwd, env);
      probe = compareFingerprints({ before, after });
    }
  } finally {
    // 只读任务：委派后删除（失败也删）；write 任务保留（是产出）
    if (!write && placed.length) {
      removeWorkspaceAttachments(placed);
    }
  }

  const isolationViolation = target === "antigravity" && !write && (result.touchedFiles?.length ?? 0) > 0;
  const failedProbe = (probe && !probe.ok && !probe.skipped) || isolationViolation;
  const status = result.ok && !failedProbe ? "completed" : "failed";
  const caps = adapter.capabilities();
  // --worker 固定 jobId：persistJob 覆盖父进程写的 running 记录（同 id 同文件）
  const id = req.jobId ?? newJobId();

  const payload = {
    status,
    kind,
    target,
    host,
    jobId: id,
    summary: failedProbe
      ? `Read-only violation: ${(result.touchedFiles || probe?.touchedFiles || []).join(", ")}`
      : result.ok
        ? String(result.output).slice(0, 240)
        : result.error || `${target} failed`,
    rendered: result.output,
    rawOutput: result.rawOutput,
    sessionId: result.sessionId,
    write,
    touchedFiles: result.touchedFiles ?? probe?.touchedFiles ?? [],
    worktree: result.worktree ?? null,
    capabilities: caps,
    metadata: {
      host,
      cwd,
      readOnlyLevel: caps.readOnlyGuarantee,
      codexTransport: result.transport ?? null,
      args: result.args,
      review: reviewMeta,
      isolation: result.isolation ?? null,
      attachments: attachments.map((a, i) => ({
        name: a.name,
        originalPath: a.originalPath,
        size: a.size,
        placedPath:
          result.isolation?.antigravityIsolation?.attachments?.[i]?.placedPath ??
          placed[i]?.placedPath ??
          null
      })),
      // 落盘/返回层如实反映：截断只在展示层（cli.mjs emit/result）发生
      storage: { truncated: false, truncatedFields: [], omittedBytes: 0 }
    },
    errorCode: failedProbe
      ? "write_probe_failed"
      : result.ok
        ? null
        : `${target}_failed`,
    errorMessage: failedProbe
      ? "Read-only command modified the workspace (or isolation snapshot)"
      : result.error
  };

  persistJob(
    {
      id,
      ...payload,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    },
    { host, target, cwd, env }
  );

  return payload;
}
