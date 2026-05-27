import packageJson from "../../package.json";
import { DEFAULT_CONFIG_FILE, DEFAULT_LOCK_ROOT } from "../config";
import {
  CLAUDE_CODE_SESSION_ENV_KEY,
  CODEX_OWNER_ENV_KEY,
  DEFAULT_OWNER_ENV_KEYS,
  DEFAULT_SUPERVISOR_ENV_KEYS,
} from "../locks/session";
import {
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_UNKNOWN_LIVENESS_GRACE_MS,
  GIT_INDEX_RESOURCE,
  MAX_LOCK_TTL_MS,
} from "../locks/types";

export interface CapabilitiesCommandOptions {
  json: boolean;
}

interface CommandCapability {
  name: string;
  usage: string;
  summary: string;
  category: "lock" | "git" | "init" | "meta";
  mutates: boolean;
  json: boolean;
  id_only: boolean;
  verbose: boolean;
  flags: string[];
  required: string[];
  exit_codes: number[];
  next: string[];
  dry_run?: string;
}

interface ExitCodeCapability {
  code: number;
  name: string;
  meaning: string;
}

interface EnvCapability {
  name: string;
  purpose: string;
}

export interface LockpickCapabilities {
  kind: "capabilities";
  schema_version: 1;
  name: "lockpick";
  version: string;
  contract: "lockpick.capabilities.v1";
  commands: CommandCapability[];
  exit_codes: ExitCodeCapability[];
  env: EnvCapability[];
  defaults: {
    config_file: string;
    lock_root: string;
    ttl_ms: number;
    max_ttl_ms: number;
    unknown_liveness_grace_ms: number;
    git_index_resource: string;
  };
}

const LOCK_OUTPUT_FLAGS = ["--json", "--id-only", "--verbose"];
const OWNER_FLAGS = ["--owner-session"];
const TTL_FLAGS = ["--ttl-ms"];
const RESOURCE_FLAGS = ["--glob"];

