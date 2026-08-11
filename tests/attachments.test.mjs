import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseCliArgv } from "../src/core/args.mjs";
import { resolveAttachments } from "../src/core/attachments.mjs";
import { runDelegation } from "../src/core/run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.mjs");
const fakeClaude = path.join(root, "tests", "fixtures", "fake-claude.mjs");
const fakeAgy = path.join(root, "tests", "fixtures", "fake-agy.mjs");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-attach-ws-"));
  spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: dir,
    encoding: "utf8"
  });
  return dir;
}

function makeEnv(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-attach-home-"));
  return {
    ...process.env,
    AGENT_BRIDGE_HOME: home,
    AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
    ...extra
  };
}

describe("--attach parsing", () => {
  it("repeatable --attach and --attach= form", () => {
    const { flags } = parseCliArgv(["claude", "plan", "--attach", "/tmp/a.png", "--attach=/tmp/b.png"]);
    assert.deepEqual(flags.attachments, ["/tmp/a.png", "/tmp/b.png"]);
  });

  it("--attach without value is a usage error", () => {
    assert.throws(() => parseCliArgv(["claude", "plan", "--attach", "--json"]), /requires an absolute file path/);
  });
});

describe("attachment validation", () => {
  it("rejects missing file", () => {
    assert.throws(() => resolveAttachments(["/no/such/file-xyz.png"]), /not found/);
  });

  it("rejects symlinks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-attach-link-"));
    const real = path.join(dir, "real.txt");
    const link = path.join(dir, "link.txt");
    fs.writeFileSync(real, "x");
    fs.symlinkSync(real, link);
    assert.throws(() => resolveAttachments([link]), /symlink/);
  });

  it("rejects directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-attach-dir-"));
    assert.throws(() => resolveAttachments([dir]), /regular file/);
  });

  it("enforces AGENT_BRIDGE_ATTACH_MAX_MB", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-attach-size-"));
    const big = path.join(dir, "big.bin");
    fs.writeFileSync(big, Buffer.alloc(1024));
    assert.throws(
      () => resolveAttachments([big], { ...process.env, AGENT_BRIDGE_ATTACH_MAX_MB: "0.0001" }),
      /too large/
    );
    // default 20MB allows 1KB
    assert.equal(resolveAttachments([big]).length, 1);
  });
});

describe("runDelegation attachments (workspace targets)", () => {
  it("claude plan: staged in workspace, prompt rewritten, cleaned after (read-only)", async () => {
    const dir = makeRepo();
    const file = path.join(dir, "..", "screenshot.png");
    fs.writeFileSync(file, "png-data");
    const env = makeEnv({ AGENT_BRIDGE_CLAUDE_BIN: fakeClaude });

    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "plan",
      prompt: `review ${file} design`,
      cwd: dir,
      attachments: [file],
      env
    });

    assert.equal(result.status, "completed", result.errorMessage);
    assert.match(result.rendered, /agent-bridge-attach-0-screenshot\.png/); // prompt 重写为落位路径
    assert.match(result.rendered, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "原路径仍出现在渲染结果中");
    const meta = result.metadata.attachments[0];
    assert.equal(meta.name, "screenshot.png");
    assert.equal(meta.originalPath, file);
    assert.ok(meta.placedPath.endsWith("agent-bridge-attach-0-screenshot.png"));
    // 只读任务：委派后删除（WriteProbe 无附件误报 → 无 write_probe_failed）
    assert.equal(fs.existsSync(meta.placedPath), false, "read-only attachment cleaned");
  });

  it("claude rescue --write: attachment kept as output, path reported", async () => {
    const dir = makeRepo();
    const file = path.join(dir, "..", "log.txt");
    fs.writeFileSync(file, "stack trace");
    // 目标真实产出（触摸文件）——零产出检测下，"只放附件但目标什么都没干"应判 no_output
    const env = makeEnv({ AGENT_BRIDGE_CLAUDE_BIN: fakeClaude, FAKE_CLAUDE_TOUCH: "target-output.txt" });

    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "rescue",
      prompt: `fix from ${file}`,
      write: true,
      cwd: dir,
      attachments: [file],
      env
    });

    assert.equal(result.status, "completed", result.errorMessage);
    assert.equal(result.noOutput, undefined, "有真实产出则不是零产出");
    assert.equal(fs.existsSync(path.join(dir, "target-output.txt")), true, "目标产出落盘");
    const meta = result.metadata.attachments[0];
    assert.equal(fs.existsSync(meta.placedPath), true, "write attachment kept");
    assert.match(result.rendered, /agent-bridge-attach-0-log\.txt/);
  });

  it("rescue --write with attachment but zero target output is flagged no_output", async () => {
    const dir = makeRepo();
    const file = path.join(dir, "..", "log2.txt");
    fs.writeFileSync(file, "stack trace");
    const env = makeEnv({ AGENT_BRIDGE_CLAUDE_BIN: fakeClaude });

    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "rescue",
      prompt: `fix from ${file}`,
      write: true,
      cwd: dir,
      attachments: [file],
      env
    });

    assert.equal(result.noOutput, true);
    assert.equal(result.errorCode, "no_output");
  });

  it("invalid attachment returns usage failure", async () => {
    const dir = makeRepo();
    const env = makeEnv({ AGENT_BRIDGE_CLAUDE_BIN: fakeClaude });
    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "plan",
      prompt: "x",
      cwd: dir,
      attachments: ["/no/such/file"],
      env
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "usage");
  });
});

