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

export function composeRescuePrompt(userPrompt, write) {
  if (write) {
    return [
      "You are in write-enabled rescue mode via AgentBridge.",
      "Make the smallest safe edits. Avoid unrelated changes. Report diagnosis, files touched, verification, risks.",
      "User request:",
      userPrompt
    ].join("\n\n");
  }
  return [
    "You are in read-only rescue / diagnosis mode via AgentBridge.",
    "Do not edit files. Diagnose and propose the smallest safe fix.",
    "User request:",
    userPrompt
  ].join("\n\n");
}
