import { Command, CommanderError, InvalidArgumentError, type OutputConfiguration } from "commander";
import { type LockCommand, LockCommandError } from "../locks/types";
import type { CapabilitiesCommandOptions } from "./capabilities";
import type { InstallCommandOptions } from "./commands/install";
import type { DoctorCommandOptions } from "./doctor";
import type { RobotDocsCommandOptions } from "./robot-docs";

export type CliCommand =
  | { kind: "lock"; command: LockCommand }
  | { kind: "install"; options: InstallCommandOptions }
  | { kind: "capabilities"; options: CapabilitiesCommandOptions }
  | { kind: "robot-docs"; options: RobotDocsCommandOptions }
  | { kind: "doctor"; options: DoctorCommandOptions };

export interface ParsedCli {
  help: boolean;
  helpText?: string;
  command?: CliCommand;
}

interface LockOutputOptions {
  json?: boolean;
  idOnly?: boolean;
  verbose?: boolean;
}

interface LockAcquireOptions extends LockOutputOptions {
  glob?: string[];
  reason: string;
  ttlMs?: number;
  ownerSession?: string;
}

interface LockExpandOptions extends LockOutputOptions {
  lock: string;
  glob?: string[];
  reason?: string;
  ttlMs?: number;
  ownerSession?: string;
}

interface LockRefreshOptions extends LockOutputOptions {
  lock?: string[];
  ttlMs?: number;
  ownerSession?: string;
}

interface LockReleaseOptions extends LockOutputOptions {
  lock?: string[];
  ownerSession?: string;
}

interface LockStatusOptions extends LockOutputOptions {
  glob?: string[];
}

interface LockIdentifyOptions extends LockOutputOptions {
  ownerSession?: string;
}

interface LockPruneOptions extends LockOutputOptions {
  dryRun?: boolean;
}

interface LockGitBeginOptions extends LockOutputOptions {
  reason: string;
  refreshLock?: string[];
  ttlMs?: number;
  ownerSession?: string;
}

interface LockGitEndOptions extends LockOutputOptions {
  lock?: string[];
  releaseLock?: string[];
  ownerSession?: string;
}

interface InstallCliOptions {
  check?: boolean;
  json?: boolean;
  verbose?: boolean;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  let parsedCommand: CliCommand | undefined;
  let helpBuffer = "";
  const program = createProgram((command) => {
    parsedCommand = command;
  });
  configureOutputTree(program, {
    writeOut: (text: string) => {
      helpBuffer += text;
    },
    writeErr: (text: string) => {
      helpBuffer += text;
    },
  });

