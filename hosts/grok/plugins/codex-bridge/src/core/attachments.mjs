import fs from "node:fs";
import path from "node:path";

export const ATTACH_MAX_MB_DEFAULT = 20;

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function attachMaxBytes(env = process.env) {
  const raw = env.AGENT_BRIDGE_ATTACH_MAX_MB;
  const mb = raw ? Number.parseFloat(raw) : ATTACH_MAX_MB_DEFAULT;
  return (Number.isFinite(mb) && mb > 0 ? mb : ATTACH_MAX_MB_DEFAULT) * 1024 * 1024;
}

/**
 * 校验附件（--attach 值）：存在、普通文件（符号链接拒绝、目录拒绝）、大小上限。
 * @param {string[]} paths
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<{ name: string, originalPath: string, size: number }>}
 * @throws {Error} usage 级错误
 */
export function resolveAttachments(paths, env = process.env) {
  const max = attachMaxBytes(env);
  return paths.map((p) => {
    const abs = path.resolve(p);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      throw new Error(`Attachment not found: ${p}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Attachment must not be a symlink: ${p}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Attachment must be a regular file: ${p}`);
    }
    if (stat.size > max) {
      const limitMb = Math.round((max / 1024 / 1024) * 100) / 100;
      throw new Error(
        `Attachment too large: ${p} (${Math.round(stat.size / 1024)}KB > ${limitMb}MB limit, AGENT_BRIDGE_ATTACH_MAX_MB)`
      );
    }
    return { name: path.basename(abs), originalPath: abs, size: stat.size };
  });
}

/**
 * 复制进真实工作区 untracked 区（文件名防冲突：前缀 agent-bridge-attach-<n>-）。
 * @param {Array<{ name: string, originalPath: string, size: number }>} attachments
 * @param {string} cwd
 */
export function placeWorkspaceAttachments(attachments, cwd) {
  return attachments.map((a, i) => {
    const placedPath = path.join(cwd, `agent-bridge-attach-${i}-${a.name}`);
    fs.copyFileSync(a.originalPath, placedPath);
    return { ...a, placedPath };
  });
}

/**
 * @param {Array<{ placedPath: string }>} placed
 */
export function removeWorkspaceAttachments(placed) {
  for (const a of placed) {
    try {
      fs.rmSync(a.placedPath, { force: true });
    } catch {
      // best effort
    }
  }
}

/**
 * prompt 内原路径 → 落位路径重写。
 * @param {string} prompt
 * @param {Array<{ originalPath: string, placedPath: string }>} mappings
 */
export function rewritePromptPaths(prompt, mappings) {
  let out = prompt;
  for (const m of mappings) {
    out = out.split(m.originalPath).join(m.placedPath);
  }
  return out;
}

/**
 * 落位说明（追加到 prompt 尾部，让委派 agent 能发现附件）。
 * @param {Array<{ originalPath: string, placedPath: string }>} mappings
 */
export function attachmentPromptNote(mappings) {
  if (!mappings.length) {
    return "";
  }
  return (
    "\n\nAgentBridge attachments staged for this task:\n" +
    mappings.map((m) => `- ${m.originalPath} -> ${m.placedPath}`).join("\n")
  );
}
