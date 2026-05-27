import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LockOwner, LockOwnerHarness, LockOwnerHarnessScope, SessionLiveness } from "./types";
import { MAX_LOCK_TTL_MS } from "./types";

export const DEFAULT_OWNER_ENV_KEYS = ["LOCKPICK_OWNER_SESSION", "LOCKPICK_SESSION_ID"] as const;
export const DEFAULT_OWNER_HARNESSES = ["codex", "claude-code"] as const;
export type OwnerHarness = (typeof DEFAULT_OWNER_HARNESSES)[number];
export const CODEX_OWNER_ENV_KEY = "CODEX_THREAD_ID";
export const CLAUDE_CODE_SESSION_ENV_KEY = "CLAUDE_CODE_SESSION_ID";
export const DEFAULT_SUPERVISOR_ENV_KEYS = ["LOCKPICK_SUPERVISOR_SESSION_ID"] as const;
export const CODEX_SUPERVISOR_ENV_KEYS = ["CODEX_SUPERVISOR_THREAD_ID"] as const;

export interface IdentifyOwnerOptions {
  cwd: string;
  ownerSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
  envKeys?: readonly string[];
  harnesses?: readonly OwnerHarness[];
  supervisorEnvKeys?: readonly string[];
  fallbackPrefix?: string;
}

export type SessionLivenessProbe = (
  owner: LockOwner,
  now: Date,
) => Promise<SessionLiveness> | SessionLiveness;

export function detectSessionId(
  env: NodeJS.ProcessEnv = process.env,
  envKeys: readonly string[] = DEFAULT_OWNER_ENV_KEYS,
): { sessionId: string; source: string } | null {
  for (const key of envKeys) {
    const value = env[key]?.trim();
    if (value) return { sessionId: value, source: `env:${key}` };
  }
  return null;
}

export function detectHarnessSessionId(
  env: NodeJS.ProcessEnv = process.env,
  harnesses: readonly OwnerHarness[] = DEFAULT_OWNER_HARNESSES,
): Pick<LockOwner, "sessionId" | "source" | "harness" | "harnessScope" | "rawSessionId"> | null {
  for (const harness of harnesses) {
    switch (harness) {
      case "codex": {
        const value = env[CODEX_OWNER_ENV_KEY]?.trim();
        if (!value) break;
        return {
          sessionId: `codex:${value}`,
          source: `harness:codex:${CODEX_OWNER_ENV_KEY}`,
          harness: "codex",
          harnessScope: "agent",
          rawSessionId: value,
        };
      }
      case "claude-code": {
        const value = env[CLAUDE_CODE_SESSION_ENV_KEY]?.trim();
        if (!value) break;
        return {
          sessionId: `claude-code:${value}`,
          source: `harness:claude-code:${CLAUDE_CODE_SESSION_ENV_KEY}`,
          harness: "claude-code",
          harnessScope: "session",
          rawSessionId: value,
        };
      }
    }
  }
  return null;
}

export function identifyLockOwner(options: IdentifyOwnerOptions): LockOwner {
  const env = options.env ?? process.env;
  const envKeys = options.envKeys ?? DEFAULT_OWNER_ENV_KEYS;
  const harnesses = options.harnesses ?? DEFAULT_OWNER_HARNESSES;
  const supervisorEnvKeys = options.supervisorEnvKeys ?? DEFAULT_SUPERVISOR_ENV_KEYS;
  const explicit = options.ownerSessionId?.trim();
  const detected = explicit
    ? { sessionId: explicit, source: "explicit" }
    : detectSessionId(env, envKeys);
  const harnessDetected = detected ? null : detectHarnessSessionId(env, harnesses);
  const fallbackSessionId = fallbackOwnerId(options.fallbackPrefix ?? "lockpick");
  const resolved = detected ??
    harnessDetected ?? { sessionId: fallbackSessionId, source: "fallback" };
  const parsed = parseHarnessOwnerSessionId(resolved.sessionId);
  const supervisorSessionId = detectSupervisorSessionId(env, supervisorEnvKeys);
  const owner: LockOwner = {
    sessionId: resolved.sessionId,
    supervisorSessionId,
    hostname: os.hostname(),
    pid: process.pid,
    cwd: options.cwd,
    source: resolved.source,
  };
  const harness = harnessDetected?.harness ?? parsed.harness;
  const harnessScope = harnessDetected?.harnessScope ?? parsed.harnessScope;
  const rawSessionId = harnessDetected?.rawSessionId ?? parsed.rawSessionId;
  if (harness) owner.harness = harness;
  if (harnessScope) owner.harnessScope = harnessScope;
  if (rawSessionId) owner.rawSessionId = rawSessionId;
  if (parsed.agentId) owner.agentId = parsed.agentId;
  if (parsed.agentType) owner.agentType = parsed.agentType;
  return owner;
}

