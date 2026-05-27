export const LOCK_SCHEMA_VERSION = 1;
export const DEFAULT_LOCK_TTL_MS = 600_000;
export const MAX_LOCK_TTL_MS = 1_800_000;
export const DEFAULT_UNKNOWN_LIVENESS_GRACE_MS = DEFAULT_LOCK_TTL_MS;
export const REGISTRY_MUTEX_STALE_MS = 30_000;
export const GIT_INDEX_RESOURCE = "@git/index";

export type LockResourceKind = "path" | "glob" | "git";
export type LockOwnerHarness = "codex" | "claude-code" | "lockpick";
export type LockOwnerHarnessScope = "agent" | "main" | "session" | "fallback";

export interface LockResource {
  kind: LockResourceKind;
  value: string;
}

export interface LockOwner {
  agentId: string;
  hostname: string;
  pid: number;
  cwd: string;
  source: string;
  harness?: LockOwnerHarness;
  harnessScope?: LockOwnerHarnessScope;
  rawSessionId?: string;
  harnessAgentId?: string;
  agentType?: string;
}

export type GenericLockOwner = LockOwner;

export interface FileLockRecord {
  schemaVersion: 1;
  lockId: string;
  state: "held";
  resources: LockResource[];
  owner: LockOwner;
  reason: string;
  createdAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  ttlMs: number;
}

export type LockLeaseStatus =
  | "held"
  | "expired-live"
  | "expired-unknown"
  | "reclaimable"
  | "released";

export type SessionLivenessStatus = "live" | "dead" | "unknown";

export interface SessionLiveness {
  status: SessionLivenessStatus;
  evidence: string;
}

export interface ClassifiedLock {
  lock: FileLockRecord;
  status: LockLeaseStatus;
  liveness: SessionLiveness | null;
}

export type SuggestedLockAction =
  | "acquired"
  | "retry_later"
  | "release_and_retry"
  | "prune_then_retry"
  | "released"
  | "refreshed"
  | "status"
  | "pruned"
  | "identified";

export interface LockConflict {
  lock: FileLockRecord;
  status: LockLeaseStatus;
  liveness: SessionLiveness | null;
  resources: LockResource[];
}

export interface LockOperationResult {
  kind: "acquired" | "conflict" | "refreshed" | "released" | "status" | "pruned" | "identified";
  exitCode: number;
  suggestedAction: SuggestedLockAction;
  lock?: FileLockRecord;
  locks?: ClassifiedLock[];
  resources?: LockResource[];
  conflicts?: LockConflict[];
  pruned?: FileLockRecord[];
  dryRun?: boolean;
  owner?: LockOwner;
}

interface LockCommandOutputOptions {
  json: boolean;
  idOnly: boolean;
  verbose?: boolean;
}

export type LockCommand =
  | ({
      name: "acquire";
      paths: string[];
      globs: string[];
      reason: string;
      ttlMs: number | null;
      agentId: string | null;
    } & LockCommandOutputOptions)
  | ({
      name: "expand";
      lockId: string;
      paths: string[];
      globs: string[];
      ttlMs: number | null;
      agentId: string | null;
    } & LockCommandOutputOptions)
  | ({
      name: "refresh";
      lockIds: string[];
      ttlMs: number | null;
      agentId: string | null;
    } & LockCommandOutputOptions)
  | ({
      name: "release";
      lockIds: string[];
      agentId: string | null;
    } & LockCommandOutputOptions)
  | ({
      name: "status";
      paths: string[];
      globs: string[];
    } & LockCommandOutputOptions)
  | ({ name: "prune"; dryRun: boolean } & LockCommandOutputOptions)
  | ({ name: "identify"; agentId: string | null } & LockCommandOutputOptions)
  | ({
      name: "git-begin";
      reason: string;
      ttlMs: number | null;
      agentId: string | null;
      refreshLockIds: string[];
    } & LockCommandOutputOptions)
  | ({
      name: "git-end";
      lockIds: string[];
      releaseLockIds: string[];
      agentId: string | null;
    } & LockCommandOutputOptions);

export class LockCommandError extends Error {
  readonly exitCode: number;
  readonly code: string;

  constructor(message: string, exitCode: number, code = "lock_command_error") {
    super(message);
    this.name = "LockCommandError";
    this.exitCode = exitCode;
    this.code = code;
  }
}
