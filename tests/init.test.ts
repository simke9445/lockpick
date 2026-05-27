import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_LOCKPICK_OWNER_HOOK_PATH,
  lockpickAgentsSnippet,
  resolveLockpickConfig,
  runInit,
} from "../src/index";

test("init creates support files in an empty repo", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "package.json"), '{"scripts":{}}\n', "utf8");

    const result = await runInit({ root: workspace });
    expect(result.exitCode).toBe(0);
    expect(result.changes.map((change) => change.action)).toContain("created");

    const agents = await readFile(path.join(workspace, "AGENTS.md"), "utf8");
    const gitignore = await readFile(path.join(workspace, ".gitignore"), "utf8");
    const packageJson = JSON.parse(
      await readFile(path.join(workspace, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(agents).toContain("Lockpick advisory locks");
    expect(agents).toContain("lockpick acquire");
    expect(gitignore).toContain(".lockpick/");
    expect(packageJson.scripts.lockpick).toBe("lockpick");
    await expect(readFile(path.join(workspace, "lockpick.config.ts"), "utf8")).resolves.toContain(
      'harnesses: ["codex", "claude-code"]',
    );
  });
});

test("init updates existing AGENTS and .gitignore without overwriting unrelated content", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "AGENTS.md"), "# Existing\n\nKeep this.\n", "utf8");
    await writeFile(path.join(workspace, ".gitignore"), "node_modules/\n", "utf8");
    await writeFile(
      path.join(workspace, "package.json"),
      '{"scripts":{"test":"bun test"}}\n',
      "utf8",
    );

    await runInit({ root: workspace });

    const agents = await readFile(path.join(workspace, "AGENTS.md"), "utf8");
    const gitignore = await readFile(path.join(workspace, ".gitignore"), "utf8");
    const packageJson = JSON.parse(
      await readFile(path.join(workspace, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(agents).toContain("Keep this.");
    expect(agents).toContain("<!-- lockpick:start -->");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".lockpick/");
    expect(packageJson.scripts.test).toBe("bun test");
    expect(packageJson.scripts.lockpick).toBe("lockpick");
  });
});

test("init can target CLAUDE instructions for Claude Code harness", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "package.json"), '{"scripts":{}}\n', "utf8");

    const result = await runInit({ root: workspace, harness: "claude-code" });

    expect(result.resolvedHarness).toBe("claude-code");
    expect(result.instructionsTarget).toBe("claude");
    expect(result.instructionsPath).toBe("CLAUDE.md");
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "CLAUDE.md", action: "created" }),
        expect.objectContaining({
          path: CLAUDE_LOCKPICK_OWNER_HOOK_PATH,
          action: "created",
        }),
        expect.objectContaining({ path: ".claude/settings.json", action: "created" }),
      ]),
    );
    await expect(readFile(path.join(workspace, "AGENTS.md"), "utf8")).rejects.toThrow();
    const claude = await readFile(path.join(workspace, "CLAUDE.md"), "utf8");
    expect(claude).toContain("Lockpick advisory locks");
    expect(claude).toContain("<!-- lockpick:start -->");

    const settings = JSON.parse(
      await readFile(path.join(workspace, ".claude/settings.json"), "utf8"),
    ) as {
      hooks?: { PreToolUse?: Array<{ matcher?: unknown; hooks?: unknown[] }> };
    };
    expect(settings.hooks?.PreToolUse?.[0]?.matcher).toBe("Bash");
    expect(settings.hooks?.PreToolUse?.[0]?.hooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command",
          command: "node",
          args: ["$" + "{CLAUDE_PROJECT_DIR}/.claude/hooks/lockpick-owner-env.mjs"],
        }),
      ]),
    );
  });
});

