#!/usr/bin/env node
import fs from "node:fs";
import { parseCliArgv, usageText } from "./core/args.mjs";
import { EXIT } from "./core/exit-codes.mjs";
import { allowedTargets, isHostId, isTargetId } from "./core/ids.mjs";
import { runInstall, resolveInstallTargets, runUninstall } from "./core/install.mjs";
import { cleanupJobs, listJobs, lookupJob, stateReport } from "./core/jobs.mjs";
import { truncateByBytes } from "./core/git-context.mjs";
import { runDoctor } from "./core/doctor.mjs";
import { runDelegation } from "./core/run.mjs";
import { evaluateGates } from "./core/safety.mjs";

const VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

/** KB env 值解析：无效/<=0 回退默认。 */
function limitKB(env, key, fallbackKB) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallbackKB;
}

/**
 * 展示层截断（落盘/返回均为全量，仅此处按阈值截断 rendered/rawOutput）。
 * 返回新对象；storage 如实反映本次展示是否截断。
 */
function truncateForDisplay(payload, env) {
  const renderLimit = limitKB(env, "AGENT_BRIDGE_RENDER_LIMIT_KB", 16) * 1024;
  const rawLimit = limitKB(env, "AGENT_BRIDGE_RAW_LIMIT_KB", 64) * 1024;
  const truncatedFields = [];
  let omittedBytes = 0;
  const out = { ...payload };
  for (const [field, limit] of [["rendered", renderLimit], ["rawOutput", rawLimit]]) {
    if (typeof out[field] === "string") {
      const t = truncateByBytes(out[field], limit);
      if (t.truncated) {
        out[field] = t.value;
        truncatedFields.push(field);
        omittedBytes += t.omittedBytes;
      }
    }
  }
  out.metadata = {
    ...(out.metadata ?? {}),
    storage: { truncated: truncatedFields.length > 0, truncatedFields, omittedBytes }
  };
  return out;
}

/**
 * @param {unknown} payload
 * @param {boolean} asJson
 */
