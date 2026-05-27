import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  executeLockCommand,
  FileLockRegistry,
  type LockOwner,
  lockOwnerSessionId,
  lockOwnerSource,
  normalizeLockResources,
  renderLockResult,
  resolveLockpickConfig,
  resourcesConflict,
} from "../src/index";

test("normalizes safe repo-relative path and glob resources", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "existing.ts"), "export {};\n", "utf8");

    const resources = await normalizeLockResources({
      cwd: workspace,
      paths: ["./src/existing.ts", "src/new.ts"],
      globs: ["src/**/*.test.ts"],
    });

    expect(resources).toEqual([
      { kind: "path", value: "src/existing.ts" },
      { kind: "path", value: "src/new.ts" },
      { kind: "glob", value: "src/**/*.test.ts" },
    ]);
    await expect(
      normalizeLockResources({ cwd: workspace, paths: ["/tmp/outside.ts"] }),
    ).rejects.toThrow("repo-relative");
    await expect(
      normalizeLockResources({ cwd: workspace, paths: ["../outside.ts"] }),
    ).rejects.toThrow("inside the repository");
  });
});

test("detects exact, path-glob, conservative glob, and git-index conflicts", () => {
  expect(
    resourcesConflict(
      { kind: "path", value: "src/locks/registry.ts" },
      { kind: "path", value: "src/locks/registry.ts" },
    ),
  ).toBe(true);
  expect(
    resourcesConflict(
      { kind: "path", value: "src/locks/registry.ts" },
      { kind: "glob", value: "src/**/*.ts" },
    ),
  ).toBe(true);
  expect(
    resourcesConflict(
      { kind: "glob", value: "src/locks/**/*.ts" },
      { kind: "glob", value: "src/**/*.ts" },
    ),
  ).toBe(true);
  expect(
    resourcesConflict(
      { kind: "glob", value: "src/**/*.ts" },
      { kind: "glob", value: "tests/**/*.ts" },
    ),
  ).toBe(false);
  expect(
    resourcesConflict(
      { kind: "git", value: "@git/index" },
      { kind: "path", value: "src/unrelated.ts" },
    ),
  ).toBe(false);
});

test("acquire defaults to .lockpick/locks and reports overlapping conflicts", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(path.join(workspace, "src", "locks"), { recursive: true });
    await writeFile(path.join(workspace, "src", "locks", "registry.ts"), "export {};\n", "utf8");
    const registry = testRegistry(workspace, new Date("2026-05-04T10:00:00Z"));

    const acquired = await registry.acquire({
      paths: ["src/locks/registry.ts"],
      reason: "edit registry",
      ownerSessionId: "session-a",
    });
    expect(acquired.exitCode).toBe(0);
    expect(acquired.lock?.resources).toEqual([{ kind: "path", value: "src/locks/registry.ts" }]);
    await expect(stat(path.join(workspace, ".lockpick", "locks", "active"))).resolves.toBeTruthy();

    const conflict = await registry.acquire({
      globs: ["src/**/*.ts"],
      reason: "format src",
      ownerSessionId: "session-b",
    });
    expect(conflict.exitCode).toBe(3);
    expect(conflict.suggestedAction).toBe("retry_later");
    expect(conflict.conflicts?.[0]?.lock.lockId).toBe(acquired.lock?.lockId);
  });
});

test("expand is atomic when the requested resource conflicts", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await writeFile(path.join(workspace, "src", "b.ts"), "export const b = 1;\n", "utf8");
    const registry = testRegistry(workspace, new Date("2026-05-04T10:00:00Z"));

    const first = await registry.acquire({
      paths: ["src/a.ts"],
      reason: "edit a",
      ownerSessionId: "session-a",
    });
    await registry.acquire({ paths: ["src/b.ts"], reason: "edit b", ownerSessionId: "session-b" });

    const expanded = await registry.expand({
      lockId: first.lock?.lockId ?? "",
      paths: ["src/b.ts"],
      ownerSessionId: "session-a",
    });
    expect(expanded.exitCode).toBe(3);

    const status = await registry.status({ paths: ["src/a.ts"] });
    expect(status.locks?.[0]?.lock.resources).toEqual([{ kind: "path", value: "src/a.ts" }]);
  });
});

