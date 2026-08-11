import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNoForbiddenFlags } from "../core/safety.mjs";
import { buildTargetEnv } from "../core/env-allowlist.mjs";
import { binaryAvailable, runCommand } from "../core/process.mjs";
import { compareFingerprints, diffDirFiles, gitFingerprint, snapshotDirFiles } from "../core/write-probe.mjs";
import {
  collectGitTouchedFiles,
  isolationMetadata,
  prepareIsolatedWorkspace,
  prepareWriteWorktree,
  removeIsolatedWorkspace,
  worktreeMetadata
} from "../core/workspace-isolation.mjs";

export function resolveAgyBin(options = {}) {
  if (options.agyBin) {
    return options.agyBin;
  }
  const env = options.env ?? process.env;
  if (env.AGENT_BRIDGE_ANTIGRAVITY_BIN || env.ANTIGRAVITY_COMPANION_AGY_BIN) {
    return env.AGENT_BRIDGE_ANTIGRAVITY_BIN || env.ANTIGRAVITY_COMPANION_AGY_BIN;
  }
  return discoverAgyBin(env) ?? "agy";
}

function discoverAgyBin(env = process.env) {
  return commonAgyBinCandidates(env).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function commonAgyBinCandidates(env = process.env) {
  const candidates = [];
  const home = env.HOME || env.USERPROFILE;
  if (home) {
    candidates.push(path.join(home, ".local", "bin", "agy"));
  }
  candidates.push("/opt/homebrew/bin/agy", "/usr/local/bin/agy");
  return [...new Set(candidates)];
}

export function capabilities() {
  return {
    plan: "emulated",
    review: "emulated",
    readOnlyGuarantee: "isolation+probe",
    headlessZeroInteractive: true,
    transports: ["agy-print"],
    modelIgnored: true // 用户决定：不传 --model；早期"--model 吞 prompt"结论系 argv 顺序误判（-p 取值 flag 吞掉后随 token），已修（786a236）
  };
}

/**
 * @param {{ kind?: string, write?: boolean, printTimeout?: string, prompt: string }} options
 * 注意：不接受 model——用户决定不传 --model（早期误判为 CLI bug，实为 argv 顺序问题，
 * 已修 786a236）；模型跟随 agy settings.json 的默认配置。
 * prompt 必须是 -p 的值（紧跟其后），放在 flag 之前——放后面会被 -p 吞掉（CLI bug）。
 * 官方 headless 规范（antigravity.google/docs/cli/headless）：
 * - --output-format json 返回信封（response/status/error/usage）
 * - kind=plan 用 --mode plan（只读调查 + 执行提纲）
 * - --print-timeout 默认 5m，自动化建议 15m
 */
export function buildAgyArgs(options = {}) {
  const args = ["-p", options.prompt ?? ""];
  if (!options.write) {
    args.push("--sandbox");
  }
  if (options.kind === "plan") {
    args.push("--mode", "plan");
  }
  args.push("--print-timeout", options.printTimeout ?? "15m");
  args.push("--output-format", "json");
  // prompt 是 -p 的值（index 1），不是 flag——只检查其余位置
  assertNoForbiddenFlags([...args.slice(0, 1), ...args.slice(2)]);
  return args;
}

export async function setup(options = {}) {
  const agyBin = resolveAgyBin(options);
  const version = await binaryAvailable(agyBin, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  return {
    ready: version.available,
    available: version.available,
    bin: agyBin,
    version: version.stdout?.trim() || null,
    auth: { checked: false, required: false, loggedIn: null },
    capabilities: capabilities(),
    message: version.available ? "Antigravity CLI available" : `agy not found: ${agyBin}`
  };
}

function parseAgyJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // continue
      }
    }
  }
  return null;
}

function detectAgyRuntimeError(result) {
  if (result.status !== 0 || result.error) {
    return null;
  }
  const combined = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const patterns = [/authentication timed out/i, /please sign in/i, /not authenticated/i, /oauth.*timed out/i];
  const matched = patterns.find((p) => p.test(combined));
  return matched ? combined.match(matched)?.[0] ?? "Antigravity runtime error" : null;
}

