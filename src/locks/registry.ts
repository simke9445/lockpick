import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, pathExists, readText } from "../io";
import { formatJsonArtifact } from "../json";
import { conflictingResources, resourceSetsConflict } from "./matching";
import { normalizeLockResources, unionResources } from "./resources";
import {
  createUnknownSessionProbe,
  type IdentifyOwnerOptions,
  identifyLockOwner,
  lockOwnerSessionId,
  type OwnerHarness,
  type SessionLivenessProbe,
} from "./session";
import type {
  ClassifiedLock,
  FileLockRecord,
  LockConflict,
  LockOperationResult,
  LockResource,
} from "./types";
import {
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_UNKNOWN_LIVENESS_GRACE_MS,
  LOCK_SCHEMA_VERSION,
  LockCommandError,
  MAX_LOCK_TTL_MS,
  REGISTRY_MUTEX_STALE_MS,
} from "./types";

export interface FileLockRegistryOptions {
  cwd?: string;
  lockRoot?: string;
  sessionProbe?: SessionLivenessProbe;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  ownerEnvKeys?: readonly string[];
  ownerHarnesses?: readonly OwnerHarness[];
  supervisorEnvKeys?: readonly string[];
  fallbackOwnerPrefix?: string;
  defaultTtlMs?: number;
  maxTtlMs?: number;
  unknownLivenessGraceMs?: number;
}

export interface LockResourceRequest {
  paths?: string[];
  globs?: string[];
  includeGitIndex?: boolean;
}

export interface AcquireLockParams extends LockResourceRequest {
  reason: string;
  ttlMs?: number | null;
  ownerSessionId?: string | null;
}

export interface ExpandLockParams extends LockResourceRequest {
  lockId: string;
  ttlMs?: number | null;
  ownerSessionId?: string | null;
}

export class FileLockRegistry {
  private readonly cwd: string;
  private readonly lockRoot: string;
  private readonly activeDir: string;
  private readonly mutexDir: string;
  private readonly eventsPath: string;
  private readonly sessionProbe: SessionLivenessProbe;
  private readonly now: () => Date;
  private readonly env: NodeJS.ProcessEnv;
  private readonly ownerEnvKeys: readonly string[] | undefined;
  private readonly ownerHarnesses: readonly OwnerHarness[] | undefined;
  private readonly supervisorEnvKeys: readonly string[] | undefined;
  private readonly fallbackOwnerPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly unknownLivenessGraceMs: number;

  constructor(options: FileLockRegistryOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.lockRoot = path.isAbsolute(options.lockRoot ?? "")
      ? (options.lockRoot as string)
      : path.join(this.cwd, options.lockRoot ?? ".lockpick/locks");
    this.activeDir = path.join(this.lockRoot, "active");
    this.mutexDir = path.join(this.lockRoot, ".mutex");
    this.eventsPath = path.join(this.lockRoot, "events.jsonl");
    this.sessionProbe = options.sessionProbe ?? createUnknownSessionProbe();
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
    this.ownerEnvKeys = options.ownerEnvKeys;
    this.ownerHarnesses = options.ownerHarnesses;
    this.supervisorEnvKeys = options.supervisorEnvKeys;
    this.fallbackOwnerPrefix = options.fallbackOwnerPrefix ?? "lockpick";
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.maxTtlMs = options.maxTtlMs ?? MAX_LOCK_TTL_MS;
    this.unknownLivenessGraceMs =
      options.unknownLivenessGraceMs ?? DEFAULT_UNKNOWN_LIVENESS_GRACE_MS;
  }

  identify(ownerSessionId?: string | null): LockOperationResult {
    return {
      kind: "identified",
      exitCode: 0,
      suggestedAction: "identified",
      owner: this.identifyOwner(ownerSessionId ?? null),
    };
  }

