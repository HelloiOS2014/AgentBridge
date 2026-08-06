import fs from "node:fs";
import path from "node:path";
import { assertNoForbiddenFlags } from "../core/safety.mjs";
import { binaryAvailable, runCommand } from "../core/process.mjs";
import {
  collectGitTouchedFiles,
  isolationMetadata,
  prepareIsolatedWorkspace,
  removeIsolatedWorkspace
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
    transports: ["agy-print"]
  };
}

/**
 * @param {{ write?: boolean, model?: string, printTimeout?: string, prompt: string }} options
 */
export function buildAgyArgs(options = {}) {
  const args = ["--print"];
  if (!options.write) {
    args.push("--sandbox");
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.printTimeout) {
    args.push("--print-timeout", String(options.printTimeout));
  }
  args.push("--", options.prompt ?? "");
  assertNoForbiddenFlags(args.slice(0, -1));
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
export async function runAntigravity(req) {
  const write = Boolean(req.write);
  const agyBin = resolveAgyBin({ env: req.env });
  const env = {
    ...process.env,
    ...(req.env ?? {}),
    AGENT_BRIDGE_NESTED: "1"
  };

  if (write) {
    if (req.resume) {
      throw new Error(
        "Antigravity read-only→write: use --write without --resume for a fresh write-capable run"
      );
    }
    const args = buildAgyArgs({ write: true, model: req.model, prompt: req.prompt });
    const result = await runCommand(agyBin, args, {
      cwd: req.cwd,
      env,
      timeoutMs: req.timeoutMs
    });
    const runtimeError = detectAgyRuntimeError(result);
    const parsed = parseAgyJson(result.stdout);
    const output = parsed?.result ?? parsed?.output ?? parsed?.text ?? result.stdout;
    const ok = result.status === 0 && !result.error && !result.timedOut && !runtimeError;
    return {
      ok,
      output,
      rawOutput: result.stdout,
      stderr: result.stderr,
      sessionId: parsed?.session_id ?? parsed?.sessionId ?? null,
      args,
      agyBin,
      isolation: null,
      touchedFiles: [],
      error: runtimeError || (result.error ? result.error.message : result.timedOut ? "timed out" : null)
    };
  }

  // read-only: isolation + sandbox + touchedFiles probe
  const isolation = await prepareIsolatedWorkspace(req.cwd, { env });
  try {
    const isolatedPrompt = [
      "AgentBridge Antigravity safety context:",
      `- Original workspace: ${isolation.originalCwd}`,
      `- Execution workspace: ${isolation.isolatedCwd}`,
      "- Disposable snapshot; analysis only. Do not edit files.",
      "",
      req.prompt
    ].join("\n");
    const args = buildAgyArgs({ write: false, model: req.model, prompt: isolatedPrompt });
    const result = await runCommand(agyBin, args, {
      cwd: isolation.isolatedCwd,
      env,
      timeoutMs: req.timeoutMs
    });
    const touchedFiles = await collectGitTouchedFiles(isolation.snapshotRoot, {
      env,
      includeIgnored: true
    });
    const runtimeError = detectAgyRuntimeError(result);
    const parsed = parseAgyJson(result.stdout);
    const output = parsed?.result ?? parsed?.output ?? parsed?.text ?? result.stdout;
    const probeFail = touchedFiles.length > 0;
    const ok =
      result.status === 0 && !result.error && !result.timedOut && !runtimeError && !probeFail;
    return {
      ok,
      output,
      rawOutput: result.stdout,
      stderr: result.stderr,
      sessionId: parsed?.session_id ?? parsed?.sessionId ?? null,
      args,
      agyBin,
      isolation: isolationMetadata(isolation, {
        touchedFiles,
        readOnlyViolation: probeFail
      }),
      touchedFiles,
      error: probeFail
        ? `Antigravity modified isolated workspace: ${touchedFiles.join(", ")}`
        : runtimeError || (result.error ? result.error.message : result.timedOut ? "timed out" : null)
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
