import { loadLockpickConfig, type ResolvedLockpickConfig, renderLockpickCommand } from "../config";
import { FileLockRegistry, type FileLockRegistryOptions } from "./registry";
import {
  createUnknownSessionProbe,
  lockOwnerSessionId,
  lockOwnerSource,
  probeCodexSessionLiveness,
} from "./session";
import type {
  ClassifiedLock,
  LockCommand,
  LockConflict,
  LockOperationResult,
  LockResource,
} from "./types";
import { LockCommandError } from "./types";

export interface LockCommandOutput {
  exitCode: number;
  text: string;
  json?: unknown;
}

export interface ExecuteLockCommandOptions {
  cwd?: string;
  config?: ResolvedLockpickConfig;
  registryOptions?: Partial<FileLockRegistryOptions>;
}

export async function executeLockCommand(
  command: LockCommand,
  cwdOrOptions: string | ExecuteLockCommandOptions = process.cwd(),
): Promise<LockCommandOutput> {
  const options = typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : cwdOrOptions;
  const config =
    options.config ?? (await loadLockpickConfig({ cwd: options.cwd ?? process.cwd() }));
  const registry = new FileLockRegistry({
    cwd: config.root,
    lockRoot: config.lockRoot,
    ownerEnvKeys: config.owner.envKeys,
    supervisorEnvKeys: config.owner.supervisorEnvKeys,
    fallbackOwnerPrefix: config.owner.fallbackPrefix,
    defaultTtlMs: config.defaults.ttlMs,
    maxTtlMs: config.defaults.maxTtlMs,
    unknownLivenessGraceMs: config.defaults.unknownLivenessGraceMs,
    sessionProbe:
      config.liveness.adapter === "codex" ? probeCodexSessionLiveness : createUnknownSessionProbe(),
    ...options.registryOptions,
  });
  const results: LockOperationResult[] = [];
  switch (command.name) {
    case "acquire":
      results.push(
        await registry.acquire({
          paths: command.paths,
          globs: command.globs,
          reason: command.reason,
          ttlMs: command.ttlMs,
          ownerSessionId: command.ownerSession,
        }),
      );
      break;
    case "expand":
      results.push(
        await registry.expand({
          lockId: command.lockId,
          paths: command.paths,
          globs: command.globs,
          ttlMs: command.ttlMs,
          ownerSessionId: command.ownerSession,
        }),
      );
      break;
    case "refresh":
      for (const lockId of requireLockIds(command.lockIds, "refresh")) {
        results.push(await registry.refresh(lockId, command.ttlMs, command.ownerSession));
      }
      break;
    case "release":
      for (const lockId of requireLockIds(command.lockIds, "release")) {
        results.push(await registry.release(lockId, command.ownerSession));
      }
      break;
    case "status":
      results.push(await registry.status({ paths: command.paths, globs: command.globs }));
      break;
    case "prune":
      results.push(await registry.prune(command.dryRun));
      break;
    case "identify":
      results.push(registry.identify(command.ownerSession));
      break;
    case "git-begin":
      for (const lockId of command.refreshLockIds) {
        results.push(await registry.refresh(lockId, command.ttlMs, command.ownerSession));
      }
      results.push(
        await registry.acquire({
          includeGitIndex: true,
          reason: command.reason,
          ttlMs: command.ttlMs,
          ownerSessionId: command.ownerSession,
        }),
      );
      break;
    case "git-end":
      for (const lockId of requireLockIds(command.lockIds, "git end")) {
        results.push(await registry.release(lockId, command.ownerSession));
      }
      for (const lockId of command.releaseLockIds) {
        results.push(await registry.release(lockId, command.ownerSession));
      }
      break;
  }

  const result = renderCommandResults(command, results, config);
  return {
    exitCode: result.exitCode,
    text: result.text,
    json: result.json,
  };
}

function renderCommandResults(
  command: LockCommand,
  results: LockOperationResult[],
  config: ResolvedLockpickConfig,
): { exitCode: number; text: string; json: unknown } {
  const exitCode = results.find((result) => result.exitCode !== 0)?.exitCode ?? 0;
  const isBatch = results.length !== 1;
  const firstResult = results[0];
  const emptyJson = { kind: "batch", exitCode, results: [] };
  const fullJson = isBatch ? { kind: "batch", exitCode, results } : (firstResult ?? emptyJson);
  const json =
    command.verbose === true
      ? fullJson
      : isBatch
        ? {
            kind: "batch",
            exitCode,
            results: results.map((result) => compactLockJson(result)),
          }
        : firstResult
          ? compactLockJson(firstResult)
          : emptyJson;
  return {
    exitCode,
    text:
      command.idOnly && exitCode === 0
        ? renderLockIds(command, results)
        : renderResults(results, command.verbose === true, config),
    json,
  };
}

