import type { LockResource } from "./types";
import { GIT_INDEX_RESOURCE } from "./types";

export function resourcesConflict(left: LockResource, right: LockResource): boolean {
  if (left.kind === "git" || right.kind === "git") {
    return left.kind === "git" && right.kind === "git" && left.value === GIT_INDEX_RESOURCE;
  }
  if (left.kind === "path" && right.kind === "path") return left.value === right.value;
  if (left.kind === "path" && right.kind === "glob") return globMatches(right.value, left.value);
  if (left.kind === "glob" && right.kind === "path") return globMatches(left.value, right.value);
  return globsMayOverlap(left.value, right.value);
}

export function conflictingResources(
  requested: LockResource[],
  existing: LockResource[],
): LockResource[] {
  return requested.filter((request) => existing.some((held) => resourcesConflict(request, held)));
}

export function resourceSetsConflict(left: LockResource[], right: LockResource[]): boolean {
  return left.some((leftResource) =>
    right.some((rightResource) => resourcesConflict(leftResource, rightResource)),
  );
}

export function globMatches(pattern: string, filePath: string): boolean {
  return globToRegExp(pattern).test(filePath);
}

function globsMayOverlap(left: string, right: string): boolean {
  const leftPrefix = staticPrefix(left);
  const rightPrefix = staticPrefix(right);
  if (leftPrefix === "" || rightPrefix === "") return true;
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
}

function staticPrefix(pattern: string): string {
  const firstGlob = pattern.search(/[*?]/);
  const rawPrefix = firstGlob === -1 ? pattern : pattern.slice(0, firstGlob);
  const slashIndex = rawPrefix.lastIndexOf("/");
  if (slashIndex === -1) return "";
  return rawPrefix.slice(0, slashIndex + 1);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index++;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&") ?? "";
  }
  source += "$";
  return new RegExp(source);
}
