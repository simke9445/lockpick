import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import packageJson from "../../package.json";

const PACKAGE_NAME = "@simke9445/lockpick";
const REGISTRY_URL = "https://registry.npmjs.org/@simke9445%2flockpick/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 750;

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

interface UpdateCache {
  checkedAt: string;
  latestVersion: string;
}

export interface UpdateNoticeOptions {
  argv?: readonly string[];
  cachePath?: string;
  currentVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: Date;
  stderr?: Pick<NodeJS.WriteStream, "isTTY" | "write">;
  timeoutMs?: number;
}

export async function maybePrintUpdateNotice(options: UpdateNoticeOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? process.stderr;
  const argv = options.argv ?? process.argv.slice(2);
  if (!shouldCheckForUpdates({ argv, env, stderr })) return;

  const currentVersion = options.currentVersion ?? packageJson.version;
  const now = options.now ?? new Date();
  const cachePath = options.cachePath ?? defaultUpdateCachePath(env);
  const cached = await readUpdateCache(cachePath);

  if (cached && now.getTime() - Date.parse(cached.checkedAt) < CACHE_TTL_MS) {
    writeNoticeIfNewer(stderr, currentVersion, cached.latestVersion);
    return;
  }

  const latestVersion = await fetchLatestVersion({
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
  });
  if (!latestVersion) return;

  await writeUpdateCache(cachePath, {
    checkedAt: now.toISOString(),
    latestVersion,
  });
  writeNoticeIfNewer(stderr, currentVersion, latestVersion);
}

export function renderUpdateNotice(currentVersion: string, latestVersion: string): string {
  return [
    `New Lockpick version available: ${currentVersion} -> ${latestVersion}`,
    `Update with: bun update -g --latest ${PACKAGE_NAME}`,
    `npm users: npm install -g ${PACKAGE_NAME}@latest`,
  ].join("\n");
}

export function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseSemver(latestVersion);
  const current = parseSemver(currentVersion);
  if (!latest || !current) return latestVersion !== currentVersion;

  for (const key of ["major", "minor", "patch"] as const) {
    if (latest[key] > current[key]) return true;
    if (latest[key] < current[key]) return false;
  }

  if (!latest.prerelease && current.prerelease) return true;
  if (latest.prerelease && !current.prerelease) return false;
  return Boolean(
    latest.prerelease &&
      current.prerelease &&
      latest.prerelease.localeCompare(current.prerelease, undefined, { numeric: true }) > 0,
  );
}

function shouldCheckForUpdates(options: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stderr: Pick<NodeJS.WriteStream, "isTTY" | "write">;
}): boolean {
  if (truthyEnv(options.env.LOCKPICK_DISABLE_UPDATE_CHECK)) return false;
  if (truthyEnv(options.env.NO_UPDATE_NOTIFIER)) return false;
  if (truthyEnv(options.env.LOCKPICK_UPDATE_CHECK)) return true;
  if (truthyEnv(options.env.CI)) return false;
  if (!options.stderr.isTTY) return false;
  return !options.argv.includes("--json") && !options.argv.includes("--id-only");
}

async function fetchLatestVersion(options: {
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(REGISTRY_URL, {
      headers: {
        accept: "application/json",
        "user-agent": `lockpick/${packageJson.version}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!isRecord(payload) || typeof payload.version !== "string") return null;
    return payload.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readUpdateCache(cachePath: string): Promise<UpdateCache | null> {
  try {
    const payload = JSON.parse(await fs.readFile(cachePath, "utf8")) as unknown;
    if (
      isRecord(payload) &&
      typeof payload.checkedAt === "string" &&
      typeof payload.latestVersion === "string"
    ) {
      return { checkedAt: payload.checkedAt, latestVersion: payload.latestVersion };
    }
  } catch {
    return null;
  }
  return null;
}

async function writeUpdateCache(cachePath: string, cache: UpdateCache): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  } catch {
    // Update checks are opportunistic and must never affect lock commands.
  }
}

function writeNoticeIfNewer(
  stderr: Pick<NodeJS.WriteStream, "write">,
  currentVersion: string,
  latestVersion: string,
): void {
  if (!isNewerVersion(latestVersion, currentVersion)) return;
  stderr.write(`${renderUpdateNotice(currentVersion, latestVersion)}\n`);
}

function defaultUpdateCachePath(env: NodeJS.ProcessEnv): string {
  const cacheRoot = env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");
  return path.join(cacheRoot, "lockpick", "update-check.json");
}

function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function truthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