  async acquire(params: AcquireLockParams): Promise<LockOperationResult> {
    const resources = await this.normalizeRequestedResources(params);
    if (resources.length === 0) {
      throw new LockCommandError("At least one path, glob, or git resource is required.", 2);
    }
    const reason = normalizedReason(params.reason);
    const ttlMs = this.normalizeTtl(params.ttlMs);
    const now = this.now();
    const owner = this.identifyOwner(params.ownerSessionId ?? null);

    return this.withMutex(async () => {
      const locks = await this.readActiveLocks();
      const conflicts = await this.findConflicts(resources, locks, now);
      if (conflicts.length > 0) return conflictResult(resources, conflicts);

      const lock: FileLockRecord = {
        schemaVersion: LOCK_SCHEMA_VERSION,
        lockId: newLockId(now),
        state: "held",
        resources,
        owner,
        reason,
        createdAt: iso(now),
        lastHeartbeatAt: iso(now),
        leaseExpiresAt: iso(new Date(now.getTime() + ttlMs)),
        ttlMs,
      };
      await this.writeLock(lock);
      await this.appendEvent("acquired", lock, { resources });
      return {
        kind: "acquired",
        exitCode: 0,
        suggestedAction: "acquired",
        lock,
        resources,
      };
    });
  }

  async expand(params: ExpandLockParams): Promise<LockOperationResult> {
    const requested = await this.normalizeRequestedResources(params);
    if (requested.length === 0) {
      throw new LockCommandError("At least one path or glob is required for lock expansion.", 2);
    }
    const ttlMs =
      params.ttlMs === null || params.ttlMs === undefined ? null : this.normalizeTtl(params.ttlMs);
    const now = this.now();

    return this.withMutex(async () => {
      const locks = await this.readActiveLocks();
      const existing = locks.find((lock) => lock.lockId === params.lockId);
      if (!existing) throw new LockCommandError(`Lock not found: ${params.lockId}`, 2);
      this.assertLockOwner(existing, params.ownerSessionId ?? null);

      const resources = unionResources(existing.resources, requested);
      const conflicts = await this.findConflicts(
        resources,
        locks.filter((lock) => lock.lockId !== existing.lockId),
        now,
      );
      if (conflicts.length > 0) return conflictResult(resources, conflicts);

      const nextTtlMs = ttlMs ?? existing.ttlMs;
      const lock: FileLockRecord = {
        ...existing,
        resources,
        ttlMs: nextTtlMs,
        lastHeartbeatAt: iso(now),
        leaseExpiresAt: iso(new Date(now.getTime() + nextTtlMs)),
      };
      await this.writeLock(lock);
      await this.appendEvent("expanded", lock, { resources });
      return {
        kind: "refreshed",
        exitCode: 0,
        suggestedAction: "refreshed",
        lock,
        resources,
      };
    });
  }

  async refresh(
    lockId: string,
    ttlMsInput?: number | null,
    ownerSessionId?: string | null,
  ): Promise<LockOperationResult> {
    const now = this.now();
    return this.withMutex(async () => {
      const lock = await this.requireLock(lockId);
      this.assertLockOwner(lock, ownerSessionId ?? null);
      const ttlMs =
        ttlMsInput === null || ttlMsInput === undefined
          ? lock.ttlMs
          : this.normalizeTtl(ttlMsInput);
      const refreshed: FileLockRecord = {
        ...lock,
        ttlMs,
        lastHeartbeatAt: iso(now),
        leaseExpiresAt: iso(new Date(now.getTime() + ttlMs)),
      };
      await this.writeLock(refreshed);
      await this.appendEvent("refreshed", refreshed, {});
      return {
        kind: "refreshed",
        exitCode: 0,
        suggestedAction: "refreshed",
        lock: refreshed,
      };
    });
  }

  async release(lockId: string, ownerSessionId?: string | null): Promise<LockOperationResult> {
    return this.withMutex(async () => {
      const lock = await this.requireLock(lockId);
      this.assertLockOwner(lock, ownerSessionId ?? null);
      await fs.rm(this.lockPath(lockId), { force: true });
      await this.appendEvent("released", lock, {});
      return {
        kind: "released",
        exitCode: 0,
        suggestedAction: "released",
        lock,
      };
    });
  }

