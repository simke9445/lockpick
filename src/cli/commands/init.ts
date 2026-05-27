import { type InitHarness, type InitResult, renderInitResult, runInit } from "../../init";

export interface InitCommandOptions {
  check: boolean;
  json: boolean;
  verbose: boolean;
  harness: InitHarness;
}

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const result = await runInit({
    check: options.check,
    harness: options.harness,
  });
  if (options.json) {
    console.log(JSON.stringify(options.verbose ? result : compactInitResult(result, options)));
  } else {
    console.log(renderInitResult(result));
  }
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

function compactInitResult(
  result: InitResult,
  options: InitCommandOptions,
): Record<string, unknown> {
  return {
    kind: "init",
    ok: result.ok,
    exitCode: result.exitCode,
    check: options.check,
    harness: result.harness,
    resolved_harness: result.resolvedHarness,
    instructions_target: result.instructionsTarget,
    instructions_path: result.instructionsPath,
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
