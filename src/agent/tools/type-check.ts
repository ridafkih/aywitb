import { tool } from "ai";
import { z } from "zod";
import type { Workspace } from "../../workspace/workspace.ts";

export function createTypeCheckTool(workspace: Workspace) {
  return tool({
    description:
      "Run TypeScript type checking on the workspace with `tsc --noEmit`. Returns any type errors found.",
    inputSchema: z.object({}),
    execute: async () => {
      const result = Bun.spawnSync(
        ["bunx", "tsc", "--noEmit", "--pretty"],
        {
          cwd: workspace.dir,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output =
        result.stdout.toString().slice(0, 10_000) +
        result.stderr.toString().slice(0, 10_000);
      return {
        diagnostics: output,
        passed: result.exitCode === 0,
      };
    },
  });
}