test("refresh, release, and expand require the owning session", async () => {
  await withWorkspace(async (workspace) => {
    const registry = testRegistry(workspace, new Date("2026-05-04T10:00:00Z"));
    const acquired = await registry.acquire({
      paths: ["src/locks/registry.ts"],
      reason: "edit registry",
      ownerSessionId: "session-a",
    });
    const lockId = acquired.lock?.lockId ?? "";

    await expect(registry.refresh(lockId, null, "session-b")).rejects.toThrow(
      "is owned by session-a",
    );
    await expect(
      registry.expand({ lockId, paths: ["src/locks/types.ts"], ownerSessionId: "session-b" }),
    ).rejects.toThrow("is owned by session-a");
    await expect(registry.release(lockId, "session-b")).rejects.toThrow("is owned by session-a");

    expect((await registry.refresh(lockId, null, "session-a")).exitCode).toBe(0);
    expect((await registry.release(lockId, "session-a")).exitCode).toBe(0);
  });
});

test("unknown liveness does not make expired sessions permanent", async () => {
  await withWorkspace(async (workspace) => {
    let now = new Date("2026-05-04T10:00:00Z");
    const registry = testRegistry(
      workspace,
      () => now,
      () => ({
        status: "unknown",
        evidence: "fixture unknown",
      }),
    );

    await registry.acquire({
      paths: ["stale.ts"],
      reason: "owner disappeared",
      ttlMs: 1000,
      ownerSessionId: "missing-session",
    });
    now = new Date("2026-05-04T10:00:02Z");
    expect((await registry.status()).locks?.[0]?.status).toBe("expired-unknown");

    now = new Date("2026-05-04T10:11:00Z");
    const pruned = await registry.prune();
    expect(pruned.pruned).toHaveLength(1);
    expect((await registry.status()).locks).toHaveLength(0);
  });
});

test("@git/index conflicts only with another git lock", async () => {
  await withWorkspace(async (workspace) => {
    const registry = testRegistry(workspace, new Date("2026-05-04T10:00:00Z"));
    const git = await registry.acquire({
      includeGitIndex: true,
      reason: "commit",
      ownerSessionId: "session-a",
    });
    const file = await registry.acquire({
      paths: ["src/unrelated.ts"],
      reason: "edit file",
      ownerSessionId: "session-b",
    });
    const secondGit = await registry.acquire({
      includeGitIndex: true,
      reason: "commit again",
      ownerSessionId: "session-c",
    });

    expect(git.exitCode).toBe(0);
    expect(file.exitCode).toBe(0);
    expect(secondGit.exitCode).toBe(3);
  });
});

