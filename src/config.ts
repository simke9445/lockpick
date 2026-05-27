import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists } from "./io";
import {
  CODEX_OWNER_ENV_KEYS,
  CODEX_SUPERVISOR_ENV_KEYS,
  DEFAULT_OWNER_ENV_KEYS,
  DEFAULT_SUPERVISOR_ENV_KEYS,
} from "./locks/session";
import {
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_UNKNOWN_LIVENESS_GRACE_MS,
  MAX_LOCK_TTL_MS,
} from "./locks/types";

export const DEFAULT_LOCK_ROOT = ".lockpick/locks";
export const DEFAULT_CONFIG_FILE = "lockpick.config.ts";

export type LivenessAdapterName = "unknown" | "codex";

export interface LockpickCommandConfig {
  executable?: string;
  prefix?: string[];
  packageRunner?: string;
  packageScript?: string;
}

export interface LockpickOwnerConfig {
  envKeys?: string[];
  supervisorEnvKeys?: string[];
  includeCodexEnv?: boolean;
  fallbackPrefix?: string;
}

export interface LockpickDefaultsConfig {
  ttlMs?: number;
  maxTtlMs?: number;
  unknownLivenessGraceMs?: number;
}

export interface LockpickAgentsConfig {
  enabled?: boolean;
  heading?: string;
}

export interface LockpickInitConfig {
  updateAgents?: boolean;
  updateGitignore?: boolean;
  updatePackageScripts?: boolean;
}

export interface LockpickConfig {
  projectName?: string;
  lockRoot?: string;
  command?: LockpickCommandConfig;
  defaults?: LockpickDefaultsConfig;
  owner?: LockpickOwnerConfig;
  liveness?: {
    adapter?: LivenessAdapterName;
  };
  agents?: LockpickAgentsConfig;
  init?: LockpickInitConfig;
}

export interface ResolvedCommandConfig {
  prefix: string[];
}

export interface ResolvedOwnerConfig {
  envKeys: string[];
  supervisorEnvKeys: string[];
  fallbackPrefix: string;
}

export interface ResolvedLockpickConfig {
  root: string;
  configPath: string;
  configFound: boolean;
  projectName: string;
  lockRoot: string;
  lockRootRelative: string;
  command: ResolvedCommandConfig;
  defaults: Required<LockpickDefaultsConfig>;
  owner: ResolvedOwnerConfig;
  liveness: {
    adapter: LivenessAdapterName;
  };
  agents: Required<LockpickAgentsConfig>;
  init: Required<LockpickInitConfig>;
}

export interface LoadLockpickConfigOptions {
  cwd?: string;
  root?: string;
  configPath?: string;
}

export function defineLockpickConfig(config: LockpickConfig): LockpickConfig {
  return config;
}

export async function loadLockpickConfig(
  options: LoadLockpickConfigOptions = {},
): Promise<ResolvedLockpickConfig> {
  const root = path.resolve(options.root ?? (await findHostRoot(options.cwd ?? process.cwd())));
  const configPath = path.resolve(options.configPath ?? path.join(root, DEFAULT_CONFIG_FILE));
  const loaded = await loadConfigFile(configPath);
  return resolveLockpickConfig(loaded.config, {
    root,
    configPath,
    configFound: loaded.found,
  });
}

export function resolveLockpickConfig(
  config: LockpickConfig = {},
  source: { root: string; configPath?: string; configFound?: boolean },
): ResolvedLockpickConfig {
  const root = path.resolve(source.root);
  const projectName = config.projectName?.trim() || path.basename(root) || "project";
  const lockRootRelative = normalizeLockRoot(config.lockRoot ?? DEFAULT_LOCK_ROOT);
  const lockRoot = path.isAbsolute(lockRootRelative)
    ? lockRootRelative
    : path.join(root, lockRootRelative);
  const owner = resolveOwnerConfig(config.owner);
  return {
    root,
    configPath: source.configPath ?? path.join(root, DEFAULT_CONFIG_FILE),
    configFound: Boolean(source.configFound),
    projectName,
    lockRoot,
    lockRootRelative,
    command: { prefix: resolveCommandPrefix(config.command) },
    defaults: {
      ttlMs: normalizePositiveInteger(config.defaults?.ttlMs, DEFAULT_LOCK_TTL_MS, "ttlMs"),
      maxTtlMs: normalizePositiveInteger(config.defaults?.maxTtlMs, MAX_LOCK_TTL_MS, "maxTtlMs"),
      unknownLivenessGraceMs: normalizePositiveInteger(
        config.defaults?.unknownLivenessGraceMs,
        DEFAULT_UNKNOWN_LIVENESS_GRACE_MS,
        "unknownLivenessGraceMs",
      ),
    },
    owner,
    liveness: { adapter: config.liveness?.adapter ?? "unknown" },
    agents: {
      enabled: config.agents?.enabled ?? true,
      heading: config.agents?.heading ?? "Lockpick coordination",
    },
    init: {
      updateAgents: config.init?.updateAgents ?? true,
      updateGitignore: config.init?.updateGitignore ?? true,
      updatePackageScripts: config.init?.updatePackageScripts ?? true,
    },
  };
}

export async function findHostRoot(cwd: string): Promise<string> {
  let current = path.resolve(cwd);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

export function renderLockpickCommand(config: ResolvedLockpickConfig, args: string[] = []): string {
  return [...config.command.prefix, ...args].map(shellQuote).join(" ");
}

async function loadConfigFile(
  configPath: string,
): Promise<{ found: boolean; config: LockpickConfig }> {
  if (!(await pathExists(configPath))) return { found: false, config: {} };
  const stat = await fs.stat(configPath);
  const url = `${pathToFileURL(configPath).href}?mtime=${stat.mtimeMs}`;
  const module = (await import(url)) as {
    default?: unknown;
    config?: unknown;
  };
  const value = module.default ?? module.config ?? {};
  if (!isObject(value)) {
    throw new Error(`Lockpick config must export an object: ${configPath}`);
  }
  return { found: true, config: value as LockpickConfig };
}

function resolveOwnerConfig(config: LockpickOwnerConfig | undefined): ResolvedOwnerConfig {
  const envKeys = [...(config?.envKeys ?? DEFAULT_OWNER_ENV_KEYS)];
  const supervisorEnvKeys = [...(config?.supervisorEnvKeys ?? DEFAULT_SUPERVISOR_ENV_KEYS)];
  if (config?.includeCodexEnv) {
    envKeys.push(...CODEX_OWNER_ENV_KEYS);
    supervisorEnvKeys.push(...CODEX_SUPERVISOR_ENV_KEYS);
  }
  return {
    envKeys: dedupeStrings(envKeys),
    supervisorEnvKeys: dedupeStrings(supervisorEnvKeys),
    fallbackPrefix: config?.fallbackPrefix?.trim() || "lockpick",
  };
}

function resolveCommandPrefix(command: LockpickCommandConfig | undefined): string[] {
  if (command?.prefix && command.prefix.length > 0) return command.prefix.map(requireCommandPart);
  if (command?.packageScript) {
    const runner = command.packageRunner?.trim() || "bun";
    return [runner, "run", "--silent", command.packageScript.trim(), "--"];
  }
  return [command?.executable?.trim() || "lockpick"];
}

function normalizeLockRoot(lockRoot: string): string {
  const trimmed = lockRoot.trim();
  if (!trimmed) throw new Error("lockRoot must not be empty.");
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`Lockpick ${label} must be a positive integer.`);
  }
  return resolved;
}

function requireCommandPart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Lockpick command prefix entries must not be empty.");
  return trimmed;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
