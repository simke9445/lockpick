import path from "node:path";
import {
  DEFAULT_CONFIG_FILE,
  findHostRoot,
  loadLockpickConfig,
  type ResolvedLockpickConfig,
  renderLockpickCommand,
} from "./config";
import { ensureDir, pathExists, readText, writeText } from "./io";
import { formatJsonArtifact } from "./json";

export const LOCKPICK_AGENTS_START = "<!-- lockpick:start -->";
export const LOCKPICK_AGENTS_END = "<!-- lockpick:end -->";

export interface InitOptions {
  root?: string;
  cwd?: string;
  check?: boolean;
  harness?: InitHarness;
}

export type InitHarness = "auto" | "codex" | "claude-code";
export type InitInstructionsTarget = "agents" | "claude";

export type InitAction =
  | "created"
  | "updated"
  | "unchanged"
  | "exists"
  | "would_create"
  | "would_update"
  | "reported";

export interface InitChange {
  path: string;
  action: InitAction;
  message: string;
}

export interface InitResult {
  ok: boolean;
  exitCode: number;
  root: string;
  harness: InitHarness;
  resolvedHarness: Exclude<InitHarness, "auto">;
  instructionsTarget: InitInstructionsTarget;
  instructionsPath: string;
  changes: InitChange[];
  recommendedScripts: Record<string, string>;
}

const INIT_INSTRUCTIONS_PATHS: Record<InitInstructionsTarget, string> = {
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
};

const RECOMMENDED_PACKAGE_SCRIPTS: Record<string, string> = {
  lockpick: "lockpick",
  "lockpick:status": "lockpick status",
  "lockpick:init": "lockpick init",
};

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const root = path.resolve(options.root ?? (await findHostRoot(options.cwd ?? process.cwd())));
  const check = Boolean(options.check);
  const harness = options.harness ?? "auto";
  const resolvedHarness = resolveInitHarness(harness, process.env);
  const instructionsTarget = instructionsTargetForHarness(resolvedHarness);
  const instructionsPath = INIT_INSTRUCTIONS_PATHS[instructionsTarget];
  const config = await loadLockpickConfig({ root });
  const changes: InitChange[] = [];

  changes.push(await ensureLockDirectories(config, check));
  changes.push(await ensureConfigFile(config, check));

  if (config.init.updateAgents) {
    changes.push(await ensureAgentsInstructions(config, check, instructionsPath));
  }
  if (config.init.updateGitignore) {
    changes.push(await ensureGitignore(config, check));
  }
  if (config.init.updatePackageScripts) {
    changes.push(await ensurePackageScripts(config, check));
  }

  const checkFailed =
    check &&
    changes.some((change) => ["would_create", "would_update", "reported"].includes(change.action));
  return {
    ok: !checkFailed,
    exitCode: checkFailed ? 1 : 0,
    root,
    harness,
    resolvedHarness,
    instructionsTarget,
    instructionsPath,
    changes,
    recommendedScripts: RECOMMENDED_PACKAGE_SCRIPTS,
  };
}

export function resolveInitHarness(
  harness: InitHarness,
  env: NodeJS.ProcessEnv = process.env,
): Exclude<InitHarness, "auto"> {
  if (harness !== "auto") return harness;
  const claudeSession = env.CLAUDE_CODE_SESSION_ID?.trim();
  const codexThread = env.CODEX_THREAD_ID?.trim();
  if (claudeSession && !codexThread) return "claude-code";
  return "codex";
}

function instructionsTargetForHarness(harness: Exclude<InitHarness, "auto">): InitInstructionsTarget {
  return harness === "claude-code" ? "claude" : "agents";
}

export function renderInitResult(result: InitResult): string {
  const lines = [
    result.ok ? "lockpick init: ok" : "lockpick init: changes needed",
    `root: ${result.root}`,
  ];
  for (const change of result.changes) {
    lines.push(`${change.action}: ${change.path} - ${change.message}`);
  }
  return lines.join("\n");
}

export function lockpickAgentsSnippet(config: ResolvedLockpickConfig): string {
  const acquire = renderLockpickCommand(config, [
    "acquire",
    "<paths...>",
    "--reason",
    '"<intent>"',
  ]);
  const expand = renderLockpickCommand(config, ["expand", "--lock", "<lock_id>", "<paths...>"]);
  const refresh = renderLockpickCommand(config, ["refresh", "<lock_id>"]);
  const gitBegin = renderLockpickCommand(config, [
    "git",
    "begin",
    "--refresh-lock",
    "<lock_id>",
    "--reason",
    '"<commit intent>"',
  ]);
  const gitEnd = renderLockpickCommand(config, [
    "git",
    "end",
    "<git_lock_id>",
    "--release-lock",
    "<lock_id>",
  ]);
  return [
    LOCKPICK_AGENTS_START,
    `## ${config.agents.heading}`,
    "",
    "This repository uses Lockpick advisory locks for multi-agent editing.",
    "",
    "- Acquire exact file locks before editing, creating, deleting, renaming, formatting, or bulk-rewriting repository files.",
    `- Use \`${acquire}\` and keep requested paths narrow. Prefer exact paths over globs.`,
    `- Expand before touching newly needed files with \`${expand}\`; do not edit outside the held lock set.`,
    `- Refresh before edit batches, after long tests, and before staging with \`${refresh}\`.`,
    `- Use \`${gitBegin}\` before staging or committing because the Git index is shared.`,
    "- Stage only paths covered by your held locks and verify the staged diff before committing.",
    `- Release promptly after commit or handoff with \`${gitEnd}\` or \`lockpick release <lock_id>\`.`,
    LOCKPICK_AGENTS_END,
  ].join("\n");
}