test("owner detection supports explicit, configured env, and fallback session ids", async () => {
  await withWorkspace(async (workspace) => {
    const harnessEnv = {
      CODEX_THREAD_ID: "codex-thread",
      CLAUDE_CODE_SESSION_ID: "claude-session",
    } as NodeJS.ProcessEnv;
    const explicit = new FileLockRegistry({ cwd: workspace, env: harnessEnv }).identify(
      "explicit-session",
    );
    expect(explicit.owner ? lockOwnerSessionId(explicit.owner) : null).toBe("explicit-session");
    expect(explicit.owner ? lockOwnerSource(explicit.owner) : null).toBe("explicit");

    const env = {
      CUSTOM_LOCK_OWNER: "env-session",
      CODEX_THREAD_ID: "codex-thread",
    } as NodeJS.ProcessEnv;
    const configured = new FileLockRegistry({
      cwd: workspace,
      env,
      ownerEnvKeys: ["CUSTOM_LOCK_OWNER"],
    }).identify();
    expect(configured.owner ? lockOwnerSessionId(configured.owner) : null).toBe("env-session");
    expect(configured.owner ? lockOwnerSource(configured.owner) : null).toBe(
      "env:CUSTOM_LOCK_OWNER",
    );

    const codex = new FileLockRegistry({
      cwd: workspace,
      env: { CODEX_THREAD_ID: "codex-thread" },
    }).identify();
    expect(codex.owner ? lockOwnerSessionId(codex.owner) : null).toBe("codex:codex-thread");
    expect(codex.owner ? lockOwnerSource(codex.owner) : null).toBe(
      "harness:codex:CODEX_THREAD_ID",
    );
    expect(codex.owner?.harness).toBe("codex");
    expect(codex.owner?.harnessScope).toBe("agent");
    expect(codex.owner?.rawSessionId).toBe("codex-thread");

    const claude = new FileLockRegistry({
      cwd: workspace,
      env: { CLAUDE_CODE_SESSION_ID: "claude-session" },
    }).identify();
    expect(claude.owner ? lockOwnerSessionId(claude.owner) : null).toBe(
      "claude-code:claude-session",
    );
    expect(claude.owner ? lockOwnerSource(claude.owner) : null).toBe(
      "harness:claude-code:CLAUDE_CODE_SESSION_ID",
    );
    expect(claude.owner?.harness).toBe("claude-code");
    expect(claude.owner?.harnessScope).toBe("session");

    const hookMain = new FileLockRegistry({
      cwd: workspace,
      env: { LOCKPICK_OWNER_SESSION: "claude-code:claude-session:main" },
    }).identify();
    expect(hookMain.owner?.harness).toBe("claude-code");
    expect(hookMain.owner?.harnessScope).toBe("main");
    expect(hookMain.owner?.rawSessionId).toBe("claude-session");

    const hookAgent = new FileLockRegistry({
      cwd: workspace,
      env: { LOCKPICK_OWNER_SESSION: "claude-code:claude-session:agent:agent-1" },
    }).identify();
    expect(hookAgent.owner?.harness).toBe("claude-code");
    expect(hookAgent.owner?.harnessScope).toBe("agent");
    expect(hookAgent.owner?.agentId).toBe("agent-1");

    const fallback = new FileLockRegistry({ cwd: workspace, env: {} }).identify();
    expect(
      fallback.owner ? lockOwnerSessionId(fallback.owner).startsWith("lockpick:") : false,
    ).toBe(true);
    expect(fallback.owner ? lockOwnerSource(fallback.owner) : null).toBe("fallback");
    expect(fallback.owner?.harness).toBe("lockpick");
    expect(fallback.owner?.harnessScope).toBe("fallback");
  });
});

test("lock command output is compact by default and renders lockpick commands", async () => {
  await withWorkspace(async (workspace) => {
    const config = resolveLockpickConfig({}, { root: workspace });
    const acquired = await executeLockCommand(
      {
        name: "acquire",
        paths: ["src/cli/program.ts"],
        globs: [],
        reason: "parse lock command",
        ttlMs: null,
        ownerSession: "session-a",
        json: true,
        idOnly: false,
      },
      { cwd: workspace, config },
    );
    const conflictRegistry = testRegistry(
      workspace,
      () => new Date("2030-05-04T11:00:00Z"),
      () => ({ status: "dead", evidence: "fixture dead" }),
    );
    const conflict = await conflictRegistry.acquire({
      paths: ["src/cli/program.ts"],
      reason: "other edit",
      ownerSessionId: "session-b",
    });

    expect(acquired.exitCode).toBe(0);
    expect(acquired.json).toMatchObject({
      kind: "acquired",
      exitCode: 0,
      lock_id: expect.stringMatching(/^lock_/),
    });
    expect((acquired.json as { lock?: unknown }).lock).toBeUndefined();
    expect(acquired.text).toContain("lock acquired:");
    expect(acquired.text).not.toContain("resources:");
    expect(renderLockResult(conflict, false, config)).toContain("lockpick prune, then retry");
  });
});