export function lockpickCapabilities(): LockpickCapabilities {
  return {
    kind: "capabilities",
    schema_version: 1,
    name: "lockpick",
    version: packageJson.version,
    contract: "lockpick.capabilities.v1",
    commands: [
      {
        name: "acquire",
        usage: "lockpick acquire [paths...] --reason <text>",
        summary: "Acquire advisory locks for paths or globs.",
        category: "lock",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: [...RESOURCE_FLAGS, "--reason", ...TTL_FLAGS, ...OWNER_FLAGS, ...LOCK_OUTPUT_FLAGS],
        required: ["--reason", "path-or-glob"],
        exit_codes: [0, 2, 3],
        next: [
          "lockpick refresh <lock_id>",
          'lockpick git begin --refresh-lock <lock_id> --reason "<commit intent>"',
          "lockpick release <lock_id>",
        ],
      },
      {
        name: "expand",
        usage: "lockpick expand --lock <lock_id> [paths...]",
        summary: "Atomically add paths or globs to an existing lock.",
        category: "lock",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: [
          "--lock",
          ...RESOURCE_FLAGS,
          "--reason",
          ...TTL_FLAGS,
          ...OWNER_FLAGS,
          ...LOCK_OUTPUT_FLAGS,
        ],
        required: ["--lock", "path-or-glob"],
        exit_codes: [0, 2, 3],
        next: ["lockpick refresh <lock_id>", "lockpick release <lock_id>"],
      },
      {
        name: "refresh",
        usage: "lockpick refresh [lock_ids...]",
        summary: "Refresh held lock leases.",
        category: "lock",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: ["--lock", ...TTL_FLAGS, ...OWNER_FLAGS, ...LOCK_OUTPUT_FLAGS],
        required: ["lock-id"],
        exit_codes: [0, 2, 3],
        next: ['lockpick git begin --refresh-lock <lock_id> --reason "<commit intent>"'],
      },
      {
        name: "release",
        usage: "lockpick release [lock_ids...]",
        summary: "Release held locks.",
        category: "lock",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: ["--lock", ...OWNER_FLAGS, ...LOCK_OUTPUT_FLAGS],
        required: ["lock-id"],
        exit_codes: [0, 2, 3],
        next: ["lockpick status --json"],
      },
      {
        name: "status",
        usage: "lockpick status [paths...]",
        summary: "Show active locks, optionally filtered by resources.",
        category: "lock",
        mutates: false,
        json: true,
        id_only: true,
        verbose: true,
        flags: [...RESOURCE_FLAGS, ...LOCK_OUTPUT_FLAGS],
        required: [],
        exit_codes: [0, 2],
        next: ['lockpick acquire <paths...> --reason "<intent>" --id-only'],
      },
      {
        name: "prune",
        usage: "lockpick prune",
        summary: "Remove reclaimable expired locks.",
        category: "lock",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: ["--dry-run", ...LOCK_OUTPUT_FLAGS],
        required: [],
        exit_codes: [0, 2],
        next: ['lockpick acquire <paths...> --reason "<intent>" --id-only'],
        dry_run: "--dry-run",
      },
      {
        name: "identify",
        usage: "lockpick identify",
        summary: "Show detected lock owner identity.",
        category: "lock",
        mutates: false,
        json: true,
        id_only: false,
        verbose: true,
        flags: [...OWNER_FLAGS, "--json", "--verbose"],
        required: [],
        exit_codes: [0],
        next: ['lockpick acquire <paths...> --reason "<intent>" --owner-session <id>'],
      },
      {
        name: "git begin",
        usage: "lockpick git begin --reason <text>",
        summary: `Acquire the synthetic ${GIT_INDEX_RESOURCE} lock.`,
        category: "git",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: ["--reason", "--refresh-lock", ...TTL_FLAGS, ...OWNER_FLAGS, ...LOCK_OUTPUT_FLAGS],
        required: ["--reason"],
        exit_codes: [0, 2, 3],
        next: [
          "git add <locked_paths>",
          "git commit",
          "lockpick git end <git_lock_id> --release-lock <lock_id>",
        ],
      },
      {
        name: "git end",
        usage: "lockpick git end [git_lock_ids...]",
        summary: `Release the synthetic ${GIT_INDEX_RESOURCE} lock.`,
        category: "git",
        mutates: true,
        json: true,
        id_only: true,
        verbose: true,
        flags: ["--lock", "--release-lock", ...OWNER_FLAGS, ...LOCK_OUTPUT_FLAGS],
        required: ["lock-id"],
        exit_codes: [0, 2, 3],
        next: ["lockpick status --json"],
      },
      {
        name: "init",
        usage: "lockpick init [--check] [--harness auto|codex|claude-code] [--json]",
        summary: "Initialize Lockpick support files in the host repository.",
        category: "init",
        mutates: true,
        json: true,
        id_only: false,
        verbose: true,
        flags: ["--check", "--harness", "--json", "--verbose"],
        required: [],
        exit_codes: [0, 1],
        next: ["lockpick init --check --json"],
        dry_run: "--check",
      },
      {
        name: "capabilities",
        usage: "lockpick capabilities --json",
        summary: "Print the machine-readable CLI contract.",
        category: "meta",
        mutates: false,
        json: true,
        id_only: false,
        verbose: false,
        flags: ["--json"],
        required: [],
        exit_codes: [0],
        next: ["lockpick status --json"],
      },
      {
        name: "robot-docs guide",
        usage: "lockpick robot-docs guide",
        summary: "Print the concise agent workflow guide.",
        category: "meta",
        mutates: false,
        json: false,
        id_only: false,
        verbose: false,
        flags: [],
        required: [],
        exit_codes: [0],
        next: ["lockpick capabilities --json", "lockpick status --json"],
      },
      {
        name: "doctor",
        usage: "lockpick doctor --json",
        summary: "Run read-only Lockpick health checks.",
        category: "meta",
        mutates: false,
        json: true,
        id_only: false,
        verbose: true,
        flags: ["--json", "--verbose"],
        required: [],
        exit_codes: [0, 1],
        next: ["lockpick init --check --json"],
      },
    ],
    exit_codes: [
      { code: 0, name: "success", meaning: "Command completed successfully." },
      {
        code: 1,
        name: "cli_or_check_error",
        meaning: "CLI parse error, init check drift, or doctor warning/error result.",
      },
      {
        code: 2,
        name: "lock_usage_error",
        meaning: "Invalid lock input, missing lock id, or missing lock resource.",
      },
      { code: 3, name: "lock_conflict", meaning: "Lock conflict or ownership failure." },
    ],
    env: [
      ...DEFAULT_OWNER_ENV_KEYS.map((name) => ({
        name,
        purpose: "Owner session id lookup, after --owner-session.",
      })),
      ...DEFAULT_SUPERVISOR_ENV_KEYS.map((name) => ({
        name,
        purpose: "Optional supervisor session id recorded in lock owner metadata.",
      })),
      {
        name: CODEX_OWNER_ENV_KEY,
        purpose: "Codex agent thread id used for automatic owner session detection.",
      },
      {
        name: CLAUDE_CODE_SESSION_ENV_KEY,
        purpose: "Claude Code session id used as automatic session-scope owner fallback.",
      },
    ],
    defaults: {
      config_file: DEFAULT_CONFIG_FILE,
      lock_root: DEFAULT_LOCK_ROOT,
      ttl_ms: DEFAULT_LOCK_TTL_MS,
      max_ttl_ms: MAX_LOCK_TTL_MS,
      unknown_liveness_grace_ms: DEFAULT_UNKNOWN_LIVENESS_GRACE_MS,
      git_index_resource: GIT_INDEX_RESOURCE,
    },
  };
}

export function renderCapabilitiesText(): string {
  const capabilities = lockpickCapabilities();
  return [
    "lockpick capabilities",
    `version: ${capabilities.version}`,
    "json: lockpick capabilities --json",
    `commands: ${capabilities.commands.map((command) => command.name).join(", ")}`,
  ].join("\n");
}
