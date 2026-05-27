import { promises as fs } from "node:fs";
import path from "node:path";
import { loadLockpickConfig, type ResolvedLockpickConfig, renderLockpickCommand } from "../config";
import { type InitHarness, runInit } from "../init";
import { pathExists } from "../io";
import {
  CLAUDE_CODE_SESSION_ENV_KEY,
  CODEX_OWNER_ENV_KEY,
  identifyLockOwner,
  lockOwnerSessionId,
} from "../locks/session";
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
  if (!config.configFound) configCheck.next = renderLockpickCommand(config, ["init", "--check"]);
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
  checks.push(...(await harnessChecks(config.root, config)));

  const initHarness = doctorInitHarness(process.env);
  const init = await runInit({ root: config.root, check: true, harness: initHarness });
  const initDrift = init.changes.filter((change) =>
    ["would_create", "would_update", "reported"].includes(change.action),
  );
  const initCheck: DoctorCheck = {
    id: "init",
    status: initDrift.length === 0 ? "ok" : "warn",
    message:
      initDrift.length === 0
        ? "init support files are current"
        : `init drift detected: ${initDrift.length} change(s)`,
  };
  if (initDrift.length > 0) {
    initCheck.next =
      initHarness === "claude-code"
        ? renderLockpickCommand(config, ["init", "--harness", "claude-code"])
        : renderLockpickCommand(config, ["init"]);
  }
  if (options.verbose) initCheck.details = { changes: init.changes };
  checks.push(initCheck);

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

async function harnessChecks(root: string, config: ResolvedLockpickConfig): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const claudeSession = process.env[CLAUDE_CODE_SESSION_ENV_KEY]?.trim();
  if (claudeSession) {
    const hookPath = path.join(root, ".claude/hooks/lockpick-owner-env.mjs");
    const hookExists = await pathExists(hookPath);
    const hookCheck: DoctorCheck = {
      id: "claude_owner_hook",
      status: hookExists ? "ok" : "warn",
      message: hookExists
        ? "Claude Code owner hook exists"
        : "Claude Code owner hook missing; subagents will share session-scope ownership",
    };
    if (!hookExists) {
      hookCheck.next = renderLockpickCommand(config, ["init", "--harness", "claude-code"]);
    }
    checks.push(hookCheck);

    const owner = identifyLockOwner({
      cwd: root,
      env: process.env,
      envKeys: config.owner.envKeys,
      harnesses: config.owner.harnesses,
      supervisorEnvKeys: config.owner.supervisorEnvKeys,
      fallbackPrefix: config.owner.fallbackPrefix,
    });
    const sessionScope = owner.harness === "claude-code" && owner.harnessScope === "session";
    const ownerScopeCheck: DoctorCheck = {
      id: "owner_session_scope",
      status: sessionScope ? "warn" : "ok",
      message: sessionScope
        ? `owner ${lockOwnerSessionId(owner)} is Claude session-scoped, not agent-scoped`
        : "owner identity is agent-scoped or explicitly configured",
    };
    if (sessionScope) {
      ownerScopeCheck.next = renderLockpickCommand(config, ["init", "--harness", "claude-code"]);
    }
    checks.push(ownerScopeCheck);
  }

  const codexLikely =
    Boolean(process.env.CODEX_CI?.trim()) ||
    Boolean(process.env.CODEX_HOME?.trim()) ||
    Boolean(process.env[CODEX_OWNER_ENV_KEY]?.trim());
  if (codexLikely && !process.env[CODEX_OWNER_ENV_KEY]?.trim()) {
    checks.push({
      id: "codex_thread_id",
      status: "warn",
      message: `${CODEX_OWNER_ENV_KEY} is unavailable; Codex owner detection will fall back`,
    });
  }

  return checks;
}

function doctorInitHarness(env: NodeJS.ProcessEnv): InitHarness {
  return env[CLAUDE_CODE_SESSION_ENV_KEY]?.trim() ? "claude-code" : "auto";
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
