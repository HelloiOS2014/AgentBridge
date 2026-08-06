import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { collectReviewContext, isGitRepository } from "../src/core/git-context.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
}
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ab-gctx-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@t.invalid"]);
  git(root, ["config", "user.name", "T"]);
  return root;
}

describe("collectReviewContext", () => {
  it("non-git dir reports isGitRepository=false", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-nongit-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.equal(await isGitRepository(dir), false);
    const ctx = await collectReviewContext(dir);
    assert.equal(ctx.isGitRepository, false);
    assert.match(ctx.content, /not a git repository/);
  });

  it("falls back to HEAD~1 baseline without origin/main", async (t) => {
    const root = makeRepo(t);
    fs.writeFileSync(path.join(root, "a.txt"), "1\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "c1"]);
    fs.writeFileSync(path.join(root, "a.txt"), "2\n");
    fs.writeFileSync(path.join(root, "b.txt"), "b\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "c2"]);
    const ctx = await collectReviewContext(root, { maxDiffBytes: 1 << 20 });
    assert.equal(ctx.baseline.source, "head-parent");
    assert.ok(ctx.changedFiles.includes("a.txt"));
    assert.ok(ctx.changedFiles.includes("b.txt"));
  });

  it("captures staged, unstaged and untracked", async (t) => {
    const root = makeRepo(t);
    fs.writeFileSync(path.join(root, "tracked.txt"), "v1\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "init"]);
    fs.writeFileSync(path.join(root, "tracked.txt"), "v2\n"); // unstaged
    fs.writeFileSync(path.join(root, "staged.txt"), "s\n");
    git(root, ["add", "staged.txt"]); // staged
    fs.writeFileSync(path.join(root, "untracked.txt"), "u\n"); // untracked
    const ctx = await collectReviewContext(root, { maxDiffBytes: 1 << 20 });
    for (const f of ["tracked.txt", "staged.txt", "untracked.txt"]) {
      assert.ok(ctx.changedFiles.includes(f), f);
    }
    assert.match(ctx.fullDiff, /untracked.txt/);
  });

  it("truncates diff at maxDiffBytes", async (t) => {
    const root = makeRepo(t);
    fs.writeFileSync(path.join(root, "big.txt"), "a".repeat(1000) + "\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "c1"]);
    fs.writeFileSync(path.join(root, "big.txt"), "b".repeat(1000) + "\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "c2"]);
    const ctx = await collectReviewContext(root, { maxDiffBytes: 256 });
    assert.equal(ctx.diffTruncated, true);
    assert.ok(ctx.metadata.omittedDiffBytes > 0);
  });

  it("skips binary untracked files", async (t) => {
    const root = makeRepo(t);
    fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 3, 0]));
    const ctx = await collectReviewContext(root, { maxDiffBytes: 1 << 20 });
    assert.ok(ctx.metadata.untrackedFiles.skipped.some((s) => s.path === "bin.dat"));
  });
});
