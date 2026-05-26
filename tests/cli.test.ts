import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { helpText, parseCliArgs } from "../src/cli/program";

const execFileAsync = promisify(execFile);

interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

async function runCli(args: string[]): Promise<CliResult> {
  return execFileAsync(process.execPath, ["run", "src/index.ts", ...args], {
    cwd: process.cwd(),
  })
    .then(({ stdout, stderr }) => ({ stdout, stderr, code: 0 }))
    .catch((error: unknown) => {
      const failure = error as Partial<CliResult>;
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        code: failure.code ?? null,
      };
    });
}

test("help lists top-level lock commands", () => {
  const help = helpText();
  expect(help).toContain("acquire");
  expect(help).toContain("refresh");
  expect(help).toContain("git");
  expect(help).toContain("install");
  expect(help).toContain("capabilities");
  expect(help).toContain("robot-docs");
});

test("nested help aliases resolve to subcommand help", () => {
  const direct = parseCliArgs(["expand", "--help"]);
  expect(direct.help).toBe(true);
  expect(direct.helpText).toContain("Atomically add paths");
  expect(direct.helpText).toContain("--lock <lock_id>");

  const alias = parseCliArgs(["help", "expand"]);
  expect(alias.help).toBe(true);
  expect(alias.helpText).toContain("Atomically add paths");
  expect(alias.helpText).toContain("--lock <lock_id>");

  const gitAlias = parseCliArgs(["git", "help", "begin"]);
  expect(gitAlias.help).toBe(true);
  expect(gitAlias.helpText).toContain("@git/index");
});

test("parse lock acquire command", () => {
  const parsed = parseCliArgs([
    "acquire",
    "src/cli/program.ts",
    "--glob",
    "src/locks/**/*.ts",
    "--reason",
    "add lock parser",
    "--ttl-ms",
    "1000",
    "--owner-session",
    "owner-1",
    "--json",
    "--id-only",
  ]);
  expect(parsed.command?.kind).toBe("lock");
  if (parsed.command?.kind !== "lock") throw new Error("expected lock command");
  expect(parsed.command.command).toEqual({
    name: "acquire",
    paths: ["src/cli/program.ts"],
    globs: ["src/locks/**/*.ts"],
    reason: "add lock parser",
    ttlMs: 1000,
    ownerSession: "owner-1",
    json: true,
    idOnly: true,
  });
});

test("parse lock git helpers for combined commit coordination", () => {
  const begin = parseCliArgs([
    "git",
    "begin",
    "--reason",
    "commit lock feature",
    "--refresh-lock",
    "lock_files",
    "--id-only",
  ]);
  expect(begin.command?.kind).toBe("lock");
  if (begin.command?.kind !== "lock") throw new Error("expected lock command");
  expect(begin.command.command).toEqual({
    name: "git-begin",
    reason: "commit lock feature",
    ttlMs: null,
    ownerSession: null,
    refreshLockIds: ["lock_files"],
    json: false,
    idOnly: true,
  });

  const end = parseCliArgs(["git", "end", "lock_git", "--release-lock", "lock_files"]);
  expect(end.command?.kind).toBe("lock");
  if (end.command?.kind !== "lock") throw new Error("expected lock command");
  expect(end.command.command).toEqual({
    name: "git-end",
    lockIds: ["lock_git"],
    releaseLockIds: ["lock_files"],
    ownerSession: null,
    json: false,
    idOnly: false,
  });
});

test("parse prune dry-run command", () => {
  const parsed = parseCliArgs(["prune", "--dry-run", "--json"]);
  expect(parsed.command?.kind).toBe("lock");
  if (parsed.command?.kind !== "lock") throw new Error("expected lock command");
  expect(parsed.command.command).toEqual({
    name: "prune",
    dryRun: true,
    json: true,
    idOnly: false,
  });
});

test("parse install check command", () => {
  const parsed = parseCliArgs(["install", "--check", "--json"]);
  expect(parsed.command).toEqual({
    kind: "install",
    options: {
      check: true,
      json: true,
    },
  });
});

