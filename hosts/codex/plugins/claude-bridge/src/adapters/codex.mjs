import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNoForbiddenFlags } from "../core/safety.mjs";
import { buildTargetEnv } from "../core/env-allowlist.mjs";
import { binaryAvailable, runCommand } from "../core/process.mjs";

export function resolveCodexBin(options = {}) {
  if (options.codexBin) {
    return options.codexBin;
  }
  const env = options.env ?? process.env;
  if (env.AGENT_BRIDGE_CODEX_BIN) {
    return env.AGENT_BRIDGE_CODEX_BIN;
  }
  return discoverCodexBin(env) ?? "codex";
}

function discoverCodexBin(env = process.env) {
  const home = env.HOME || env.USERPROFILE;
  const candidates = [];
  if (home) {
    candidates.push(path.join(home, ".local", "bin", "codex"), path.join(home, ".cargo", "bin", "codex"));
  }
  candidates.push("/opt/homebrew/bin/codex", "/usr/local/bin/codex");
  return (
    candidates.find((c) => {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function capabilities() {
  return {
    plan: "emulated",
    review: "native",
    readOnlyGuarantee: "sandbox",
    headlessZeroInteractive: true,
    transports: ["exec", "exec-review"]
  };
}

/** Align with codex-plugin-cc approvalPolicy: never (via config override). */
export function buildApprovalArgs() {
  return ["-c", 'approval_policy="never"'];
}

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   model?: string,
 *   prompt: string,
 *   cwd: string,
 *   base?: string,
 *   lastMessageFile?: string | null,
 *   attachments?: Array<{ placedPath?: string | null, originalPath?: string | null }>
 * }} options
 */
export function buildCodexArgs(options = {}) {
  const write = Boolean(options.write);
  const kind = options.kind;
  const cwd = options.cwd || process.cwd();
  const approval = buildApprovalArgs();
  const out = options.lastMessageFile ? ["-o", options.lastMessageFile] : [];
  // Codex 原生图片输入：-i <file>（可重复）。带 -i 时 prompt 走 stdin（实测：位置参数不再被当作 prompt）。
  const images = (options.attachments ?? [])
    .map((a) => a.placedPath ?? a.originalPath)
    .filter(Boolean);

  /** @type {string[]} */
  let args;

  if (kind === "review" || kind === "adversarial-review") {
    args = ["exec", "review", "-C", cwd, "--sandbox", "read-only", ...approval, ...out];
    if (options.base) {
      args.push("--base", options.base);
    } else {
      args.push("--uncommitted");
    }
    if (options.prompt) {
      args.push(options.prompt);
    }
  } else {
    const sandbox = write ? "workspace-write" : "read-only";
    args = ["exec", "-C", cwd, "--sandbox", sandbox, ...approval, "--json", ...out];
    if (options.model) {
      args.push("-m", options.model);
    }
    for (const image of images) {
      args.push("-i", image);
    }
    if (images.length === 0) {
      args.push(options.prompt ?? "");
    }
  }

  assertNoForbiddenFlags(args);
  // 只扫 flag 形态 token：prompt 是位置参数，正文含该子串不应误杀
  // （assertNoForbiddenFlags 已对精确的禁用 flag 名全量拦截）
  if (args.some((a) => typeof a === "string" && a.startsWith("-") && a.includes("dangerously-bypass"))) {
    throw new Error("Codex dangerously-bypass is forbidden");
  }
  return args;
}

export async function setup(options = {}) {
  const codexBin = resolveCodexBin(options);
  const version = await binaryAvailable(codexBin, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  return {
    ready: version.available,
    available: version.available,
    bin: codexBin,
    version: version.stdout?.trim() || null,
    auth: { checked: false, loggedIn: null },
    capabilities: capabilities(),
    message: version.available ? "Codex CLI available" : `codex not found: ${codexBin}`,
    note: "If exec fails on auth, run: codex login"
  };
}

function parseCodexOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { text: "", sessionId: null };
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  let last = null;
  for (const line of lines) {
    try {
      last = JSON.parse(line);
    } catch {
      // not jsonl
    }
  }
  if (last) {
    const text = last.message ?? last.text ?? last.content ?? last.result ?? JSON.stringify(last);
    return {
      text: typeof text === "string" ? text : JSON.stringify(text),
      sessionId: last.session_id ?? last.sessionId ?? last.threadId ?? null
    };
  }
  try {
    const obj = JSON.parse(trimmed);
    return {
      text: String(obj.message ?? obj.text ?? obj.result ?? trimmed),
      sessionId: obj.session_id ?? obj.sessionId ?? null
    };
  } catch {
    return { text: trimmed, sessionId: null };
  }
}

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   prompt: string,
 *   cwd: string,
 *   model?: string,
 *   base?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number
 * }} req
 */
export async function runCodex(req) {
  const codexBin = resolveCodexBin({ env: req.env });
  const lastMessageFile = path.join(os.tmpdir(), `agent-bridge-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const args = buildCodexArgs({
    kind: req.kind,
    write: req.write,
    model: req.model,
    prompt: req.prompt,
    cwd: req.cwd,
    base: req.base,
    lastMessageFile,
    attachments: req.attachments
  });
  const env = buildTargetEnv(req.env);

  // -i 模式（图片附件）下 prompt 走 stdin：位置参数不再被当作 prompt（实测）
  const stdin = args.includes("-i") ? req.prompt : undefined;

  const result = await runCommand(codexBin, args, {
    cwd: req.cwd,
    env,
    stdin,
    timeoutMs: req.timeoutMs
  });

  let { text: output, sessionId } = parseCodexOutput(result.stdout);
  try {
    if (fs.existsSync(lastMessageFile)) {
      const last = fs.readFileSync(lastMessageFile, "utf8").trim();
      if (last) {
        output = last;
      }
      fs.unlinkSync(lastMessageFile);
    }
  } catch {
    // ignore
  }

  const ok = result.status === 0 && !result.error && !result.timedOut;
  return {
    ok,
    output,
    rawOutput: result.stdout,
    stderr: result.stderr,
    sessionId,
    args,
    codexBin,
    transport: req.kind === "review" || req.kind === "adversarial-review" ? "exec-review" : "exec",
    error: result.error
      ? result.error.message
      : result.timedOut
        ? "timed out"
        : ok
          ? null
          : "codex failed"
  };
}

export default {
  id: "codex",
  capabilities,
  resolveBin: resolveCodexBin,
  setup,
  buildCodexArgs,
  runCodex
};