describe("runDelegation attachments (antigravity snapshot)", () => {
  it("plan: staged inside snapshot before baseline, prompt rewritten, removed with snapshot", async () => {
    const dir = makeRepo();
    const file = path.join(dir, "..", "design.png");
    fs.writeFileSync(file, "png");
    const env = makeEnv({ AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy });

    const result = await runDelegation({
      host: "codex",
      target: "antigravity",
      command: "plan",
      prompt: `design from ${file}`,
      cwd: dir,
      attachments: [file],
      env
    });

    assert.equal(result.status, "completed", result.errorMessage);
    assert.equal(result.errorCode, null);
    assert.deepEqual(result.touchedFiles, []);
    const isolation = result.metadata.isolation.antigravityIsolation;
    assert.equal(isolation.attachments.length, 1);
    const placed = isolation.attachments[0].placedPath;
    assert.match(placed, /attachments\/agent-bridge-attach-0-design\.png$/);
    // prompt 重写为快照内路径（fake agy 回显 prompt）
    assert.match(result.rendered, /attachments\/agent-bridge-attach-0-design\.png/);
    // 快照随任务删除
    assert.equal(fs.existsSync(path.dirname(isolation.snapshotRoot)), false);
    // job metadata 记录附件
    assert.equal(result.metadata.attachments[0].placedPath, placed);
  });
});

describe("cli --attach end-to-end", () => {
  it("plan with --attach exits 0, attachment cleaned after", () => {
    const dir = makeRepo();
    const file = path.join(dir, "..", "cli-attach.txt");
    fs.writeFileSync(file, "content");
    const env = makeEnv({ AGENT_BRIDGE_CLAUDE_BIN: fakeClaude, AGENT_BRIDGE_LOCKED_HOST: "codex" });

    const r = spawnSync(
      process.execPath,
      [cli, "claude", "plan", "--json", "--prompt", "inspect", "--attach", file],
      { encoding: "utf8", cwd: dir, env }
    );
    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.status, "completed");
    assert.equal(payload.metadata.attachments.length, 1);
    assert.equal(fs.existsSync(payload.metadata.attachments[0].placedPath), false);
    assert.equal(fs.existsSync(file), true, "original untouched");
  });

  it("oversized attachment exits 2 with usage error", () => {
    const dir = makeRepo();
    const file = path.join(dir, "..", "huge.bin");
    fs.writeFileSync(file, Buffer.alloc(1024));
    const env = makeEnv({
      AGENT_BRIDGE_CLAUDE_BIN: fakeClaude,
      AGENT_BRIDGE_LOCKED_HOST: "codex",
      AGENT_BRIDGE_ATTACH_MAX_MB: "0.0001"
    });
    const r = spawnSync(
      process.execPath,
      [cli, "claude", "plan", "--json", "--prompt", "x", "--attach", file],
      { encoding: "utf8", cwd: dir, env }
    );
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });
});
