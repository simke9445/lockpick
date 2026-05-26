import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
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

test("json parse errors are machine-readable", async () => {
  const result = await runCli(["acquire", "src/index.ts", "--ttl-ms", "10abc", "--json"]);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toBe("");
  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(payload.ok).toBe(false);
  expect(payload.code).toBe("commander.invalidArgument");
  expect(payload.message).toEqual(expect.stringContaining("--ttl-ms"));
});