test("parse capabilities command", () => {
  expect(parseCliArgs(["capabilities"]).command).toEqual({
    kind: "capabilities",
    options: {
      json: false,
    },
  });
  expect(parseCliArgs(["capabilities", "--json"]).command).toEqual({
    kind: "capabilities",
    options: {
      json: true,
    },
  });
});

test("parse robot docs guide command", () => {
  expect(parseCliArgs(["robot-docs", "guide"]).command).toEqual({
    kind: "robot-docs",
    options: {
      topic: "guide",
    },
  });
});

test("json parse errors are machine-readable", async () => {
  const result = await runCli(["acquire", "src/index.ts", "--ttl-ms", "10abc", "--json"]);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toBe("");
  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(payload.ok).toBe(false);
  expect(payload.code).toBe("commander.invalidArgument");
  expect(payload.message).toEqual(expect.stringContaining("--ttl-ms"));
});

test("unknown flag text errors suggest an exact corrected command", async () => {
  const result = await runCli(["status", "--jason"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("unknown option '--jason'");
  expect(result.stderr).toContain("next: lockpick status --json");
});

test("unknown flag json errors include suggestion details", async () => {
  const result = await runCli(["status", "--jason", "--json"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("");
  const payload = JSON.parse(result.stdout) as {
    ok?: unknown;
    code?: unknown;
    details?: { suggestion?: Record<string, unknown> };
  };
  expect(payload.ok).toBe(false);
  expect(payload.code).toBe("commander.unknownOption");
  expect(payload.details?.suggestion).toEqual({
    replace: "--jason",
    with: "--json",
    command: "lockpick status --json",
  });
});

test("identify rejects id-only with a precise replacement command", async () => {
  const result = await runCli(["identify", "--id-only", "--json"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("");
  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(payload).toMatchObject({
    ok: false,
    code: "unsupported_output_option",
  });
  expect(payload.message).toContain("lockpick identify --json");
});

test("capabilities json is compact and machine-readable", async () => {
  const result = await runCli(["capabilities", "--json"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThan(7000);

  const payload = JSON.parse(result.stdout) as {
    kind?: unknown;
    schema_version?: unknown;
    version?: unknown;
    commands?: Array<{
      name?: unknown;
      mutates?: unknown;
      json?: unknown;
      id_only?: unknown;
      flags?: unknown;
      exit_codes?: unknown;
    }>;
    exit_codes?: Array<{ code?: unknown; name?: unknown; meaning?: unknown }>;
    env?: Array<{ name?: unknown }>;
  };

  expect(payload.kind).toBe("capabilities");
  expect(payload.schema_version).toBe(1);
  expect(payload.version).toBe("0.1.0");
  const acquire = payload.commands?.find((command) => command.name === "acquire");
  expect(acquire).toMatchObject({
    mutates: true,
    json: true,
  });
  expect(acquire?.flags).toContain("--reason");
  expect(acquire?.exit_codes).toContain(3);
  expect(payload.commands?.some((command) => command.name === "capabilities")).toBe(true);
  expect(payload.commands?.some((command) => command.name === "robot-docs guide")).toBe(true);
  expect(payload.commands?.find((command) => command.name === "identify")?.id_only).toBe(false);
  expect(payload.commands?.find((command) => command.name === "prune")?.flags).toContain(
    "--dry-run",
  );
  expect(payload.exit_codes).toContainEqual({
    code: 3,
    name: "lock_conflict",
    meaning: "Lock conflict or ownership failure.",
  });
  expect(payload.env?.map((entry) => entry.name)).toContain("LOCKPICK_OWNER_SESSION");
});

test("robot docs guide matches golden output", async () => {
  const result = await runCli(["robot-docs", "guide"]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(
    await readFile(path.join(process.cwd(), "tests/goldens/robot-docs-guide.txt"), "utf8"),
  );
});
