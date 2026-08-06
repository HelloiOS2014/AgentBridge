#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("1.0.5");
  process.exit(0);
}

if (process.env.FAKE_AGY_SLEEP_MS) {
  await new Promise((resolve) => setTimeout(resolve, Number.parseInt(process.env.FAKE_AGY_SLEEP_MS, 10)));
}

if (process.env.FAKE_AGY_FAIL) {
  console.error("fake agy failure");
  process.exit(2);
}

if (process.env.FAKE_AGY_TOUCH) {
  fs.writeFileSync(path.join(process.cwd(), process.env.FAKE_AGY_TOUCH), "fake agy touched this file\n", "utf8");
}

if (process.env.FAKE_AGY_ERROR) {
  console.log(JSON.stringify({
    conversation_id: "fake-agy-conversation",
    status: "ERROR",
    response: "",
    error: "fake agy error envelope",
    duration_seconds: 1,
    num_turns: 1,
    usage: null
  }));
  process.exit(0);
}

if (process.env.FAKE_AGY_AUTH_TIMEOUT) {
  console.log("authentication timed out");
  process.exit(0);
}

const terminatorIndex = args.indexOf("--");
const prompt = terminatorIndex >= 0 ? args.slice(terminatorIndex + 1).join(" ") : "";

console.log(JSON.stringify({
  conversation_id: "fake-agy-conversation",
  status: "SUCCESS",
  response: [
    `Fake Agy response: ${prompt}`,
    "ARGS:",
    JSON.stringify(args)
  ].join("\n"),
  error: null,
  duration_seconds: 1,
  num_turns: 1,
  usage: { input_tokens: 1, output_tokens: 1 }
}));