  async status(request: LockResourceRequest = {}): Promise<LockOperationResult> {
    const resources = await this.normalizeRequestedResources(request, false);
    const now = this.now();
    const locks = await this.readActiveLocks();
    const classified = await Promise.all(locks.map(async (lock) => this.classifyLock(lock, now)));
    const matching =
      resources.length === 0
        ? classified
        : classified.filter((item) => resourceSetsConflict(resources, item.lock.resources));
    return {
      kind: "status",
      exitCode: 0,
      suggestedAction: "status",
      locks: matching,
      resources,
    };
  }

  async prune(dryRun = false): Promise<LockOperationResult> {
    const now = this.now();
    return this.withMutex(async () => {
      const locks = await this.readActiveLocks();
      const classified = await Promise.all(locks.map(async (lock) => this.classifyLock(lock, now)));
      const pruned = classified
        .filter((item) => item.status === "reclaimable")
        .map((item) => item.lock);
      if (dryRun) {
        return {
          kind: "pruned",
          exitCode: 0,
          suggestedAction: "pruned",
          pruned,
          dryRun: true,
        };
      }
      for (const lock of pruned) {
        await fs.rm(this.lockPath(lock.lockId), { force: true });
        await this.appendEvent("pruned", lock, {});
      }
      return {
        kind: "pruned",
        exitCode: 0,
        suggestedAction: "pruned",
        pruned,
        dryRun: false,
      };
    });
  }

  private identifyOwner(ownerSessionId: string | null) {
    const options: IdentifyOwnerOptions = {
      cwd: this.cwd,
      ownerSessionId,
      env: this.env,
      fallbackPrefix: this.fallbackOwnerPrefix,
    };
    if (this.ownerEnvKeys) options.envKeys = this.ownerEnvKeys;
    if (this.ownerHarnesses) options.harnesses = this.ownerHarnesses;
    if (this.supervisorEnvKeys) options.supervisorEnvKeys = this.supervisorEnvKeys;
    return identifyLockOwner(options);
  }

  private async normalizeRequestedResources(
    request: LockResourceRequest,
    requireAny = true,
  ): Promise<LockResource[]> {
    const resources = await normalizeLockResources({
      cwd: this.cwd,
      paths: request.paths ?? [],
      globs: request.globs ?? [],
      includeGitIndex: Boolean(request.includeGitIndex),
    });
    if (requireAny && resources.length === 0) {
      throw new LockCommandError("At least one lock resource is required.", 2);
    }
    return resources;
  }

  private async findConflicts(
    resources: LockResource[],
    locks: FileLockRecord[],
    now: Date,
  ): Promise<LockConflict[]> {
    const conflicts: LockConflict[] = [];
    for (const lock of locks) {
      const overlapping = conflictingResources(resources, lock.resources);
      if (overlapping.length === 0) continue;
      const classified = await this.classifyLock(lock, now);
      conflicts.push({
        lock,
        status: classified.status,
        liveness: classified.liveness,
        resources: overlapping,
      });
    }
    return conflicts;
  }

  private async classifyLock(lock: FileLockRecord, now: Date): Promise<ClassifiedLock> {
    const expiresAt = Date.parse(lock.leaseExpiresAt);
    if (Number.isFinite(expiresAt) && now.getTime() <= expiresAt) {
      return { lock, status: "held", liveness: null };
    }

    const liveness = await this.sessionProbe(lock.owner, now);
    if (liveness.status === "live") return { lock, status: "expired-live", liveness };
    if (liveness.status === "dead") return { lock, status: "reclaimable", liveness };

    const unknownAgeMs = Number.isFinite(expiresAt)
      ? now.getTime() - expiresAt
      : Number.POSITIVE_INFINITY;
    if (unknownAgeMs <= this.unknownLivenessGraceMs) {
      return { lock, status: "expired-unknown", liveness };
    }
    return { lock, status: "reclaimable", liveness };
  }

