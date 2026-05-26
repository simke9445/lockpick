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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = lockExitCode(error) ?? 1;
    if (argv.includes("--json")) {
      console.log(JSON.stringify(cliErrorPayload(error, message), null, 2));
    } else {
      console.error(`lockpick error: ${message}`);
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
  return payload;
}
