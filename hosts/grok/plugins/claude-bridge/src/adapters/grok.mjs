import fs from "node:fs";
import path from "node:path";
import { assertNoForbiddenFlags } from "../core/safety.mjs";
import { buildTargetEnv } from "../core/env-allowlist.mjs";
import { binaryAvailable, runCommand } from "../core/process.mjs";

export function resolveGrokBin(options = {}) {
  if (options.grokBin) {
    return options.grokBin;
  }
  const env = options.env ?? process.env;
  if (env.AGENT_BRIDGE_GROK_BIN) {
    return env.AGENT_BRIDGE_GROK_BIN;
  }
  return discoverGrokBin(env) ?? "grok";
}

function discoverGrokBin(env = process.env) {
  const home = env.HOME || env.USERPROFILE;
  const candidates = [];
  if (home) {
    candidates.push(path.join(home, ".grok", "bin", "grok"), path.join(home, ".local", "bin", "grok"));
  }
  candidates.push("/opt/homebrew/bin/grok", "/usr/local/bin/grok");
  return candidates.find((c) => {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

export function capabilities() {
  return {
    plan: "emulated",
    review: "emulated",
    readOnlyGuarantee: "sandbox",
    headlessZeroInteractive: true,
    transports: ["grok-print"]
  };
}

/**
 * @param {{ kind: string, write?: boolean, model?: string, prompt: string }} options
 */
export function buildGrokArgs(options = {}) {
  const write = Boolean(options.write);
  // Prompt as -p value; remaining flags after
  const args = ["-p", options.prompt ?? "", "--output-format", "json"];

  if (!write) {
    args.push(
      "--tools",
      "read_file,grep,list_dir",
      "--disallowed-tools",
      "Agent",
      "--sandbox",
      "read-only",
      "--permission-mode",
      "dontAsk",
      "--deny",
      "MCPTool(*)",
      "--deny",
      "Edit(*)",
      "--deny",
      "Write(*)"
    );
  } else {
    // Write path: 必须显式授予编辑与 shell 工具（内部 ID：search_replace / run_terminal_cmd）——
    // 只传 permission-mode 时默认工具集不含编辑工具，模型只会口头声称（零产出）。
    // acceptEdits 自动批准文件编辑；仍禁 bare yolo 与子 agent。
    args.push(
      "--tools",
      "read_file,grep,list_dir,search_replace,run_terminal_cmd",
      "--disallowed-tools",
      "Agent",
      "--permission-mode",
      "acceptEdits",
      "--deny",
      "MCPTool(*)"
    );
  }

  if (options.model) {
    args.push("-m", options.model);
  }

  assertNoForbiddenFlags(args);
  return args;
}

export async function setup(options = {}) {
  const grokBin = resolveGrokBin(options);
  const version = await binaryAvailable(grokBin, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs
  });
  // --version may not exist on all builds; try -h as fallback availability
  let available = version.available;
  if (!available) {
    const help = await binaryAvailable(grokBin, ["--help"], {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs
    });
    // help often exits 0 or 2
    available = help.status === 0 || (help.stdout || help.stderr || "").length > 0;
  }
  return {
    ready: available,
    available,
    bin: grokBin,
    version: version.stdout?.trim() || null,
    auth: { checked: false, loggedIn: null },
    capabilities: capabilities(),
    message: available ? "Grok CLI available" : `grok not found: ${grokBin}`
  };
}

function parseGrokJson(stdout) {
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

/**
 * @param {{
 *   kind: string,
 *   write?: boolean,
 *   prompt: string,
 *   cwd: string,
 *   model?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number
 * }} req
 */
export async function runGrok(req) {
  const grokBin = resolveGrokBin({ env: req.env });
  const args = buildGrokArgs({
    kind: req.kind,
    write: req.write,
    model: req.model,
    prompt: req.prompt
  });
  const env = buildTargetEnv(req.env);
  const result = await runCommand(grokBin, args, {
    cwd: req.cwd,
    env,
    timeoutMs: req.timeoutMs
  });
  const parsed = parseGrokJson(result.stdout);
  const output =
    parsed?.text ?? parsed?.result ?? parsed?.message ?? result.stdout;
  const ok = result.status === 0 && !result.error && !result.timedOut;
  return {
    ok,
    output: typeof output === "string" ? output : JSON.stringify(output),
    rawOutput: result.stdout,
    stderr: result.stderr,
    sessionId: parsed?.sessionId ?? parsed?.session_id ?? null,
    args,
    grokBin,
    error: result.error ? result.error.message : result.timedOut ? "timed out" : ok ? null : "grok failed"
  };
}

export default {
  id: "grok",
  capabilities,
  resolveBin: resolveGrokBin,
  setup,
  buildGrokArgs,
  runGrok
};
