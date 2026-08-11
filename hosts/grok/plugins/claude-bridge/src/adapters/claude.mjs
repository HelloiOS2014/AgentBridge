import fs from "node:fs";
import path from "node:path";
import { assertNoForbiddenFlags } from "../core/safety.mjs";
import { buildTargetEnv } from "../core/env-allowlist.mjs";
import { binaryAvailable, runCommand } from "../core/process.mjs";

const TOOL_PROFILES = {
  none: "",
  read: "Read,Glob,Grep",
  write: "Read,Glob,Grep,Edit,MultiEdit,Write"
};

export function resolveClaudeBin(options = {}) {
  if (options.claudeBin) {
    return options.claudeBin;
  }
  const env = options.env ?? process.env;
  if (env.AGENT_BRIDGE_CLAUDE_BIN || env.CLAUDE_COMPANION_CLAUDE_BIN) {
    return env.AGENT_BRIDGE_CLAUDE_BIN || env.CLAUDE_COMPANION_CLAUDE_BIN;
  }
  return discoverClaudeBin(env) ?? "claude";
}

function discoverClaudeBin(env = process.env) {
  return commonClaudeBinCandidates(env).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function commonClaudeBinCandidates(env = process.env) {
  const candidates = [];
  const home = env.HOME || env.USERPROFILE;
  if (home) {
    candidates.push(path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude"));
  }
  candidates.push("/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  return [...new Set(candidates)];
}

export function buildToolArgs(profile = "none") {
  if (!Object.hasOwn(TOOL_PROFILES, profile)) {
    throw new Error(`Unknown Claude tool profile: ${profile}`);
  }
  return ["--tools", TOOL_PROFILES[profile]];
}

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   model?: string,
 *   effort?: string,
 *   permissionMode?: string
 * }} req
 */
export function toolProfileForKind(req) {
  if (req.kind === "review" || req.kind === "adversarial-review") {
    return "none";
  }
  if (req.kind === "rescue" && req.write) {
    return "write";
  }
  return "read";
}

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   model?: string,
 *   effort?: string,
 *   permissionMode?: string,
 *   toolProfile?: string
 * }} options
 */
export function buildClaudeArgs(options = {}) {
  const toolProfile = options.toolProfile ?? toolProfileForKind(options);
  const args = ["-p", "--output-format", options.outputFormat ?? "json", ...buildToolArgs(toolProfile)];

  const permissionMode =
    options.permissionMode ??
    (options.kind === "rescue" && options.write
      ? "acceptEdits" // write rescue：dontAsk 会拒绝 Write/Edit 工具调用（实测），acceptEdits 自动批准编辑
      : options.kind === "plan" || options.kind === "rescue" || !options.kind
        ? "dontAsk"
        : undefined);
  // review with no tools: still set dontAsk for zero-interactive
  const mode = permissionMode ?? "dontAsk";
  args.push("--permission-mode", mode);

  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }

  assertNoForbiddenFlags(args);
  return args;
}

export function capabilities() {
  return {
    plan: "emulated",
    review: "precollect",
    readOnlyGuarantee: "tool-profile",
    headlessZeroInteractive: true,
    transports: ["claude-print"]
  };
}

export async function setup(options = {}) {
  const claudeBin = resolveClaudeBin(options);
  const version = await binaryAvailable(claudeBin, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  const status = {
    ready: false,
    available: version.available,
    bin: claudeBin,
    version: version.stdout?.trim() || null,
    auth: { checked: false, loggedIn: false, error: null },
    capabilities: capabilities()
  };
  if (!version.available) {
    status.message = `Claude binary not available: ${claudeBin}`;
    return status;
  }
  const authResult = await runCommand(claudeBin, ["auth", "status"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  status.auth.checked = true;
  try {
    const parsed = JSON.parse(authResult.stdout);
    status.auth.loggedIn = Boolean(parsed.loggedIn);
    status.auth.detail = parsed;
  } catch {
    status.auth.error = authResult.stderr || authResult.stdout || "auth status parse failed";
  }
  status.ready = status.available && status.auth.loggedIn;
  status.message = status.ready ? "Claude ready" : "Claude not authenticated";
  return status;
}

function parseClaudeJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // continue
      }
    }
  }
  return null;
}

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   prompt: string,
 *   cwd: string,
 *   model?: string,
 *   effort?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number
 * }} req
 */
export async function runClaude(req) {
  const claudeBin = resolveClaudeBin({ env: req.env });
  const toolProfile = toolProfileForKind(req);
  const args = buildClaudeArgs({
    kind: req.kind,
    write: req.write,
    model: req.model,
    effort: req.effort,
    toolProfile
  });
  const prompt = req.prompt;

  const env = buildTargetEnv(req.env);

  const result = await runCommand(claudeBin, args, {
    cwd: req.cwd,
    env,
    stdin: prompt,
    timeoutMs: req.timeoutMs
  });

  const parsed = parseClaudeJson(result.stdout);
  const output = typeof parsed?.result === "string" ? parsed.result : result.stdout;
  const ok = result.status === 0 && !result.error && !result.timedOut;

  return {
    ok,
    exitCode: result.status,
    output,
    rawOutput: result.stdout,
    stderr: result.stderr,
    sessionId: parsed?.session_id ?? parsed?.sessionId ?? null,
    args,
    claudeBin,
    toolProfile,
    timedOut: Boolean(result.timedOut),
    error: result.error ? result.error.message : result.timedOut ? "timed out" : null
  };
}

export default {
  id: "claude",
  capabilities,
  resolveBin: resolveClaudeBin,
  setup,
  buildClaudeArgs,
  runClaude,
  toolProfileForKind
};
