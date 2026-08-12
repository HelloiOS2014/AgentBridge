export function composePlanPrompt(userPrompt) {
  return [
    "You are assisting via AgentBridge in read-only planning mode.",
    "Produce an implementation or review plan: scope, files, sequencing, risks, assumptions, rollback, verification.",
    "Do not edit files, create commits, or change project state.",
    "User request:",
    userPrompt
  ].join("\n\n");
}

export function composeReviewPrompt(contextContent, adversarial = false, focus = "") {
  const role = adversarial
    ? "You are an adversarial reviewer. Challenge design, assumptions, failure modes, rollback, and alternatives."
    : "You are a conservative code reviewer. Prioritize bugs, regressions, security, missing tests.";
  return [
    role,
    "Use only the git context below. Do not edit files.",
    focus ? `Focus:\n${focus}` : "",
    contextContent
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 长任务产出规范：显式 --output file 时注入，约束目标 agent 把完整产出写入
 * agent-bridge-output/ 文件、返回只给路径+摘要（避免长内容撑爆返回通道）。
 * 目录用工作区相对路径：grok 等写 cwd 时落在 worktree/agent-bridge-output/，
 * agy 写 scratch 时经搬移保留相对路径同样落在 worktree/agent-bridge-output/。
 */
function fileOutputSection() {
  return [
    "## Output format",
    "This is a complex or long task. Write the full output into files under the",
    '"agent-bridge-output/" directory (relative to your current workspace; create the directory if needed).',
    "In your reply, only list the output file paths with a one-line summary of each —",
    "do NOT paste the full content into the reply text."
  ].join("\n");
}

export function composeRescuePrompt(userPrompt, write, outputMode = "inline") {
  if (write) {
    const body = [
      "You are in write-enabled rescue mode via AgentBridge.",
      "Make the smallest safe edits. Avoid unrelated changes. Report diagnosis, files touched, verification, risks.",
      "User request:",
      userPrompt
    ];
    if (outputMode === "file") {
      body.push(fileOutputSection());
    }
    return body.join("\n\n");
  }
  return [
    "You are in read-only rescue / diagnosis mode via AgentBridge.",
    "Do not edit files. Diagnose and propose the smallest safe fix.",
    "User request:",
    userPrompt
  ].join("\n\n");
}
