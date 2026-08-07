import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareFingerprints } from "../src/core/write-probe.mjs";

describe("write probe attach noise", () => {
  it("attachment staging file appearing is NOT a violation (concurrent --attach churn)", () => {
    const before = { git: true, porcelain: " M src/a.mjs\n" };
    const after = { git: true, porcelain: " M src/a.mjs\n?? agent-bridge-attach-0-images.jpeg\n" };
    const r = compareFingerprints({ before, after });
    assert.equal(r.ok, true);
    assert.deepEqual(r.touchedFiles, []);
  });

  it("attachment cleanup (file gone) is NOT a violation", () => {
    const before = { git: true, porcelain: "?? agent-bridge-attach-0-images.jpeg\n" };
    const after = { git: true, porcelain: "" };
    const r = compareFingerprints({ before, after });
    assert.equal(r.ok, true);
    assert.deepEqual(r.touchedFiles, []);
  });

  it("real workspace change is still flagged", () => {
    const before = { git: true, porcelain: " M src/a.mjs\n" };
    const after = { git: true, porcelain: " M src/a.mjs\n M src/b.mjs\n" };
    const r = compareFingerprints({ before, after });
    assert.equal(r.ok, false);
    assert.deepEqual(r.touchedFiles, ["src/b.mjs"]);
  });
});
