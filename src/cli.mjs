#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseCliArgv, usageText } from "./core/args.mjs";
import { EXIT } from "./core/exit-codes.mjs";
import { allowedTargets, isHostId, isTargetId } from "./core/ids.mjs";
import { runInstall, resolveInstallTargets, runUninstall } from "./core/install.mjs";
import { cleanupJobs, listJobs, lookupJob, newJobId, stateReport } from "./core/jobs.mjs";
import { runDoctor } from "./core/doctor.mjs";
import { packageRoot } from "./core/paths.mjs";
import { runDelegation, persistJob } from "./core/run.mjs";
import { terminateProcessTree } from "./core/process.mjs";
import { evaluateGates } from "./core/safety.mjs";

const VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

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

  if (flags.worker !== null) {
    if (flags.worker === "") {
      fail(EXIT.USAGE, { errorCode: "usage", errorMessage: "--worker requires a <job-id>" }, asJson);
      return;
    }
    if (flags.background) {
      fail(EXIT.USAGE, { errorCode: "usage", errorMessage: "--worker and --background are mutually exclusive" }, asJson);
      return;
    }
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
    if (command === "cancel") {
      const job = found.job;
      if (job.status === "running") {
        if (!Number.isInteger(job.pid)) {
          // 无 pid 的 running 记录（异常残留）无法 kill，由 TTL 清理兜底
          emit(
            { status: "completed", kind: "cancel", jobId, summary: "Job is running but has no pid; left for TTL cleanup", job },
            asJson
          );
          process.exit(EXIT.OK);
        }
        const killed = terminateProcessTree(job.pid, "SIGTERM", { allowPidFallback: true });
        // 复查竞态：worker 恰好在 kill 前写入 completed → 保留 completed 记录
        const latest = lookupJob(jobId);
        if (!latest || latest.missing || latest.corrupt || latest.job?.status !== "running") {
          emit(
            {
              status: "completed",
              kind: "cancel",
              jobId,
              summary: `Job already ${latest?.job?.status ?? "gone"}; cancel no-op`,
              job: latest?.job ?? job
            },
            asJson
          );
          process.exit(EXIT.OK);
        }
        const cancelled = { ...latest.job, status: "cancelled", cancelledAt: new Date().toISOString() };
        fs.writeFileSync(latest.meta.path, `${JSON.stringify(cancelled, null, 2)}\n`, "utf8");
        emit(
          {
            status: "completed",
            kind: "cancel",
            jobId,
            summary: killed ? "cancelled" : `SIGTERM failed for pid ${job.pid}; marked cancelled`,
            job: cancelled
          },
          asJson
        );
        process.exit(EXIT.OK);
      }
      // 已 completed/failed/cancelled → no-op
      emit({ status: "completed", kind: "cancel", jobId, summary: `Job already ${job.status}; cancel no-op`, job }, asJson);
      process.exit(EXIT.OK);
    }
    emit(
      {
        status: "completed",
        kind: command,
        jobId,
        summary: found.job?.summary ?? `job ${jobId}`,
        job: found.job,
        meta: found.meta
      },
      asJson
    );
    process.exit(EXIT.OK);
  }

  if (["plan", "review", "adversarial-review", "rescue", "setup"].includes(command)) {
    if (flags.wait && !flags.background) {
      fail(EXIT.USAGE, {
        errorCode: "usage",
        errorMessage: "--wait requires --background"
      }, asJson);
      return;
    }
    if (flags.background) {
      // 父进程是 running 记录的唯一写者；worker 只覆盖最终记录。
      // 子进程 env 透传（不注入 NESTED）；detached 使其自成进程组（kill(-pid) 可用）。
      const jobId = newJobId();
      const childArgs = process.argv.slice(2).filter((a) => a !== "--background" && a !== "--wait");
      const cliPath = path.join(packageRoot(), "src", "cli.mjs");
      const child = spawn(process.execPath, [cliPath, ...childArgs, "--worker", jobId], {
        detached: true,
        stdio: "ignore",
        env: process.env
      });
      child.on("error", () => {
        // spawn 失败：running 记录留给 TTL 清理兜底
      });
      const host = gate.host ?? "unknown";
      persistJob(
        {
          id: jobId,
          status: "running",
          kind: command === "adversarial-review" ? "adversarial-review" : command,
          target,
          host,
          jobId,
          pid: child.pid,
          startedAt: new Date().toISOString(),
          summary: "running"
        },
        { host, target, cwd: flags.cwd || process.cwd(), env: process.env }
      );
      if (!flags.wait) {
        emit({ status: "running", jobId }, asJson);
      }
      if (flags.wait) {
        const timeoutMs =
          Number(process.env.AGENT_BRIDGE_WAIT_TIMEOUT_MS) > 0
            ? Number(process.env.AGENT_BRIDGE_WAIT_TIMEOUT_MS)
            : 10 * 60 * 1000;
        const deadline = Date.now() + timeoutMs;
        let finalJob = null;
        while (Date.now() < deadline) {
          const found = lookupJob(jobId);
          if (found && !found.missing && !found.corrupt && found.job?.status !== "running") {
            finalJob = found.job;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (!finalJob) {
          fail(EXIT.FAIL, {
            errorCode: "wait_timeout",
            errorMessage: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for job ${jobId}`,
            jobId,
            kind: command === "adversarial-review" ? "adversarial-review" : command,
            target,
            host: gate.host ?? "unknown"
          }, asJson);
          return;
        }
        const code =
          finalJob.status === "completed"
            ? EXIT.OK
            : finalJob.errorCode === "not_ready"
              ? EXIT.NOT_READY
              : finalJob.errorCode === "usage"
                ? EXIT.USAGE
                : EXIT.FAIL;
        emit(finalJob, true);
        process.exit(code);
      }
      process.exit(EXIT.OK);
    }
    const result = await runDelegation({
      host: gate.host,
      target,
      command,
      prompt: flags.prompt ?? rest.join(" "),
      model: flags.model,
      write: flags.write,
      cwd: flags.cwd || process.cwd(),
      env: process.env,
      jobId: flags.worker !== null ? flags.worker : undefined
    });
    const code =
      result.status === "completed"
        ? EXIT.OK
        : result.errorCode === "not_ready"
          ? EXIT.NOT_READY
          : result.errorCode === "usage"
            ? EXIT.USAGE
            : EXIT.FAIL;
    emit(result, true);
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
