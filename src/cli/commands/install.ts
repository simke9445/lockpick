import { renderInstallResult, runInstall } from "../../install";

export interface InstallCommandOptions {
  check: boolean;
  json: boolean;
}

export async function runInstallCommand(options: InstallCommandOptions): Promise<void> {
  const result = await runInstall({ check: options.check });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderInstallResult(result));
  }
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
