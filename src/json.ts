export function stableStringify(value: unknown, space = 2): string {
  return JSON.stringify(sortJsonValue(value), null, space);
}

export function formatJsonArtifact(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item));
  if (!isPlainObject(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) sorted[key] = sortJsonValue(entry);
  }
  return sorted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}
