import { executeLockCommand } from "../../locks/commands";
import { type LockCommand, LockCommandError } from "../../locks/types";

export async function runLockCommand(command: LockCommand): Promise<void> {
  const result = await executeLockCommand(command);
  if (command.json) {
    console.log(
      JSON.stringify(result.json ?? { text: result.text }, null, command.verbose ? 2 : 0),
    );
  } else {
    console.log(result.text);
  }
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

export function lockExitCode(error: unknown): number | null {
  if (error instanceof LockCommandError) return error.exitCode;
  return null;
}