function lockpickConfigTemplate(projectName: string): string {
  return `import type { LockpickConfig } from "lockpick";

export default {
  projectName: ${JSON.stringify(projectName)},
  lockRoot: ".lockpick/locks",
  command: {
    executable: "lockpick",
  },
  defaults: {
    ttlMs: 600_000,
    maxTtlMs: 1_800_000,
    unknownLivenessGraceMs: 600_000,
  },
  owner: {
    envKeys: ["LOCKPICK_OWNER_SESSION", "LOCKPICK_SESSION_ID"],
    fallbackPrefix: "lockpick",
  },
  liveness: {
    adapter: "unknown",
  },
} satisfies LockpickConfig;
`;
}

async function ensureLockDirectories(
  config: ResolvedLockpickConfig,
  check: boolean,
): Promise<InitChange> {
  const activeDir = path.join(config.lockRoot, "active");
  if (await pathExists(activeDir)) {
    return change(config.lockRootRelative, "unchanged", "lock directory exists");
  }
  if (!check) await ensureDir(activeDir);
  return change(
    config.lockRootRelative,
    check ? "would_create" : "created",
    "lock directory is required",
  );
}

async function ensureConfigFile(
  config: ResolvedLockpickConfig,
  check: boolean,
): Promise<InitChange> {
  const relative = path.relative(config.root, config.configPath) || DEFAULT_CONFIG_FILE;
  if (await pathExists(config.configPath)) {
    return change(relative, "exists", "existing config preserved");
  }
  if (!check) await writeText(config.configPath, lockpickConfigTemplate(config.projectName));
  return change(relative, check ? "would_create" : "created", "default config is required");
}

async function ensureAgentsInstructions(
  config: ResolvedLockpickConfig,
  check: boolean,
  instructionsPath: string,
): Promise<InitChange> {
  const agentsPath = path.join(config.root, instructionsPath);
  const relative = instructionsPath;
  const snippet = lockpickAgentsSnippet(config);
  const exists = await pathExists(agentsPath);
  const current = exists ? await readText(agentsPath) : "";
  const next = upsertMarkedBlock(current, snippet);
  if (exists && current === next) return change(relative, "unchanged", "instructions are current");
  if (!check) await writeText(agentsPath, next);
  return change(
    relative,
    check ? (exists ? "would_update" : "would_create") : exists ? "updated" : "created",
    "Lockpick instructions are required",
  );
}

async function ensureGitignore(
  config: ResolvedLockpickConfig,
  check: boolean,
): Promise<InitChange> {
  const gitignorePath = path.join(config.root, ".gitignore");
  const relative = ".gitignore";
  const entry = ".lockpick/";
  const exists = await pathExists(gitignorePath);
  const current = exists ? await readText(gitignorePath) : "";
  if (hasGitignoreEntry(current, entry)) return change(relative, "unchanged", "entry exists");

  const next = appendLine(current, entry);
  if (!check) await writeText(gitignorePath, next);
  return change(
    relative,
    check ? (exists ? "would_update" : "would_create") : exists ? "updated" : "created",
    "ignore local lock state",
  );
}

async function ensurePackageScripts(
  config: ResolvedLockpickConfig,
  check: boolean,
): Promise<InitChange> {
  const packagePath = path.join(config.root, "package.json");
  const relative = "package.json";
  if (!(await pathExists(packagePath))) {
    return change(relative, "reported", "no package.json; add the recommended scripts manually");
  }

  const parsed = JSON.parse(await readText(packagePath)) as {
    scripts?: Record<string, string>;
    [key: string]: unknown;
  };
  const scripts = parsed.scripts ?? {};
  let changed = false;
  for (const [name, command] of Object.entries(RECOMMENDED_PACKAGE_SCRIPTS)) {
    if (scripts[name]) continue;
    scripts[name] = command;
    changed = true;
  }
  if (!changed) return change(relative, "unchanged", "recommended scripts exist");

  if (!check) {
    parsed.scripts = scripts;
    await writeText(packagePath, `${formatJsonArtifact(parsed)}\n`);
  }
  return change(relative, check ? "would_update" : "updated", "recommended scripts added");
}

function upsertMarkedBlock(current: string, block: string): string {
  const normalizedBlock = `${block.trim()}\n`;
  if (!current.trim()) return `# Repository instructions for agents\n\n${normalizedBlock}`;
  const start = current.indexOf(LOCKPICK_AGENTS_START);
  const end = current.indexOf(LOCKPICK_AGENTS_END);
  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + LOCKPICK_AGENTS_END.length;
    const prefix = current.slice(0, start);
    const suffix = current.slice(afterEnd).replace(/^\n*/, "");
    return suffix ? `${prefix}${normalizedBlock}\n${suffix}` : `${prefix}${normalizedBlock}`;
  }
  return `${current.replace(/\s*$/, "\n\n")}${normalizedBlock}`;
}

function hasGitignoreEntry(current: string, entry: string): boolean {
  return current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === entry || line === entry.replace(/\/$/, ""));
}

function appendLine(current: string, line: string): string {
  if (!current.trim()) return `${line}\n`;
  return `${current.replace(/\s*$/, "\n")}${line}\n`;
}

function change(pathLabel: string, action: InitAction, message: string): InitChange {
  return { path: pathLabel, action, message };
}