test("lock command supports compact ids and batched refresh and release", async () => {
  await withWorkspace(async (workspace) => {
    const config = resolveLockpickConfig({}, { root: workspace });
    const first = await executeLockCommand(
      {
        name: "acquire",
        paths: ["src/cli/program.ts"],
        globs: [],
        reason: "edit parser",
        ttlMs: null,
        ownerSession: "session-a",
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config },
    );
    const second = await executeLockCommand(
      {
        name: "acquire",
        paths: ["tests/cli.test.ts"],
        globs: [],
        reason: "edit parser tests",
        ttlMs: null,
        ownerSession: "session-a",
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config },
    );
    const ids = [first.text.trim(), second.text.trim()];

    const refreshed = await executeLockCommand(
      {
        name: "refresh",
        lockIds: ids,
        ttlMs: null,
        ownerSession: "session-a",
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config },
    );
    const released = await executeLockCommand(
      {
        name: "release",
        lockIds: ids,
        ownerSession: "session-a",
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config },
    );

    expect(first.text).toMatch(/^lock_/);
    expect(second.text).toMatch(/^lock_/);
    expect(refreshed.text.split("\n")).toEqual(ids);
    expect(released.text.split("\n")).toEqual(ids);
  });
});

test("prune id-only returns pruned lock ids", async () => {
  await withWorkspace(async (workspace) => {
    let now = new Date("2026-05-04T10:00:00Z");
    const config = resolveLockpickConfig({}, { root: workspace });
    const registryOptions = {
      now: () => now,
      sessionProbe: () => ({ status: "dead" as const, evidence: "fixture dead" }),
    };
    const acquired = await executeLockCommand(
      {
        name: "acquire",
        paths: ["stale.ts"],
        globs: [],
        reason: "stale lock",
        ttlMs: 1000,
        ownerSession: "session-a",
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config, registryOptions },
    );
    now = new Date("2026-05-04T10:00:02Z");

    const pruned = await executeLockCommand(
      {
        name: "prune",
        dryRun: false,
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config, registryOptions },
    );

    expect(pruned.exitCode).toBe(0);
    expect(pruned.text.trim()).toBe(acquired.text.trim());
  });
});

test("prune dry-run reports reclaimable locks without deleting", async () => {
  await withWorkspace(async (workspace) => {
    let now = new Date("2026-05-04T10:00:00Z");
    const config = resolveLockpickConfig({}, { root: workspace });
    const registryOptions = {
      now: () => now,
      sessionProbe: () => ({ status: "dead" as const, evidence: "fixture dead" }),
    };
    const acquired = await executeLockCommand(
      {
        name: "acquire",
        paths: ["stale.ts"],
        globs: [],
        reason: "stale lock",
        ttlMs: 1000,
        ownerSession: "session-a",
        json: false,
        idOnly: true,
      },
      { cwd: workspace, config, registryOptions },
    );
    now = new Date("2026-05-04T10:00:02Z");

    const planned = await executeLockCommand(
      {
        name: "prune",
        dryRun: true,
        json: true,
        idOnly: false,
      },
      { cwd: workspace, config, registryOptions },
    );
    const statusAfterPlan = await executeLockCommand(
      {
        name: "status",
        paths: [],
        globs: [],
        json: true,
        idOnly: false,
      },
      { cwd: workspace, config, registryOptions },
    );

    expect(planned.json).toMatchObject({
      kind: "pruned",
      dry_run: true,
      pruned_count: 1,
      pruned_lock_ids: [acquired.text.trim()],
    });
    expect(statusAfterPlan.json).toMatchObject({
      kind: "status",
      lock_count: 1,
      lock_ids: [acquired.text.trim()],
    });
  });
});

function testRegistry(
  workspace: string,
  now: Date | (() => Date),
  sessionProbe: (owner: LockOwner) => {
    status: "live" | "dead" | "unknown";
    evidence: string;
  } = () => ({
    status: "dead",
    evidence: "fixture default",
  }),
  overrides: ConstructorParameters<typeof FileLockRegistry>[0] = {},
): FileLockRegistry {
  return new FileLockRegistry({
    cwd: workspace,
    now: typeof now === "function" ? now : () => now,
    sessionProbe: (owner) => sessionProbe(owner),
    ...overrides,
  });
}

async function withWorkspace(fn: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "lockpick-locks-"));
  try {
    await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
