import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo / package root (…/AgentBridge) */
export function packageRoot() {
  return path.resolve(__dirname, "../..");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function agentBridgeHome(env = process.env) {
  if (env.AGENT_BRIDGE_HOME) {
    return path.resolve(env.AGENT_BRIDGE_HOME);
  }
  return path.join(os.homedir(), ".agent-bridge");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function stateRoot(env = process.env) {
  if (env.AGENT_BRIDGE_STATE_DIR) {
    return path.resolve(env.AGENT_BRIDGE_STATE_DIR);
  }
  return path.join(agentBridgeHome(env), "state");
}

/**
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 */
export function hostLockPath(host, env = process.env) {
  return path.join(agentBridgeHome(env), "hosts", `${host}.lock.json`);
}

/**
 * @param {string} host
 * @param {NodeJS.ProcessEnv} [env]
 */
export function hostWrapperPath(host, env = process.env) {
  return path.join(agentBridgeHome(env), "bin", `agent-bridge-${host}`);
}

/**
 * @param {string} dir
 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
