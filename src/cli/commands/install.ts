import { type InstallResult, renderInstallResult, runInstall } from "../../install";

export interface InstallCommandOptions {
  check: boolean;
  json: boolean;
  verbose: boolean;
}

export async function runInstallCommand(options: InstallCommandOptions): Promise<void> {
  const result = await runInstall({ check: options.check });
  if (options.json) {
    console.log(JSON.stringify(options.verbose ? result : compactInstallResult(result, options)));
  } else {
    console.log(renderInstallResult(result));
  }
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

function compactInstallResult(
  result: InstallResult,
  options: InstallCommandOptions,
): Record<string, unknown> {
  return {
    kind: "install",
    ok: result.ok,
    exitCode: result.exitCode,
    check: options.check,
    change_count: result.changes.length,
    changes: result.changes.map((change) => ({
      path: change.path,
      action: change.action,
    })),
    recommended_scripts: Object.keys(result.recommendedScripts).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}