  private async readActiveLocks(): Promise<FileLockRecord[]> {
    await ensureDir(this.activeDir);
    const entries = await fs.readdir(this.activeDir, { withFileTypes: true });
    const locks: FileLockRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const raw = await readText(path.join(this.activeDir, entry.name));
      locks.push(JSON.parse(raw) as FileLockRecord);
    }
    return locks.sort((left, right) => left.lockId.localeCompare(right.lockId));
  }

  private async requireLock(lockId: string): Promise<FileLockRecord> {
    const lockPath = this.lockPath(lockId);
    if (!(await pathExists(lockPath))) throw new LockCommandError(`Lock not found: ${lockId}`, 2);
    return JSON.parse(await readText(lockPath)) as FileLockRecord;
  }

  private async writeLock(lock: FileLockRecord): Promise<void> {
    await ensureDir(this.activeDir);
    const target = this.lockPath(lock.lockId);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${formatJsonArtifact(lock)}\n`, "utf8");
    await fs.rename(temp, target);
  }

  private async appendEvent(
    type: string,
    lock: FileLockRecord,
    details: Record<string, unknown>,
  ): Promise<void> {
    await ensureDir(this.lockRoot);
    const event = {
      timestamp: iso(this.now()),
      type,
      lockId: lock.lockId,
      owner: lock.owner,
      reason: lock.reason,
      ...details,
    };
    await fs.appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  private lockPath(lockId: string): string {
    if (!/^[A-Za-z0-9_.:-]+$/.test(lockId)) {
      throw new LockCommandError(`Invalid lock id: ${lockId}`, 2);
    }
    return path.join(this.activeDir, `${lockId}.json`);
  }

  private async withMutex<T>(operation: () => Promise<T>): Promise<T> {
    await ensureDir(this.lockRoot);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fs.mkdir(this.mutexDir);
        await fs.writeFile(
          path.join(this.mutexDir, "owner.json"),
          `${JSON.stringify({
            hostname: os.hostname(),
            pid: process.pid,
            createdAt: iso(this.now()),
          })}\n`,
          "utf8",
        );
        try {
          return await operation();
        } finally {
          await fs.rm(this.mutexDir, { recursive: true, force: true });
        }
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        if (await this.reclaimStaleMutex()) continue;
        await sleep(25);
      }
    }
    throw new LockCommandError("Timed out waiting for lock registry mutex.", 2);
  }

  private async reclaimStaleMutex(): Promise<boolean> {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(this.mutexDir);
    } catch {
      return true;
    }
    if (this.now().getTime() - stat.mtimeMs <= REGISTRY_MUTEX_STALE_MS) return false;
    await fs.rm(this.mutexDir, { recursive: true, force: true });
    return true;
  }

  private normalizeTtl(ttlMs: number | null | undefined): number {
    const value = ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(value) || value <= 0) {
      throw new LockCommandError(`Lock TTL must be a positive integer: ${value}`, 2);
    }
    if (value > this.maxTtlMs) {
      throw new LockCommandError(`Lock TTL must be <= ${this.maxTtlMs}.`, 2);
    }
    return value;
  }

  private assertLockOwner(lock: FileLockRecord, ownerSessionId: string | null | undefined): void {
    const caller = this.identifyOwner(ownerSessionId ?? null);
    const callerSessionId = lockOwnerSessionId(caller);
    const lockOwnerId = lockOwnerSessionId(lock.owner);
    if (callerSessionId === lockOwnerId) return;
    throw new LockCommandError(
      `Lock ${lock.lockId} is owned by ${lockOwnerId}; current owner is ${callerSessionId}.`,
      3,
    );
  }
}

function conflictResult(resources: LockResource[], conflicts: LockConflict[]): LockOperationResult {
  return {
    kind: "conflict",
    exitCode: 3,
    suggestedAction: conflicts.every((conflict) => conflict.status === "reclaimable")
      ? "prune_then_retry"
      : "retry_later",
    resources,
    conflicts,
  };
}

function normalizedReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) throw new LockCommandError("Lock reason is required.", 2);
  return trimmed;
}

function newLockId(now: Date): string {
  return `lock_${iso(now).replace(/[-:]/g, "")}_${randomBytes(4).toString("hex")}`;
}

function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
