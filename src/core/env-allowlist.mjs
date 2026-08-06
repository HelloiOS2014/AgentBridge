/**
 * Env allowlist (design §11.5): keep the bridge's own env out of the
 * target agent's context.
 *
 * Layered filtering:
 * - The INHERITED layer (process.env of the bridge process) is filtered to
 *   the default allowlist + `AGENT_BRIDGE_*` vars + `AGENT_BRIDGE_ENV_ALLOWLIST`
 *   (comma-separated, appended). This is what stops API keys / other
 *   agents' secrets carried by the host env from leaking into the target.
 * - The EXPLICIT layer (req.env, passed by the caller of the adapter) passes
 *   through unfiltered: the caller knows what it is handing over (tests rely
 *   on this, e.g. FAKE_* switches).
 */

const DEFAULT_ALLOWED_ENV = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "SHELL",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NO_COLOR",
  "CLICOLOR",
  "CI"
]);

function allowedEnvNames(env = process.env) {
  const extras = String(env.AGENT_BRIDGE_ENV_ALLOWLIST ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ENV, ...extras]);
}

/** @param {NodeJS.ProcessEnv} source @param {NodeJS.ProcessEnv} [configEnv] */
export function filterInheritedEnv(source = process.env, configEnv = process.env) {
  const allowed = allowedEnvNames(configEnv);
  const filtered = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key) || key.startsWith("AGENT_BRIDGE_")) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Child env for target CLIs: allowlisted inherited layer + explicit
 * req.env passthrough + NESTED marker.
 *
 * @param {NodeJS.ProcessEnv} [reqEnv]
 */
export function buildTargetEnv(reqEnv = {}) {
  return {
    ...filterInheritedEnv(),
    ...(reqEnv ?? {}),
    AGENT_BRIDGE_NESTED: "1"
  };
}