function emit(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (typeof payload === "string") {
    process.stdout.write(payload.endsWith("\n") ? payload : `${payload}\n`);
  } else if (payload && typeof payload === "object" && "rendered" in payload && payload.rendered) {
    process.stdout.write(String(payload.rendered).endsWith("\n") ? payload.rendered : `${payload.rendered}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

/**
 * @param {number} code
 * @param {object} body
 * @param {boolean} asJson
 */
function fail(code, body, asJson) {
  const payload = {
    status: "failed",
    errorCode: body.errorCode ?? "error",
    errorMessage: body.errorMessage ?? body.message ?? "failed",
    ...body
  };
  emit(payload, asJson || true);
  process.exit(code);
}

async function main() {
  let parsed;
  try {
    parsed = parseCliArgv(process.argv.slice(2));
  } catch (error) {
    fail(EXIT.USAGE, {
      errorCode: "usage",
      errorMessage: error instanceof Error ? error.message : String(error),
      rendered: usageText()
    }, true);
    return;
  }

  const { target, command, rest, flags } = parsed;
  const asJson = flags.json;

  if (flags.help || command === "help") {
    emit(usageText(), false);
    process.exit(EXIT.OK);
  }

  if (command === "version") {
    emit({ status: "completed", kind: "version", summary: VERSION, version: VERSION }, asJson);
    process.exit(EXIT.OK);
  }

  const gate = evaluateGates({
    command,
    target,
    hostFlag: flags.host,
    env: process.env
  });

  if (!gate.ok) {
    fail(gate.exitCode, {
      errorCode: gate.errorCode,
      errorMessage: gate.errorMessage,
      kind: command,
      target: target ?? null
    }, asJson);
    return;
  }

  if (command === "install") {
    if (!flags.host || !isHostId(flags.host)) {
      fail(EXIT.USAGE, { errorCode: "usage", errorMessage: "install requires --host <codex|claude|grok>" }, asJson);
      return;
    }
    try {
      if (flags.list && !flags.targets) {
        const allowed = allowedTargets(flags.host);
        emit(
          {
            status: "completed",
            kind: "install",
            host: flags.host,
            allowedTargets: allowed,
            summary: `allowed: ${allowed.join(", ")}`
          },
          asJson
        );
        process.exit(EXIT.OK);
      }
      if (flags.remove !== null && !flags.targets) {
        const removeTarget = flags.remove || null;
        if (removeTarget !== null && !isTargetId(removeTarget)) {
          fail(EXIT.USAGE, {
            errorCode: "usage",
            errorMessage: `Invalid --remove target: ${removeTarget}`
          }, asJson);
          return;
        }
        const result = runUninstall(flags.host, process.env, removeTarget);
        emit(
          {
            status: "completed",
            kind: "install",
            action: "remove",
            host: flags.host,
            summary: `Uninstalled host=${flags.host}: ${result.removed.length} path(s)`,
            removed: result.removed
          },
          asJson
        );
        process.exit(EXIT.OK);
      }
      const targets = resolveInstallTargets(flags.host, flags.targets);
      const apply = Boolean(flags.apply) && !flags.dryRun;
      // default dry-run unless --apply
      const plan = runInstall({
        host: flags.host,
        targets,
        apply: apply
      });
      emit(
        {
          status: "completed",
          kind: "install",
          summary: plan.applied
            ? `Installed host=${plan.host} targets=${plan.targets.join(",")} wrapper=${plan.wrapper}`
            : `Dry-run host=${plan.host} targets=${plan.targets.join(",")} (pass --apply)`,
          ...plan
        },
        asJson
      );
      process.exit(EXIT.OK);
    } catch (error) {
      fail(EXIT.USAGE, {
        errorCode: "install_error",
        errorMessage: error instanceof Error ? error.message : String(error)
      }, asJson);
    }
    return;
  }

  if (command === "storage") {
    emit({ status: "completed", kind: "storage", ...stateReport() }, asJson);
    process.exit(EXIT.OK);
  }

  if (command === "cleanup") {
    try {
      const res = cleanupJobs(process.env, { host: flags.host, target: flags.target, all: flags.all });
      emit({ status: "completed", kind: "cleanup", ...res }, asJson);
      process.exit(EXIT.OK);
    } catch (error) {
      fail(EXIT.USAGE, {
        errorCode: "usage",
        errorMessage: error instanceof Error ? error.message : String(error)
      }, asJson);
      return;
    }
  }

  if (command === "doctor") {
    const host = flags.host ?? gate.host;
    const report = await runDoctor({ host, env: process.env, cwd: process.cwd() });
    emit(report, asJson);
    process.exit(report.ready === false ? EXIT.NOT_READY : EXIT.OK);
  }

  if ((command === "status" || command === "result") && !rest[0] && flags.all) {
    const jobs = listJobs()
      .filter((j) => !flags.host || j.host === flags.host)
      .filter((j) => !flags.target || j.target === flags.target);
    emit(
      {
        status: "completed",
        kind: command,
        jobId: null,
        summary: `${jobs.length} job(s)`,
        count: jobs.length,
        jobs
      },
      asJson
    );
    process.exit(EXIT.OK);
  }

  if (command === "status" || command === "result" || command === "cancel") {
    const jobId = rest[0];
    if (!jobId) {
      fail(EXIT.USAGE, { errorCode: "usage", errorMessage: `${command} requires <job-id>` }, asJson);
      return;
    }
    const found = lookupJob(jobId);
    if (!found || found.missing) {
      fail(EXIT.FAIL, {
        errorCode: "job_not_found",
        errorMessage: `Job not found: ${jobId}`,
        jobId
      }, asJson);
      return;
    }
    if (found.corrupt) {
      fail(EXIT.FAIL, {
        errorCode: "job_corrupt",
        errorMessage: `Job file corrupt: ${jobId}`,
        jobId
      }, asJson);
      return;
    }
    const job = found.job;
    if (command === "status" || command === "cancel") {
      // 轻量输出：不携带 rendered/rawOutput
      emit(
        {
          status: job?.status ?? "unknown",
          jobId,
          summary: job?.summary ?? `job ${jobId}`,
          kind: job?.kind ?? null,
          target: job?.target ?? null,
          host: job?.host ?? null,
          completedAt: job?.completedAt ?? null
        },
        asJson
      );
      process.exit(EXIT.OK);
    }
    emit(
      {
        status: "completed",
        kind: "result",
        jobId,
        summary: job?.summary ?? `job ${jobId}`,
        job: flags.full ? job : truncateForDisplay(job, process.env),
        meta: found.meta
      },
      asJson
    );
    process.exit(EXIT.OK);
  }

  if (["plan", "review", "adversarial-review", "rescue", "setup"].includes(command)) {
    if (flags.background || flags.wait) {
      fail(EXIT.USAGE, {
        errorCode: "not_implemented",
        errorMessage: "--background/--wait are Phase 5 (background workers); run foreground for now"
      }, asJson);
      return;
    }
    // No env: the adapter builds the child env from the allowlist-filtered
    // inherited layer (+ NESTED marker), so the host's full env — including
    // other agents' API keys — never reaches the target agent context.
    const result = await runDelegation({
      host: gate.host,
      target,
      command,
      prompt: flags.prompt ?? rest.join(" "),
      model: flags.model,
      write: flags.write,
      cwd: flags.cwd || process.cwd()
    });
    const code =
      result.status === "completed"
        ? EXIT.OK
        : result.errorCode === "not_ready"
          ? EXIT.NOT_READY
          : result.errorCode === "usage"
            ? EXIT.USAGE
            : EXIT.FAIL;
    emit(truncateForDisplay(result, process.env), true);
    process.exit(code);
  }

  fail(EXIT.USAGE, { errorCode: "usage", errorMessage: `Unhandled command: ${command}`, rendered: usageText() }, asJson);
}

main().catch((error) => {
  fail(EXIT.FAIL, {
    errorCode: "crash",
    errorMessage: error instanceof Error ? error.message : String(error)
  }, true);
});
