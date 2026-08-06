import { isHostId, isTargetId } from "./ids.mjs";

const META = new Set(["doctor", "install", "help", "version"]);
const COMMANDS = new Set([
  "setup",
  "plan",
  "review",
  "adversarial-review",
  "rescue",
  "status",
  "result",
  "cancel",
  "storage",
  "cleanup",
  "doctor",
  "install",
  "help",
  "version"
]);

/**
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseCliArgv(argv) {
  const flags = {
    host: null,
    json: false,
    list: false,
    apply: false,
    dryRun: false,
    help: false,
    targets: null,
    remove: null,
    prompt: null,
    write: false,
    background: false,
    wait: false,
    all: false,
    cwd: null
  };
  /** @type {string[]} */
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") {
      flags.json = true;
      continue;
    }
    if (a === "--list") {
      flags.list = true;
      continue;
    }
    if (a === "--apply") {
      flags.apply = true;
      continue;
    }
    if (a === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a === "--write") {
      flags.write = true;
      continue;
    }
    if (a === "--background") {
      flags.background = true;
      continue;
    }
    if (a === "--wait") {
      flags.wait = true;
      continue;
    }
    if (a === "--all") {
      flags.all = true;
      continue;
    }
    if (a === "--host") {
      flags.host = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a.startsWith("--host=")) {
      flags.host = a.slice("--host=".length);
      continue;
    }
    if (a === "--targets") {
      flags.targets = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a.startsWith("--targets=")) {
      flags.targets = a.slice("--targets=".length);
      continue;
    }
    if (a === "--remove") {
      flags.remove = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--prompt") {
      flags.prompt = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--cwd") {
      flags.cwd = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    }
    positionals.push(a);
  }

  let target = null;
  let command = null;
  /** @type {string[]} */
  const rest = [];

  if (positionals.length === 0) {
    command = flags.help ? "help" : "help";
  } else if (META.has(positionals[0]) || positionals[0] === "help") {
    command = positionals[0];
    rest.push(...positionals.slice(1));
  } else if (isTargetId(positionals[0])) {
    target = positionals[0];
    command = positionals[1] ?? "help";
    rest.push(...positionals.slice(2));
  } else if (COMMANDS.has(positionals[0])) {
    // status/result/cancel without target
    command = positionals[0];
    rest.push(...positionals.slice(1));
  } else {
    throw new Error(`Unknown command or target: ${positionals[0]}`);
  }

  if (!COMMANDS.has(command) && command !== "help" && command !== "version") {
    throw new Error(`Unknown command: ${command}`);
  }

  if (flags.host && !isHostId(flags.host)) {
    throw new Error(`Invalid --host: ${flags.host}`);
  }

  return { target, command, rest, flags };
}

export function usageText() {
  return [
    "Usage:",
    "  agent-bridge --host <host> <target> <command> [options]",
    "  agent-bridge-<host> <target> <command> [options]",
    "  agent-bridge status|result|cancel <job-id> [--json]",
    "  agent-bridge doctor [--host <host>] [--json]",
    "  agent-bridge install --host <host> [--targets a,b] [--list] [--apply] [--dry-run]",
    "  agent-bridge help",
    "",
    "Hosts: codex | claude | grok",
    "Targets: claude | codex | grok | antigravity",
    "Commands: setup plan review adversarial-review rescue status result cancel storage cleanup"
  ].join("\n");
}
