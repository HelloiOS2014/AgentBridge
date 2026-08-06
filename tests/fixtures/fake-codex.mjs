#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("codex-cli fake 0.0.0");
  process.exit(0);
}

if (process.env.FAKE_CODEX_FAIL === "1") {
  console.error("fake codex failure");
  process.exit(2);
}

// reject dangerous flags if passed
if (args.some((a) => String(a).includes("dangerously-bypass"))) {
  console.error("dangerous flag not allowed in fake");
  process.exit(3);
}

const oIdx = args.indexOf("-o");
const outFile = oIdx >= 0 ? args[oIdx + 1] : null;

const reviewIdx = args.indexOf("review");
const isReview = reviewIdx >= 0;
const prompt = args[args.length - 1] || "";
const text = isReview
  ? `Fake Codex review: ${prompt}`
  : `Fake Codex response: ${prompt}`;

if (outFile) {
  fs.writeFileSync(outFile, text, "utf8");
}

// JSONL-ish event
console.log(JSON.stringify({ type: "item", text }));
console.log(JSON.stringify({ type: "done", message: text, session_id: "fake-codex-session" }));