test("Claude owner hook prefixes Lockpick Bash commands with main or agent owner", async () => {
  await withWorkspace(async (workspace) => {
    await runInit({ root: workspace, harness: "claude-code" });
    const hookPath = path.join(workspace, CLAUDE_LOCKPICK_OWNER_HOOK_PATH);

    await expect(
      runHook(hookPath, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        tool_name: "Read",
        tool_input: { file_path: "README.md" },
      }),
    ).resolves.toBe("");

    await expect(
      runHook(hookPath, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        tool_name: "Bash",
        tool_input: { command: "echo lockpick" },
      }),
    ).resolves.toBe("");

    const main = JSON.parse(
      await runHook(hookPath, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        tool_name: "Bash",
        tool_input: { command: "lockpick acquire README.md --reason edit" },
      }),
    ) as {
      hookSpecificOutput?: {
        additionalContext?: unknown;
        permissionDecision?: unknown;
        updatedInput?: { command?: unknown };
      };
    };
    expect(main.hookSpecificOutput?.additionalContext).toBeUndefined();
    expect(main.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(main.hookSpecificOutput?.updatedInput?.command).toBe(
      "export LOCKPICK_OWNER_SESSION='claude-code:session-1:main'; lockpick acquire README.md --reason edit",
    );

    const agent = JSON.parse(
      await runHook(hookPath, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        agent_id: "agent-1",
        agent_type: "Explore",
        tool_name: "Bash",
        tool_input: { command: "bun run --silent lockpick -- acquire README.md --reason edit" },
      }),
    ) as {
      hookSpecificOutput?: {
        updatedInput?: { command?: unknown };
      };
    };
    expect(agent.hookSpecificOutput?.updatedInput?.command).toBe(
      "export LOCKPICK_OWNER_SESSION='claude-code:session-1:agent:agent-1'; bun run --silent lockpick -- acquire README.md --reason edit",
    );
  });
});

test("Claude owner hook does not override explicit Lockpick owners", async () => {
  await withWorkspace(async (workspace) => {
    await runInit({ root: workspace, harness: "claude-code" });
    const hookPath = path.join(workspace, CLAUDE_LOCKPICK_OWNER_HOOK_PATH);
    await expect(
      runHook(hookPath, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        agent_id: "agent-1",
        tool_name: "Bash",
        tool_input: {
          command: "LOCKPICK_OWNER_SESSION=custom lockpick status",
        },
      }),
    ).resolves.toBe("");
    await expect(
      runHook(hookPath, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        agent_id: "agent-1",
        tool_name: "Bash",
        tool_input: {
          command: "lockpick acquire README.md --reason edit --owner-session custom",
        },
      }),
    ).resolves.toBe("");
  });
});

test("init preserves existing config and is idempotent", async () => {
  await withWorkspace(async (workspace) => {
    const configText = 'export default { projectName: "Custom", lockRoot: ".custom-locks" };\n';
    await writeFile(path.join(workspace, "lockpick.config.ts"), configText, "utf8");
    await writeFile(path.join(workspace, "package.json"), '{"scripts":{}}\n', "utf8");

    await runInit({ root: workspace });
    expect(await readFile(path.join(workspace, "lockpick.config.ts"), "utf8")).toBe(configText);

    const rerun = await runInit({ root: workspace });
    expect(rerun.ok).toBe(true);
    expect(rerun.changes.every((change) => ["unchanged", "exists"].includes(change.action))).toBe(
      true,
    );
  });
});

test("init check reports missing files without writing", async () => {
  await withWorkspace(async (workspace) => {
    const result = await runInit({ root: workspace, check: true });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.changes.some((change) => change.action === "would_create")).toBe(true);
    await expect(readFile(path.join(workspace, "AGENTS.md"), "utf8")).rejects.toThrow();
  });
});

test("generated AGENTS snippet renders lockpick command usage", () => {
  const config = resolveLockpickConfig({}, { root: process.cwd() });
  const snippet = lockpickAgentsSnippet(config);
  expect(snippet).toContain("lockpick acquire");
  expect(snippet).toContain("lockpick refresh");
});

async function withWorkspace(fn: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "lockpick-init-"));
  try {
    await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runHook(hookPath: string, input: unknown): Promise<string> {
  const child = spawn("node", [hookPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(stderrChunks).toString("utf8") || `hook exited ${exitCode}`);
  }
  return Buffer.concat(stdoutChunks).toString("utf8").trim();
}
