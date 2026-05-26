import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lockpickAgentsSnippet, resolveLockpickConfig, runInstall } from "../src/index";

test("install creates support files in an empty repo", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "package.json"), '{"scripts":{}}\n', "utf8");

    const result = await runInstall({ root: workspace });
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
      "lockRoot",
    );
  });
});

test("install updates existing AGENTS and .gitignore without overwriting unrelated content", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "AGENTS.md"), "# Existing\n\nKeep this.\n", "utf8");
    await writeFile(path.join(workspace, ".gitignore"), "node_modules/\n", "utf8");
    await writeFile(
      path.join(workspace, "package.json"),
      '{"scripts":{"test":"bun test"}}\n',
      "utf8",
    );

    await runInstall({ root: workspace });

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

test("install preserves existing config and is idempotent", async () => {
  await withWorkspace(async (workspace) => {
    const configText = 'export default { projectName: "Custom", lockRoot: ".custom-locks" };\n';
    await writeFile(path.join(workspace, "lockpick.config.ts"), configText, "utf8");
    await writeFile(path.join(workspace, "package.json"), '{"scripts":{}}\n', "utf8");

    await runInstall({ root: workspace });
    expect(await readFile(path.join(workspace, "lockpick.config.ts"), "utf8")).toBe(configText);

    const rerun = await runInstall({ root: workspace });
    expect(rerun.ok).toBe(true);
    expect(rerun.changes.every((change) => ["unchanged", "exists"].includes(change.action))).toBe(
      true,
    );
  });
});

test("install check reports missing files without writing", async () => {
  await withWorkspace(async (workspace) => {
    const result = await runInstall({ root: workspace, check: true });
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
  const workspace = await mkdtemp(path.join(os.tmpdir(), "lockpick-install-"));
  try {
    await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