function compactLockJson(result: LockOperationResult): Record<string, unknown> {
  switch (result.kind) {
    case "acquired":
    case "refreshed":
    case "released":
      return {
        kind: result.kind,
        exitCode: result.exitCode,
        lock_id: result.lock?.lockId ?? null,
      };
    case "conflict":
      return {
        kind: "conflict",
        exitCode: result.exitCode,
        suggested_action: result.suggestedAction,
        conflicts: (result.conflicts ?? []).map((conflict) => ({
          lock_id: conflict.lock.lockId,
          owner: lockOwnerSessionId(conflict.lock.owner),
          reason: conflict.lock.reason,
          status: conflict.status,
          resources: conflict.resources.map((resource) => resource.value),
        })),
      };
    case "status":
      return {
        kind: "status",
        exitCode: result.exitCode,
        lock_count: result.locks?.length ?? 0,
        lock_ids: (result.locks ?? []).map((item) => item.lock.lockId),
      };
    case "pruned":
      return {
        kind: "pruned",
        exitCode: result.exitCode,
        dry_run: Boolean(result.dryRun),
        pruned_count: result.pruned?.length ?? 0,
        pruned_lock_ids: (result.pruned ?? []).map((lock) => lock.lockId),
      };
    case "identified":
      return {
        kind: "identified",
        exitCode: result.exitCode,
        session_id: result.owner ? lockOwnerSessionId(result.owner) : null,
      };
  }
}

function renderResults(
  results: LockOperationResult[],
  verbose: boolean,
  config: ResolvedLockpickConfig,
): string {
  return results.map((result) => renderLockResult(result, verbose, config)).join("\n");
}

function renderLockIds(command: LockCommand, results: LockOperationResult[]): string {
  const idResults =
    command.name === "git-begin"
      ? results.filter((result) => result.kind === "acquired")
      : results.filter((result) => result.lock);
  const statusIds = results.flatMap((result) =>
    result.kind === "status" ? (result.locks ?? []).map((item) => item.lock.lockId) : [],
  );
  const prunedIds = results.flatMap((result) =>
    result.kind === "pruned" ? (result.pruned ?? []).map((lock) => lock.lockId) : [],
  );
  const lockIds = idResults.map((result) => result.lock?.lockId).filter((id): id is string => !!id);
  const ids = [...statusIds, ...prunedIds, ...lockIds];
  return ids.join("\n");
}

function requireLockIds(lockIds: string[], action: string): string[] {
  if (lockIds.length === 0) {
    throw new LockCommandError(`At least one lock id is required for ${action}.`, 2);
  }
  return lockIds;
}

export function renderLockResult(
  result: LockOperationResult,
  verbose = false,
  config?: ResolvedLockpickConfig,
): string {
  switch (result.kind) {
    case "acquired":
      if (!verbose) return `lock acquired: ${result.lock?.lockId ?? "<unknown>"}`;
      return [
        `lock acquired: ${result.lock?.lockId ?? "<unknown>"}`,
        ...renderResources(result.lock?.resources ?? []),
      ].join("\n");
    case "conflict":
      return renderConflict(result.conflicts ?? [], result.suggestedAction, config);
    case "refreshed":
      return `lock refreshed: ${result.lock?.lockId ?? "<unknown>"}`;
    case "released":
      return `lock released: ${result.lock?.lockId ?? "<unknown>"}`;
    case "status":
      return verbose ? renderStatus(result.locks ?? []) : renderStatusSummary(result.locks ?? []);
    case "pruned":
      return result.dryRun
        ? `prunable locks: ${result.pruned?.length ?? 0}`
        : `pruned locks: ${result.pruned?.length ?? 0}`;
    case "identified":
      if (!verbose) return `owner session: ${ownerSessionText(result.owner)}`;
      return [
        `owner session: ${ownerSessionText(result.owner)}`,
        `source: ${result.owner ? (lockOwnerSource(result.owner) ?? "<unknown>") : "<unknown>"}`,
        `hostname: ${result.owner?.hostname ?? "<unknown>"}`,
        `pid: ${result.owner?.pid ?? "<unknown>"}`,
      ].join("\n");
  }
}

function renderResources(resources: LockResource[]): string[] {
  if (resources.length === 0) return ["resources: none"];
  return ["resources:", ...resources.map((resource) => `- ${resource.kind} ${resource.value}`)];
}

function renderConflict(
  conflicts: LockConflict[],
  action: string,
  config: ResolvedLockpickConfig | undefined,
): string {
  const first = conflicts[0];
  if (!first) return "lock conflict";
  const resourceText = first.resources.map((resource) => resource.value).join(", ");
  const expiresAt = Date.parse(first.lock.leaseExpiresAt);
  const leaseText = Number.isFinite(expiresAt)
    ? `expires ${new Date(expiresAt).toISOString().replace(/\.\d{3}Z$/, "Z")}`
    : "lease expiry unknown";
  const pruneCommand = config ? renderLockpickCommand(config, ["prune"]) : "lockpick prune";
  const next =
    action === "prune_then_retry"
      ? `${pruneCommand}, then retry`
      : "work on unrelated unlocked files, then retry";
  return [
    `lock conflict: ${resourceText}`,
    `held by: ${lockOwnerSessionId(first.lock.owner)}`,
    `reason: ${first.lock.reason}`,
    `status: ${first.status}, ${leaseText}`,
    `next: ${next}`,
  ].join("\n");
}

function renderStatus(locks: ClassifiedLock[]): string {
  if (locks.length === 0) return "No active locks.";
  return locks
    .map((item) =>
      [
        `lock: ${item.lock.lockId}`,
        `status: ${item.status}`,
        `owner: ${lockOwnerSessionId(item.lock.owner)}`,
        `reason: ${item.lock.reason}`,
        ...renderResources(item.lock.resources),
      ].join("\n"),
    )
    .join("\n\n");
}

function ownerSessionText(owner: LockOperationResult["owner"]): string {
  return owner ? lockOwnerSessionId(owner) : "<unknown>";
}

function renderStatusSummary(locks: ClassifiedLock[]): string {
  if (locks.length === 0) return "No active locks.";
  return `active locks: ${locks.length}`;
}
