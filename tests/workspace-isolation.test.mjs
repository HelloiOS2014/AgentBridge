import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { collectGitTouchedFiles } from "../src/core/workspace-isolation.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ws-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@t.invalid"]);
  git(root, ["config", "user.name", "T"]);
  return root;
}

describe("collectGitTouchedFiles", () => {
  it("excludes ignored (!!) entries, keeps modified/untracked", async (t) => {
    const root = makeRepo(t);
    fs.writeFileSync(path.join(root, "tracked.txt"), "v1\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "init"]);
    fs.writeFileSync(path.join(root, "tracked.txt"), "v2\n");
    fs.writeFileSync(path.join(root, "untracked.txt"), "u\n");
    fs.writeFileSync(path.join(root, ".gitignore"), "cache.log\n");
    fs.writeFileSync(path.join(root, "cache.log"), "x\n");
    const touched = await collectGitTouchedFiles(root, { includeIgnored: true });
    assert.ok(touched.includes("tracked.txt"));
    assert.ok(touched.includes("untracked.txt"));
    assert.ok(!touched.includes("cache.log"));
  });
});