  try {
    program.parse(normalizeHelpAlias(argv), { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return { help: true, helpText: helpBuffer || program.helpInformation() };
    }
    throw error;
  }

  return parsedCommand
    ? { help: false, command: parsedCommand }
    : { help: true, helpText: helpText() };
}

export function helpText(): string {
  return createProgram().helpInformation();
}

function createProgram(onCommand?: (command: CliCommand) => void): Command {
  const program = new Command()
    .name("lockpick")
    .description("Local advisory locking for shared repository worktrees.")
    .showHelpAfterError()
    .allowExcessArguments(false)
    .exitOverride()
    .enablePositionalOptions();

  addLockCommands(program, onCommand);
  addInstallCommand(program, onCommand);
  addCapabilitiesCommand(program, onCommand);
  addRobotDocsCommand(program, onCommand);
  addDoctorCommand(program, onCommand);
  return program;
}

function addLockCommands(program: Command, onCommand?: (command: CliCommand) => void): void {
  addLockOutputOptions(
    program
      .command("acquire")
      .description("Acquire advisory locks for paths or globs.")
      .argument("[paths...]", "Repo-relative file paths.")
      .option("--glob <pattern>", "Repo-relative glob; repeatable.", collectValues, [])
      .requiredOption("--reason <text>", "Human-readable lock intent.")
      .option("--ttl-ms <n>", "Lease length in milliseconds.", parseInteger)
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((paths: string[], _options: LockAcquireOptions, command: Command) => {
    const options = command.opts<LockAcquireOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "acquire",
          paths,
          globs: options.glob ?? [],
          reason: options.reason,
          ttlMs: options.ttlMs ?? null,
          ownerSession: options.ownerSession ?? null,
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    program
      .command("expand")
      .description("Atomically add paths or globs to an existing lock.")
      .argument("[paths...]", "Repo-relative file paths.")
      .requiredOption("--lock <lock_id>", "Lock id.")
      .option("--glob <pattern>", "Repo-relative glob; repeatable.", collectValues, [])
      .option("--reason <text>", "Ignored note accepted for acquire/expand command symmetry.")
      .option("--ttl-ms <n>", "Lease length in milliseconds.", parseInteger)
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((paths: string[], _options: LockExpandOptions, command: Command) => {
    const options = command.opts<LockExpandOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "expand",
          lockId: options.lock,
          paths,
          globs: options.glob ?? [],
          ttlMs: options.ttlMs ?? null,
          ownerSession: options.ownerSession ?? null,
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    program
      .command("refresh")
      .description("Refresh a held lock lease.")
      .argument("[locks...]", "Lock ids; equivalent to repeatable --lock.")
      .option("--lock <lock_id>", "Lock id; repeatable.", collectValues, [])
      .option("--ttl-ms <n>", "Lease length in milliseconds.", parseInteger)
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((locks: string[], _options: LockRefreshOptions, command: Command) => {
    const options = command.opts<LockRefreshOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "refresh",
          lockIds: mergeLockIds(options.lock, locks),
          ttlMs: options.ttlMs ?? null,
          ownerSession: options.ownerSession ?? null,
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    program
      .command("release")
      .description("Release a held lock.")
      .argument("[locks...]", "Lock ids; equivalent to repeatable --lock.")
      .option("--lock <lock_id>", "Lock id; repeatable.", collectValues, [])
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((locks: string[], _options: LockReleaseOptions, command: Command) => {
    const options = command.opts<LockReleaseOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "release",
          lockIds: mergeLockIds(options.lock, locks),
          ownerSession: options.ownerSession ?? null,
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    program
      .command("status")
      .description("Show active locks, optionally filtered by requested resources.")
      .argument("[paths...]", "Repo-relative file paths.")
      .option("--glob <pattern>", "Repo-relative glob; repeatable.", collectValues, [])
      .allowExcessArguments(false),
  ).action((paths: string[], _options: LockStatusOptions, command: Command) => {
    const options = command.opts<LockStatusOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "status",
          paths,
          globs: options.glob ?? [],
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    program
      .command("prune")
      .description("Remove reclaimable expired locks.")
      .option("--dry-run", "Print reclaimable locks without deleting them.")
      .allowExcessArguments(false),
  ).action((_options: LockPruneOptions, command: Command) => {
    const options = command.opts<LockPruneOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "prune",
          dryRun: Boolean(options.dryRun),
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    program
      .command("identify")
      .description("Show detected lock owner identity.")
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((_options: LockIdentifyOptions, command: Command) => {
    const options = command.opts<LockIdentifyOptions>();
    if (options.idOnly) {
      throw new LockCommandError(
        "--id-only is not supported for identify; use `lockpick identify --json`.",
        2,
        "unsupported_output_option",
      );
    }
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "identify",
          ownerSession: options.ownerSession ?? null,
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  const git = program.command("git").description("Coordinate shared Git index operations.");
  addLockOutputOptions(
    git
      .command("begin")
      .description("Acquire the synthetic @git/index lock.")
      .requiredOption("--reason <text>", "Human-readable commit intent.")
      .option(
        "--refresh-lock <lock_id>",
        "Held file lock to refresh first; repeatable.",
        collectValues,
        [],
      )
      .option("--ttl-ms <n>", "Lease length in milliseconds.", parseInteger)
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((_options: LockGitBeginOptions, command: Command) => {
    const options = command.opts<LockGitBeginOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "git-begin",
          reason: options.reason,
          ttlMs: options.ttlMs ?? null,
          ownerSession: options.ownerSession ?? null,
          refreshLockIds: options.refreshLock ?? [],
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });

  addLockOutputOptions(
    git
      .command("end")
      .description("Release the synthetic @git/index lock.")
      .argument("[locks...]", "Git/index lock ids; equivalent to repeatable --lock.")
      .option("--lock <lock_id>", "Git/index lock id; repeatable.", collectValues, [])
      .option(
        "--release-lock <lock_id>",
        "Held file lock to release after git lock; repeatable.",
        collectValues,
        [],
      )
      .option("--owner-session <id>", "Explicit owner session id.")
      .allowExcessArguments(false),
  ).action((locks: string[], _options: LockGitEndOptions, command: Command) => {
    const options = command.opts<LockGitEndOptions>();
    onCommand?.({
      kind: "lock",
      command: withLockVerbose(
        {
          name: "git-end",
          lockIds: mergeLockIds(options.lock, locks),
          releaseLockIds: options.releaseLock ?? [],
          ownerSession: options.ownerSession ?? null,
          json: Boolean(options.json),
          idOnly: Boolean(options.idOnly),
        },
        options,
      ),
    });
  });
}

function addInstallCommand(program: Command, onCommand?: (command: CliCommand) => void): void {
  program
    .command("install")
    .description("Install Lockpick support files into the host repository.")
    .option("--check", "Report required changes without writing.")
    .option("--json", "Print machine-readable output.")
    .option("--verbose", "Include full install JSON details.")
    .allowExcessArguments(false)
    .action((_options: InstallCliOptions, command: Command) => {
      const options = command.opts<InstallCliOptions>();
      onCommand?.({
        kind: "install",
        options: {
          check: Boolean(options.check),
          json: Boolean(options.json),
          verbose: Boolean(options.verbose),
        },
      });
    });
}

function addCapabilitiesCommand(program: Command, onCommand?: (command: CliCommand) => void): void {
  program
    .command("capabilities")
    .description("Print the machine-readable CLI contract.")
    .option("--json", "Print machine-readable output.")
    .allowExcessArguments(false)
    .action((_options: CapabilitiesCommandOptions, command: Command) => {
      const options = command.opts<CapabilitiesCommandOptions>();
      onCommand?.({
        kind: "capabilities",
        options: {
          json: Boolean(options.json),
        },
      });
    });
}

function addRobotDocsCommand(program: Command, onCommand?: (command: CliCommand) => void): void {
  const robotDocs = program.command("robot-docs").description("Print agent-oriented CLI docs.");
  robotDocs
    .command("guide")
    .description("Print the concise agent workflow guide.")
    .allowExcessArguments(false)
    .action(() => {
      onCommand?.({
        kind: "robot-docs",
        options: {
          topic: "guide",
        },
      });
    });
}

function addDoctorCommand(program: Command, onCommand?: (command: CliCommand) => void): void {
  program
    .command("doctor")
    .description("Run read-only Lockpick health checks.")
    .option("--json", "Print machine-readable output.")
    .option("--verbose", "Include full check details.")
    .allowExcessArguments(false)
    .action((_options: DoctorCommandOptions, command: Command) => {
      const options = command.opts<DoctorCommandOptions>();
      onCommand?.({
        kind: "doctor",
        options: {
          json: Boolean(options.json),
          verbose: Boolean(options.verbose),
        },
      });
    });
}

function addLockOutputOptions(command: Command): Command {
  return command
    .option("--json", "Print machine-readable output.")
    .option("--id-only", "Print only affected lock ids on success.")
    .option("--verbose", "Include full lock resource/status details.");
}

function withLockVerbose<const T extends object>(
  command: T,
  options: LockOutputOptions,
): T & { verbose?: true } {
  return options.verbose ? { ...command, verbose: true } : command;
}

function parseInteger(value: string, previous: unknown): number {
  if (typeof previous === "number") return previous;
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(`Expected a positive integer, got ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function mergeLockIds(optionLocks: string[] | undefined, positional: string[]): string[] {
  return [...new Set([...(positional ?? []), ...(optionLocks ?? [])])];
}

function normalizeHelpAlias(argv: string[]): string[] {
  if (argv[0] === "help" && argv[1]) return [...argv.slice(1), "--help"];
  if (argv[0] === "git" && argv[1] === "help" && argv[2]) {
    return ["git", argv[2], "--help", ...argv.slice(3)];
  }
  return argv;
}

function configureOutputTree(command: Command, output: OutputConfiguration): void {
  command.configureOutput(output);
  for (const child of command.commands) configureOutputTree(child, output);
}
