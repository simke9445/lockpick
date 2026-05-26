import { lockpickCapabilities, renderCapabilitiesText } from "./capabilities";
import { runInstallCommand } from "./commands/install";
import { lockExitCode, runLockCommand } from "./commands/lock";
import { helpText, parseCliArgs } from "./program";

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help || !parsed.command) {
      console.log(parsed.helpText ?? helpText());
      return;
    }

    switch (parsed.command.kind) {
      case "lock":
        await runLockCommand(parsed.command.command);
        return;
      case "install":
        await runInstallCommand(parsed.command.options);
        return;
      case "capabilities":
        if (parsed.command.options.json) {
          console.log(JSON.stringify(lockpickCapabilities()));
        } else {
          console.log(renderCapabilitiesText());
        }
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const suggestion = cliErrorSuggestion(error, message, argv);
    const exitCode = lockExitCode(error) ?? 1;
    if (argv.includes("--json")) {
      console.log(JSON.stringify(cliErrorPayload(error, message, suggestion), null, 2));
    } else {
      console.error(`lockpick error: ${renderCliErrorMessage(message, suggestion)}`);
    }
    process.exitCode = exitCode;
  }
}

function cliErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return typeof code === "string" && code.length > 0 ? code : "cli_error";
}

function cliErrorPayload(
  error: unknown,
  message: string,
  suggestion: CliErrorSuggestion | null = null,
): {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
} {
  const payload: {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
  } = {
    ok: false,
    code: cliErrorCode(error),
    message,
  };
  if (typeof error === "object" && error !== null && Reflect.has(error, "details")) {
    payload.details = Reflect.get(error, "details");
  }
  if (suggestion) {
    payload.details = { ...(isRecord(payload.details) ? payload.details : {}), suggestion };
  }
  return payload;
}

interface CliErrorSuggestion {
  replace: string;
  with: string;
  command: string;
}

const KNOWN_FLAGS = [
  "--check",
  "--dry-run",
  "--glob",
  "--id-only",
  "--json",
  "--lock",
  "--owner-session",
  "--reason",
  "--refresh-lock",
  "--release-lock",
  "--ttl-ms",
  "--verbose",
];

function renderCliErrorMessage(message: string, suggestion: CliErrorSuggestion | null): string {
  if (!suggestion) return message;
  return `${message}\nnext: ${suggestion.command}`;
}

function cliErrorSuggestion(
  error: unknown,
  message: string,
  argv: string[],
): CliErrorSuggestion | null {
  if (cliErrorCode(error) !== "commander.unknownOption") return null;
  const unknown = extractUnknownOption(message);
  if (!unknown) return null;
  const replacement = closestKnownFlag(unknown);
  if (!replacement) return null;
  return {
    replace: unknown,
    with: replacement,
    command: renderCorrectedCommand(argv, unknown, replacement),
  };
}

function extractUnknownOption(message: string): string | null {
  const match = message.match(/unknown option '([^']+)'/);
  return match?.[1] ?? null;
}

function closestKnownFlag(value: string): string | null {
  const ranked = KNOWN_FLAGS.map((flag) => ({ flag, distance: levenshtein(value, flag) })).sort(
    (left, right) => left.distance - right.distance || left.flag.localeCompare(right.flag),
  );
  const best = ranked[0];
  return best && best.distance <= 2 ? best.flag : null;
}

function renderCorrectedCommand(argv: string[], unknown: string, replacement: string): string {
  const corrected: string[] = [];
  for (const arg of argv) {
    const value = arg === unknown ? replacement : arg;
    if (value === replacement && corrected.includes(replacement)) continue;
    corrected.push(value);
  }
  return ["lockpick", ...corrected].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      const insertion = (current[rightIndex] ?? Number.POSITIVE_INFINITY) + 1;
      const deletion = (previous[rightIndex + 1] ?? Number.POSITIVE_INFINITY) + 1;
      const substitution = (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + cost;
      current[rightIndex + 1] = Math.min(insertion, deletion, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Number.POSITIVE_INFINITY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