function summarizeAgyResult(result) {
  const runtimeError = detectAgyRuntimeError(result);
  const parsed = parseAgyJson(result.stdout);
  const envelopeError =
    parsed && parsed.status && parsed.status !== "SUCCESS" ? String(parsed.error ?? parsed.status) : null;
  const output =
    typeof parsed?.response === "string" ? parsed.response
    : parsed?.result ?? parsed?.output ?? parsed?.text ?? result.stdout;
  return {
    runtimeError,
    envelopeError,
    output,
    sessionId: parsed?.conversation_id ?? parsed?.session_id ?? parsed?.sessionId ?? null,
    usage: parsed?.usage ?? null
  };
}

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   prompt: string,
 *   cwd: string,
 *   model?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   attachments?: Array<{ name: string, originalPath: string, size: number }>
 * }} req
 */
export async function runAntigravity(req) {
  const write = Boolean(req.write);
  const agyBin = resolveAgyBin({ env: req.env });
  const printTimeout = req.timeoutMs ? `${Math.ceil(req.timeoutMs / 60000)}m` : undefined;
  const env = buildTargetEnv(req.env);

  if (write) {
    if (req.resume) {
      throw new Error(
        "Antigravity read-only→write: use --write without --resume for a fresh write-capable run"
      );
    }
    // Write is an authorized path: run in a git worktree so the main
    // workspace is not polluted. Changes stay in the worktree/branch for
    // review; no auto commit/push, no auto cleanup. Non-git dirs fall back
    // to running directly in the real workspace.
    const worktree = await prepareWriteWorktree(req.cwd, { env });
    const runCwd = worktree ? worktree.worktreeCwd : req.cwd;
    // ⚠️ 实测：flash 模型看到"worktree/review"前缀 prompt 会空响应不写（3/3 复现）；
    // 裸用户 prompt 可靠完成（写到 agy 自己的 scratch），产出由下方 scratch 搬移机制归位到 worktree。
    const writePrompt = req.prompt;
    const args = buildAgyArgs({ write: true, kind: req.kind, prompt: writePrompt, printTimeout });

    // agy headless 无工作区绑定：模型裸调用可靠地把产出写进自己的默认工作区
    // （~/.gemini/antigravity-cli/scratch）。桥在运行前后对比 scratch，
    // 把本次新增的文件搬进 worktree——产出归位，审计可见。
    const scratchDir =
      env.AGENT_BRIDGE_ANTIGRAVITY_SCRATCH || path.join(os.homedir(), ".gemini", "antigravity-cli", "scratch");
    const scratchBefore = new Set();
    if (fs.existsSync(scratchDir)) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(p);
          } else if (entry.isFile()) {
            scratchBefore.add(p);
          }
        }
      };
      walk(scratchDir);
    }
    // 非 git fallback：模型可能直接写 req.cwd（而非 scratch）——运行前后文件清单快照检测直接写。
    // ⚠️ 必须在 runCommand 之前拍 before（否则模型已写，diff 恒空）。
    const workspaceBefore = worktree ? null : snapshotDirFiles(req.cwd);
    // 主仓库双审计：worktree 存在时，模型仍可能绕过隔离直接改主仓库（实测发生）——
    // 运行前后对比主仓库 git 状态，被改动则如实报告 isolationBypassed，而不是误报零产出。
    const mainRepoBefore = worktree ? await gitFingerprint(req.cwd, env) : null;
    const relocateTarget = worktree ? worktree.worktreePath : req.cwd;

    // 中断恢复标记：写任务运行前在 scratch 落 marker（记录目标目录），完成后删除。
    // 若进程被杀，marker 留存 → doctor 扫描过期 marker 报告滞留产出，用户可找回。
    const markerPath = path.join(scratchDir, `.agent-bridge-run-${Date.now()}.marker`);
    try {
      fs.mkdirSync(scratchDir, { recursive: true });
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ targetDir: relocateTarget, startedAt: new Date().toISOString() }),
        "utf8"
      );
    } catch {
      // marker 写失败不阻塞运行
    }

    const result = await runCommand(agyBin, args, {
      cwd: runCwd,
      env,
      timeoutMs: req.timeoutMs
    });
    const summary = summarizeAgyResult(result);

    // 搬移 scratch 新增文件 → worktree（或 fallback 真实目录），保持相对路径
    const relocated = [];
    if (fs.existsSync(scratchDir)) {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(p);
          } else if (entry.isFile() && !scratchBefore.has(p) && !entry.name.startsWith(".agent-bridge-run-")) {
            const rel = path.relative(scratchDir, p);
            const dest = path.join(relocateTarget, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            try {
              fs.copyFileSync(p, dest);
              fs.unlinkSync(p);
              relocated.push(rel);
            } catch {
              // 搬移失败不阻塞：保留在 scratch，审计按实际可见为准
            }
          }
        }
      };
      walk(scratchDir);
    }
    const workspaceChanges = worktree ? [] : diffDirFiles(workspaceBefore, req.cwd);
    // 主仓库被绕过的改动（模型直接写了主仓库）
    const mainWorkspaceChanges = worktree && mainRepoBefore?.git ? compareFingerprints({ before: mainRepoBefore, after: await gitFingerprint(req.cwd, env) }).touchedFiles ?? [] : [];
    try {
      fs.rmSync(markerPath, { force: true }); // 正常完成：移除中断恢复标记
    } catch {
      // 忽略
    }

    const touchedFiles = worktree
      ? await collectGitTouchedFiles(worktree.worktreePath, { env })
      : workspaceChanges;
    const ok =
      result.status === 0 && !result.error && !result.timedOut && !summary.runtimeError && !summary.envelopeError;
    return {
      ok,
      output: summary.output,
      rawOutput: result.stdout,
      stderr: result.stderr,
      sessionId: summary.sessionId,
      args,
      agyBin,
      isolation: worktree ? worktreeMetadata(worktree, touchedFiles) : null,
      worktree: worktree
        ? { path: worktree.worktreePath, branch: worktree.branch, cwd: worktree.worktreeCwd }
        : null,
      touchedFiles,
      relocated,
      mainWorkspaceChanges,
      usage: summary.usage,
      error:
        summary.envelopeError ||
        summary.runtimeError ||
        (result.error ? result.error.message : result.timedOut ? "timed out" : null)
    };
  }

  // read-only: isolation + sandbox + touchedFiles probe
  // 附件在 prepareIsolatedWorkspace 里于基线提交前落位（随快照删除）
  const isolation = await prepareIsolatedWorkspace(req.cwd, {
    env,
    attachments: req.attachments
  });
  try {
    const attachLines = (isolation.attachments ?? []).map(
      (a) => `- Attachment: ${a.originalPath} -> ${a.placedPath}`
    );
    let userPrompt = req.prompt;
    for (const a of isolation.attachments ?? []) {
      userPrompt = userPrompt.split(a.originalPath).join(a.placedPath);
    }
    const isolatedPrompt = [
      "AgentBridge Antigravity safety context:",
      `- Original workspace: ${isolation.originalCwd}`,
      `- Execution workspace: ${isolation.isolatedCwd}`,
      "- Disposable snapshot; analysis only. Do not edit files.",
      ...attachLines,
      "",
      userPrompt
    ].join("\n");
    const args = buildAgyArgs({ write: false, kind: req.kind, prompt: isolatedPrompt, printTimeout });
    const result = await runCommand(agyBin, args, {
      cwd: isolation.isolatedCwd,
      env,
      timeoutMs: req.timeoutMs
    });
    const touchedFiles = await collectGitTouchedFiles(isolation.snapshotRoot, {
      env,
      includeIgnored: true
    });
    const summary = summarizeAgyResult(result);
    const probeFail = touchedFiles.length > 0;
    const ok =
      result.status === 0 && !result.error && !result.timedOut && !summary.runtimeError && !summary.envelopeError && !probeFail;
    return {
      ok,
      output: summary.output,
      rawOutput: result.stdout,
      stderr: result.stderr,
      sessionId: summary.sessionId,
      args,
      agyBin,
      isolation: isolationMetadata(isolation, {
        touchedFiles,
        readOnlyViolation: probeFail
      }),
      touchedFiles,
      usage: summary.usage,
      error: probeFail
        ? `Antigravity modified isolated workspace: ${touchedFiles.join(", ")}`
        : summary.envelopeError ||
          summary.runtimeError ||
          (result.error ? result.error.message : result.timedOut ? "timed out" : null)
    };
  } finally {
    await removeIsolatedWorkspace(isolation);
  }
}

export default {
  id: "antigravity",
  capabilities,
  resolveBin: resolveAgyBin,
  setup,
  buildAgyArgs,
  runAntigravity
};
