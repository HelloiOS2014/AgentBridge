import { allowedTargets, isHostId, isTargetId } from "./ids.mjs";
import { EXIT } from "./exit-codes.mjs";

/** Flags never allowed on any target spawn argv (expand per adapter later). */
export const GLOBAL_BARE_AND_DANGEROUS = Object.freeze([
  "--bare",
  "--safe-mode",
  "--yolo",
  "--always-approve",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust"
]);

/**
 * @param {string[]} argv
 * @throws {Error}
 */
export function assertNoForbiddenFlags(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const flag = raw.includes("=") ? raw.slice(0, raw.indexOf("=")) : raw;
    if (GLOBAL_BARE_AND_DANGEROUS.includes(flag)) {
      throw new Error(`Forbidden flag (bare/dangerous): ${flag}`);
    }
    if (flag === "--permission-mode") {
      const mode = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : argv[i + 1];
      if (mode === "bypassPermissions") {
        throw new Error("Forbidden permission mode: bypassPermissions");
      }
    }
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isNested(env = process.env) {
  return env.AGENT_BRIDGE_NESTED === "1" || env.AGENT_BRIDGE_NESTED === "true";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function allowSelf(env = process.env) {
  return env.AGENT_BRIDGE_ALLOW_SELF === "1" || env.AGENT_BRIDGE_ALLOW_SELF === "true";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function allowUnscoped(env = process.env) {
  return env.AGENT_BRIDGE_ALLOW_UNSCOPED === "1" || env.AGENT_BRIDGE_ALLOW_UNSCOPED === "true";
}

/**
 * @param {{ hostFlag?: string | null, env?: NodeJS.ProcessEnv }} opts
 * @returns {{ host: string | null, source: string | null }}
 */
export function resolveLockedHost(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.AGENT_BRIDGE_LOCKED_HOST) {
    const h = String(env.AGENT_BRIDGE_LOCKED_HOST).trim();
    if (isHostId(h)) {
      return { host: h, source: "AGENT_BRIDGE_LOCKED_HOST" };
    }
  }
  if (opts.hostFlag) {
    const h = String(opts.hostFlag).trim();
    if (isHostId(h)) {
      return { host: h, source: "--host" };
    }
  }
  return { host: null, source: null };
}

/**
 * Commands that require host lock for product use.
 * @param {string} command
 */
export function commandRequiresHostLock(command) {
  return ["plan", "review", "adversarial-review", "rescue"].includes(command);
}

/**
 * @param {{
 *   command: string,
 *   target?: string | null,
 *   hostFlag?: string | null,
 *   env?: NodeJS.ProcessEnv
 * }} input
 * @returns {{ ok: true, host: string | null } | { ok: false, exitCode: number, errorCode: string, errorMessage: string }}
 */
export function evaluateGates(input) {
  const env = input.env ?? process.env;
  const command = input.command;

  if (isNested(env)) {
    if (command === "help" || command === "version") {
      // allow
    } else {
      return {
        ok: false,
        exitCode: EXIT.NESTED,
        errorCode: "nested_refused",
        errorMessage: "AGENT_BRIDGE_NESTED=1: refusing nested agent-bridge invocation"
      };
    }
  }

  const { host } = resolveLockedHost({ hostFlag: input.hostFlag, env });
  const needsHost = commandRequiresHostLock(command);

  if (input.target && !isTargetId(input.target)) {
    return {
      ok: false,
      exitCode: EXIT.USAGE,
      errorCode: "invalid_target",
      errorMessage: `Unknown target: ${input.target}`
    };
  }

  if (needsHost) {
    if (!host && !allowUnscoped(env)) {
      return {
        ok: false,
        exitCode: EXIT.USAGE,
        errorCode: "missing_host_lock",
        errorMessage:
          "Delegation requires host lock (agent-bridge-<host> or AGENT_BRIDGE_LOCKED_HOST). Debug: AGENT_BRIDGE_ALLOW_UNSCOPED=1"
      };
    }

    if (!input.target) {
      return {
        ok: false,
        exitCode: EXIT.USAGE,
        errorCode: "missing_target",
        errorMessage: `Command ${command} requires a target`
      };
    }

    if (host && input.target === host && !allowSelf(env)) {
      return {
        ok: false,
        exitCode: EXIT.SELF,
        errorCode: "self_delegation",
        errorMessage: `Refusing self-delegation: host=${host} target=${input.target}`
      };
    }

    if (host && isHostId(host)) {
      const allowed = allowedTargets(host);
      if (!allowed.includes(/** @type {import("./ids.mjs").TargetId} */ (input.target)) && !allowSelf(env)) {
        return {
          ok: false,
          exitCode: EXIT.SELF,
          errorCode: "target_not_allowed",
          errorMessage: `Target ${input.target} not allowed for host ${host}`
        };
      }
    }
  }

  return { ok: true, host };
}
