import { promises as fs } from "node:fs";
import path from "node:path";
import { loadLockpickConfig, renderLockpickCommand } from "../config";
import { runInstall } from "../install";
import { pathExists } from "../io";
import { REGISTRY_MUTEX_STALE_MS } from "../locks/types";

export interface DoctorCommandOptions {
  json: boolean;
  verbose: boolean;
}

type DoctorStatus = "ok" | "warn" | "error";

interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  next?: string;
  details?: unknown;
}

interface DoctorResult {
  kind: "doctor";
  schema_version: 1;
  ok: boolean;
  exitCode: number;
  summary: Record<DoctorStatus, number>;
  checks: DoctorCheck[];
}

export async function runDoctor(options: DoctorCommandOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const config = await loadLockpickConfig();

  const configCheck: DoctorCheck = {
    id: "config",
    status: config.configFound ? "ok" : "warn",
    message: config.configFound ? "config file found" : "config file missing; defaults are active",
  };
  if (!config.configFound) configCheck.next = renderLockpickCommand(config, ["install", "--check"]);
  checks.push(configCheck);

  checks.push(
    await pathCheck("lock_root", config.lockRoot, "lock root exists", "lock root missing"),
  );
  checks.push(
    await pathCheck(
      "active_dir",
      path.join(config.lockRoot, "active"),
      "active lock directory exists",
      "active lock directory missing",
    ),
  );
  checks.push(await mutexCheck(path.join(config.lockRoot, ".mutex")));

  const install = await runInstall({ root: config.root, check: true });
  const installDrift = install.changes.filter((change) =>
    ["would_create", "would_update", "reported"].includes(change.action),
  );
  const installCheck: DoctorCheck = {
    id: "install",
    status: installDrift.length === 0 ? "ok" : "warn",
    message:
      installDrift.length === 0
        ? "install support files are current"
        : `install drift detected: ${installDrift.length} change(s)`,
  };
  if (installDrift.length > 0) installCheck.next = renderLockpickCommand(config, ["install"]);
  if (options.verbose) installCheck.details = { changes: install.changes };
  checks.push(installCheck);

  const summary = summarizeChecks(checks);
  return {
    kind: "doctor",
    schema_version: 1,
    ok: summary.error === 0 && summary.warn === 0,
    exitCode: summary.error > 0 || summary.warn > 0 ? 1 : 0,
    summary,
    checks: options.verbose ? checks : checks.map(compactCheck),
  };
}

export function renderDoctorText(result: DoctorResult): string {
  if (result.ok) return "doctor: ok";
  return [
    "doctor: findings",
    ...result.checks
      .filter((check) => check.status !== "ok")
      .map((check) => `${check.status}: ${check.id} - ${check.message}${renderNext(check)}`),
  ].join("\n");
}

function renderNext(check: DoctorCheck): string {
  return check.next ? `\nnext: ${check.next}` : "";
}

async function pathCheck(
  id: string,
  target: string,
  okMessage: string,
  missingMessage: string,
): Promise<DoctorCheck> {
  const exists = await pathExists(target);
  return {
    id,
    status: exists ? "ok" : "warn",
    message: exists ? okMessage : missingMessage,
  };
}

async function mutexCheck(mutexPath: string): Promise<DoctorCheck> {
  try {
    const stat = await fs.stat(mutexPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      id: "registry_mutex",
      status: ageMs > REGISTRY_MUTEX_STALE_MS ? "warn" : "warn",
      message:
        ageMs > REGISTRY_MUTEX_STALE_MS
          ? "registry mutex appears stale"
          : "registry mutex currently exists",
      next: "retry the lock command; Lockpick reclaims stale mutexes automatically",
    };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        id: "registry_mutex",
        status: "ok",
        message: "registry mutex clear",
      };
    }
    return {
      id: "registry_mutex",
      status: "error",
      message: `could not inspect registry mutex: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function compactCheck(check: DoctorCheck): DoctorCheck {
  const { details: _details, ...compact } = check;
  return compact;
}

function summarizeChecks(checks: DoctorCheck[]): Record<DoctorStatus, number> {
  return {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    error: checks.filter((check) => check.status === "error").length,
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
