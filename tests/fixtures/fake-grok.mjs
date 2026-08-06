#!/usr/bin/env node
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("--help")) {
  console.log("grok fake 0.0.0");
  process.exit(0);
}

if (process.env.FAKE_GROK_FAIL === "1") {
  console.error("fake grok failure");
  process.exit(2);
}

const pIdx = args.indexOf("-p");
const prompt = pIdx >= 0 ? args[pIdx + 1] ?? "" : "";

console.log(
  JSON.stringify({
    text: `Fake Grok response: ${prompt}`,
    sessionId: "fake-grok-session",
    stopReason: "end_turn",
    args
  })
);
