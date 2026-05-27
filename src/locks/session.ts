import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LockOwner, LockOwnerHarness, LockOwnerHarnessScope, SessionLiveness } from "./types";
import { MAX_LOCK_TTL_MS } from "./types";

export const DEFAULT_AGENT_ENV_KEYS = ["LOCKPICK_AGENT_ID"] as const;
export const DEFAULT_OWNER_HARNESSES = ["codex", "claude-code"] as const;
export type OwnerHarness = (typeof DEFAULT_OWNER_HARNESSES)[number];
export const LOCKPICK_HARNESS_AGENT_ENV_KEY = "LOCKPICK_HARNESS_AGENT_ID";
export const CODEX_OWNER_ENV_KEY = "CODEX_THREAD_ID";
export const CLAUDE_CODE_SESSION_ENV_KEY = "CLAUDE_CODE_SESSION_ID";

export interface IdentifyOwnerOptions {
  cwd: string;
  agentId?: string | null;
  env?: NodeJS.ProcessEnv;
  envKeys?: readonly string[];
  harnesses?: readonly OwnerHarness[];
  fallbackPrefix?: string;
}

export type SessionLivenessProbe = (
  owner: LockOwner,
  now: Date,
) => Promise<SessionLiveness> | SessionLiveness;

export function detectAgentId(
  env: NodeJS.ProcessEnv = process.env,
  envKeys: readonly string[] = DEFAULT_AGENT_ENV_KEYS,
): { agentId: string; source: string } | null {
  for (const key of envKeys) {
    const value = env[key]?.trim();
    if (value) return { agentId: value, source: `env:${key}` };
  }
  return null;
}

export function detectHarnessAgentId(
  env: NodeJS.ProcessEnv = process.env,
  harnesses: readonly OwnerHarness[] = DEFAULT_OWNER_HARNESSES,
): Pick<LockOwner, "agentId" | "source" | "harness" | "harnessScope" | "rawSessionId"> | null {
  const lockpickHarnessAgentId = env[LOCKPICK_HARNESS_AGENT_ENV_KEY]?.trim();
  if (lockpickHarnessAgentId) {
    const parsed = parseHarnessOwnerAgentId(lockpickHarnessAgentId);
    const detected: Pick<
      LockOwner,
      "agentId" | "source" | "harness" | "harnessScope" | "rawSessionId"
    > = {
      agentId: lockpickHarnessAgentId,
      source: `harness:lockpick:${LOCKPICK_HARNESS_AGENT_ENV_KEY}`,
    };
    if (parsed.harness) detected.harness = parsed.harness;
    if (parsed.harnessScope) detected.harnessScope = parsed.harnessScope;
    if (parsed.rawSessionId) detected.rawSessionId = parsed.rawSessionId;
    return detected;
  }

  for (const harness of harnesses) {
    switch (harness) {
      case "codex": {
        const value = env[CODEX_OWNER_ENV_KEY]?.trim();
        if (!value) break;
        return {
          agentId: `codex:${value}`,
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
          agentId: `claude-code:${value}`,
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
  const envKeys = options.envKeys ?? DEFAULT_AGENT_ENV_KEYS;
  const harnesses = options.harnesses ?? DEFAULT_OWNER_HARNESSES;
  const explicit = options.agentId?.trim();
  const harnessDetected = detectHarnessAgentId(env, harnesses);
  const detected = harnessDetected
    ? null
    : explicit
      ? { agentId: explicit, source: "explicit" }
      : detectAgentId(env, envKeys);
  const fallbackAgentId = fallbackOwnerId(options.fallbackPrefix ?? "lockpick");
  const resolved = harnessDetected ?? detected ?? { agentId: fallbackAgentId, source: "fallback" };
  const parsed = parseHarnessOwnerAgentId(resolved.agentId);
  const owner: LockOwner = {
    agentId: resolved.agentId,
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
  if (parsed.harnessAgentId) owner.harnessAgentId = parsed.harnessAgentId;
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
  const current = detectHarnessAgentId(process.env, ["codex"]);
  const agentId = lockOwnerAgentId(owner);
  if (current && current.agentId === agentId) {
    return { status: "live", evidence: "owner matches current CODEX_THREAD_ID" };
  }
  if (agentId.startsWith("unknown:")) {
    return { status: "unknown", evidence: "owner agent id was not available" };
  }

  const indexPath = path.join(codexHome(), "session_index.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch {
    return { status: "unknown", evidence: `could not read ${indexPath}` };
  }

  const rawSessionId = owner.rawSessionId ?? agentId.replace(/^codex:/, "");
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

export function lockOwnerAgentId(owner: LockOwner): string {
  return owner.agentId;
}

export function lockOwnerSource(owner: LockOwner): string | null {
  return owner.source;
}

function parseHarnessOwnerAgentId(agentId: string): {
  harness?: LockOwnerHarness;
  harnessScope?: LockOwnerHarnessScope;
  rawSessionId?: string;
  harnessAgentId?: string;
  agentType?: string;
} {
  const codex = agentId.match(/^codex:(.+)$/);
  if (codex?.[1]) {
    return {
      harness: "codex",
      harnessScope: "agent",
      rawSessionId: codex[1],
    };
  }

  const claudeAgent = agentId.match(/^claude-code:([^:]+):agent:(.+)$/);
  if (claudeAgent?.[1] && claudeAgent[2]) {
    return {
      harness: "claude-code",
      harnessScope: "agent",
      rawSessionId: claudeAgent[1],
      harnessAgentId: claudeAgent[2],
    };
  }

  const claudeMain = agentId.match(/^claude-code:([^:]+):main$/);
  if (claudeMain?.[1]) {
    return {
      harness: "claude-code",
      harnessScope: "main",
      rawSessionId: claudeMain[1],
    };
  }

  const claudeSession = agentId.match(/^claude-code:(.+)$/);
  if (claudeSession?.[1]) {
    return {
      harness: "claude-code",
      harnessScope: "session",
      rawSessionId: claudeSession[1],
    };
  }

  return agentId.startsWith("lockpick:") ? { harness: "lockpick", harnessScope: "fallback" } : {};
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