export function createUnknownSessionProbe(): SessionLivenessProbe {
  return () => ({ status: "unknown", evidence: "no liveness adapter configured" });
}

export async function probeCodexSessionLiveness(
  owner: LockOwner,
  now: Date,
): Promise<SessionLiveness> {
  const current = detectHarnessSessionId(process.env, ["codex"]);
  const sessionId = lockOwnerSessionId(owner);
  if (current && current.sessionId === sessionId) {
    return { status: "live", evidence: "owner matches current CODEX_THREAD_ID" };
  }
  if (sessionId.startsWith("unknown:")) {
    return { status: "unknown", evidence: "owner session id was not available" };
  }

  const indexPath = path.join(codexHome(), "session_index.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch {
    return { status: "unknown", evidence: `could not read ${indexPath}` };
  }

  const rawSessionId = owner.rawSessionId ?? sessionId.replace(/^codex:/, "");
  const entry = findSessionIndexEntry(raw, rawSessionId);
  if (!entry) return { status: "dead", evidence: `session missing from ${indexPath}` };

  const updatedAt = Date.parse(entry.updated_at);
  if (!Number.isFinite(updatedAt)) {
    return { status: "unknown", evidence: "session index entry has invalid updated_at" };
  }

  const ageMs = now.getTime() - updatedAt;
  if (ageMs <= MAX_LOCK_TTL_MS) {
    return { status: "live", evidence: `session updated ${Math.max(0, ageMs)}ms ago` };
  }
  return { status: "dead", evidence: `session last updated ${Math.max(0, ageMs)}ms ago` };
}

export function lockOwnerSessionId(owner: LockOwner): string {
  return owner.sessionId;
}

export function lockOwnerSource(owner: LockOwner): string | null {
  return owner.source;
}

function detectSupervisorSessionId(
  env: NodeJS.ProcessEnv,
  envKeys: readonly string[],
): string | null {
  for (const key of envKeys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function parseHarnessOwnerSessionId(sessionId: string): {
  harness?: LockOwnerHarness;
  harnessScope?: LockOwnerHarnessScope;
  rawSessionId?: string;
  agentId?: string;
  agentType?: string;
} {
  const codex = sessionId.match(/^codex:(.+)$/);
  if (codex?.[1]) {
    return {
      harness: "codex",
      harnessScope: "agent",
      rawSessionId: codex[1],
    };
  }

  const claudeAgent = sessionId.match(/^claude-code:([^:]+):agent:(.+)$/);
  if (claudeAgent?.[1] && claudeAgent[2]) {
    return {
      harness: "claude-code",
      harnessScope: "agent",
      rawSessionId: claudeAgent[1],
      agentId: claudeAgent[2],
    };
  }

  const claudeMain = sessionId.match(/^claude-code:([^:]+):main$/);
  if (claudeMain?.[1]) {
    return {
      harness: "claude-code",
      harnessScope: "main",
      rawSessionId: claudeMain[1],
    };
  }

  const claudeSession = sessionId.match(/^claude-code:(.+)$/);
  if (claudeSession?.[1]) {
    return {
      harness: "claude-code",
      harnessScope: "session",
      rawSessionId: claudeSession[1],
    };
  }

  return sessionId.startsWith("lockpick:") ? { harness: "lockpick", harnessScope: "fallback" } : {};
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
}

function fallbackOwnerId(prefix: string): string {
  return `${prefix}:${os.hostname()}:${process.pid}`;
}

function findSessionIndexEntry(
  raw: string,
  sessionId: string,
): { id: string; updated_at: string } | null {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { id?: unknown; updated_at?: unknown };
      if (parsed.id === sessionId && typeof parsed.updated_at === "string") {
        return { id: sessionId, updated_at: parsed.updated_at };
      }
    } catch {
      // Ignore malformed append-only local session metadata.
    }
  }
  return null;
}
