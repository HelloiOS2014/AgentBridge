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
    target: null,
    json: false,
    list: false,
    apply: false,
    dryRun: false,
    help: false,
    targets: null,
    remove: null,
    prompt: null,
    model: null,
    write: false,
    background: false,
    wait: false,
    all: false,
    full: false,
    cwd: null
  };
  /** @type {string[]} */
  const positionals = [];

  /** 取下一个 argv 作为值；下一个不存在或以 "-" 开头则视为缺值（不吞 flag）。 */
  function valueArg(argv, i) {
    const v = argv[i + 1];
    return v !== undefined && !v.startsWith("-") ? [v, true] : [null, false];
  }

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
    if (a === "--full") {
      flags.full = true;
      continue;
    }
    if (a === "--host") {
      const [v, consumed] = valueArg(argv, i);
      flags.host = v;
      if (consumed) i += 1;
      continue;
    }
    if (a.startsWith("--host=")) {
      flags.host = a.slice("--host=".length);
      continue;
    }
    if (a === "--target") {
      const [v, consumed] = valueArg(argv, i);
      flags.target = v;
      if (consumed) i += 1;
      continue;
    }
    if (a.startsWith("--target=")) {
      flags.target = a.slice("--target=".length);
      continue;
    }
    if (a === "--targets") {
      const [v, consumed] = valueArg(argv, i);
      flags.targets = v;
      if (consumed) i += 1;
      continue;
    }
    if (a.startsWith("--targets=")) {
      flags.targets = a.slice("--targets=".length);
      continue;
    }
    if (a === "--remove") {
      const [v, consumed] = valueArg(argv, i);
      // "" = flag present without value → cli 层卸载整个 host（`--remove <target>` 才带值）
      flags.remove = v ?? "";
      if (consumed) i += 1;
      continue;
    }
    if (a === "--prompt") {
      flags.prompt = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (a === "--cwd") {
      const [v, consumed] = valueArg(argv, i);
      flags.cwd = v;
      if (consumed) i += 1;
      continue;
    }
    if (a === "--model") {
      const [v, consumed] = valueArg(argv, i);
      flags.model = v;
      if (consumed) i += 1;
      continue;
    }
    if (a.startsWith("--model=")) {
      flags.model = a.slice("--model=".length);
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
  if (flags.target && !isTargetId(flags.target)) {
    throw new Error(`Invalid --target: ${flags.target}`);
  }

  return { target, command, rest, flags };
}

export function usageText() {
  return [
    "Usage:",
    "  agent-bridge --host <host> <target> <command> [options]",
    "  agent-bridge-<host> <target> <command> [options]",
    "  agent-bridge status|result|cancel <job-id> [--json]",
    "  agent-bridge result <job-id> --full [--json]   (skip truncation)",
    "  agent-bridge status --all [--host <host>] [--target <target>] [--json]",
    "  agent-bridge storage [--json]",
    "  agent-bridge cleanup [--host <host>] [--target <target>] [--all] [--json]",
    "  agent-bridge doctor [--host <host>] [--json]",
    "  agent-bridge install --host <host> [--targets a,b] [--list] [--remove [target]] [--apply] [--dry-run]",
    "  agent-bridge help",
    "",
    "Hosts: codex | claude | grok",
    "Targets: claude | codex | grok | antigravity",
    "Commands: setup plan review adversarial-review rescue status result cancel storage cleanup"
  ].join("\n");
}
