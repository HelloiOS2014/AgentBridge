import { runCommand } from "./process.mjs";

/**
 * Capture porcelain status for WriteProbe.
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function gitFingerprint(cwd, env = process.env) {
  const result = await runCommand("git", ["--no-optional-locks", "status", "--porcelain"], {
    cwd,
    env: { ...env, GIT_OPTIONAL_LOCKS: "0" }
  });
  if (result.status !== 0 || result.error) {
    return { git: false, porcelain: "", error: result.stderr || result.error?.message || "git status failed" };
  }
  return { git: true, porcelain: result.stdout, error: null };
}

/**
 * @param {{ before: { git: boolean, porcelain: string }, after: { git: boolean, porcelain: string } }} pair
 */
export function compareFingerprints(pair) {
  if (!pair.before.git || !pair.after.git) {
    return { ok: true, skipped: true, touchedFiles: [] };
  }
  if (pair.before.porcelain === pair.after.porcelain) {
    return { ok: true, skipped: false, touchedFiles: [] };
  }
  const beforeLines = new Set(pair.before.porcelain.split("\n").filter(Boolean));
  const afterLines = pair.after.porcelain.split("\n").filter(Boolean);
  const touched = afterLines
    .filter((line) => !beforeLines.has(line))
    .map((line) => line.slice(3).trim())
    // 桥自己的附件暂存文件（--attach 放置/清理）不算篡改：并发委派可能同时放置/删除
    .filter((filePath) => !filePath.includes("agent-bridge-attach-"));
  return { ok: false, skipped: false, touchedFiles: touched.length ? touched : ["(git status changed)"] };
}
