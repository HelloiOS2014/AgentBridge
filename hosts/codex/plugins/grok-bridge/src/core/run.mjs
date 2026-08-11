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
  // 写任务预落 running 记录（前台也写）：进程中断后 status 可查、产出可定位。
  // --worker 路径的父进程已写，跳过避免双写。
  const id = req.jobId ?? newJobId();
  if (req.command === "rescue" && Boolean(req.write) && !req.jobId) {
    persistJob(
      {
        id,
        status: "running",
        kind,
        target,
        host,
        jobId: id,
        startedAt: new Date().toISOString(),
        summary: "running (write)"
      },
      { host, target, cwd, env }
    );
  }

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
  // write 任务也采集 before——供"零产出检测"（目标声称完成但工作区无变化）。
  const probeWorkspace = target !== "antigravity";
  const useWorkspaceProbe = !write && probeWorkspace;
  const before = probeWorkspace ? await gitFingerprint(cwd, env) : null;

  // 写任务重试：目标模型（尤其 agy flash）时常"一轮即停/零产出"，重试显著提高完成率。
  // worktree/工作区在尝试间保留，进度可累积；最多 3 次，每次失败原因如实保留在最后一次结果。
  const MAX_WRITE_ATTEMPTS = write ? 3 : 1;
  let result;
  let probe = null;
  let noOutput = false;
  let failedProbe = false;
  // write 任务也采集前后指纹：仅用于"零产出检测"（目标声称完成但工作区无任何变化），不判违规
  const writeOutputProbe = write && target !== "antigravity" && before !== null;
  const isolationViolation = () =>
    target === "antigravity" && !write && (result.touchedFiles?.length ?? 0) > 0;

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      result = await RUNNERS[target]({
        kind,
        write,
        prompt: promptOut,
        cwd,
        model: req.model,
        env: req.env, // 显式层直通；无 env 的调用者（CLI 路径）由 adapter 按 allowlist 过滤继承层
        // codex 等原生图片输入需要放置后的绝对路径（-i）；antigravity 快照附件由 adapter 内处理
        attachments: placed.length ? placed : snapshotAttachments.length ? snapshotAttachments : undefined
      });

      if (useWorkspaceProbe && before) {
        const after = await gitFingerprint(cwd, env);
        probe = compareFingerprints({ before, after });
      }
      if (writeOutputProbe) {
        const after = await gitFingerprint(cwd, env);
        probe = { ...compareFingerprints({ before, after }), writeOutput: true };
      }

      // write 探针只用于零产出检测，"有变化"是正常产出，不构成只读违规
      failedProbe = (!write && probe && !probe.ok && !probe.skipped) || isolationViolation();
      // 零产出：write 任务工作区无任何变化（目标只口头声称）——如实标记，不当作成功。
      // antigravity write 走 worktree 审计（result.touchedFiles），过滤桥自己的附件暂存文件。
      noOutput =
        (writeOutputProbe && probe !== null && probe.ok && !probe.skipped) ||
        // antigravity write：git 走 worktree 审计；非 git fallback 走 scratch 搬移数 + 文件清单快照
        (write &&
          target === "antigravity" &&
          (result.worktree
            ? (result.touchedFiles ?? []).filter((f) => !String(f).includes("agent-bridge-attach-")).length === 0
            : (result.relocated ?? []).length === 0 && (result.touchedFiles ?? []).length === 0));

      // 有产出或非零产出失败 → 不再重试；仅零产出（模型声称完成但没写）值得再来一次
      if (!noOutput) {
        break;
      }
    } finally {
      // 只读任务：委派后删除（失败也删）；write 任务保留（是产出）
      if (!write && placed.length) {
        removeWorkspaceAttachments(placed);
      }
    }
  }

  const status = result.ok && !failedProbe && !noOutput ? "completed" : "failed";
  const caps = adapter.capabilities();
  // --worker 固定 jobId：persistJob 覆盖父进程写的 running 记录（同 id 同文件）

  const payload = {
    status,
    kind,
    target,
    host,
    jobId: id,
    summary: failedProbe
      ? `Read-only violation: ${(result.touchedFiles || probe?.touchedFiles || []).join(", ")}`
      : noOutput
        ? `零产出：目标声称完成但工作区无任何变化 — ${String(result.output).slice(0, 160)}`
        : result.ok
          ? String(result.output).slice(0, 240)
          : result.error || `${target} failed`,
    noOutput: noOutput || undefined,
    rendered: result.output,
    rawOutput: result.rawOutput,
    sessionId: result.sessionId,
    write,
    touchedFiles: result.touchedFiles ?? probe?.touchedFiles ?? [],
    relocated: result.relocated ?? undefined,
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
      : noOutput
        ? "no_output"
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
