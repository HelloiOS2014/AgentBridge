/** @typedef {"codex" | "claude" | "grok" | "antigravity"} HostId */
/** @typedef {"claude" | "codex" | "grok" | "antigravity"} TargetId */

/** @type {readonly HostId[]} */
export const HOST_IDS = Object.freeze(["codex", "claude", "grok"]);

/** @type {readonly TargetId[]} */
export const TARGET_IDS = Object.freeze(["claude", "codex", "grok", "antigravity"]);

/**
 * @param {HostId} host
 * @returns {TargetId[]}
 */
export function allowedTargets(host) {
  return TARGET_IDS.filter((t) => t !== host);
}

/**
 * @param {string} value
 * @returns {value is HostId}
 */
export function isHostId(value) {
  return HOST_IDS.includes(/** @type {HostId} */ (value));
}

/**
 * @param {string} value
 * @returns {value is TargetId}
 */
export function isTargetId(value) {
  return TARGET_IDS.includes(/** @type {TargetId} */ (value));
}
