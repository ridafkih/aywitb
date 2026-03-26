import { tool } from "ai";
import { z } from "zod";
import type { Workspace } from "../../workspace/workspace.ts";

export function createRunTestsTool(workspace: Workspace) {
  return tool({
    description:
      "Run tests using `bun test` in the workspace. Returns test output and pass/fail status.",
    inputSchema: z.object({
      testFile: z
        .string()
        .optional()
        .describe(
          "Specific test file to run, or omit to run all tests",
        ),
    }),
    execute: async ({ testFile }) => {
      const args = ["bun", "test"];
      if (testFile) args.push(testFile);

      const result = Bun.spawnSync(args, {
        cwd: workspace.dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      });
      const stdout = result.stdout.toString().slice(0, 10_000);
      const stderr = result.stderr.toString().slice(0, 10_000);
      return {
        stdout,
        stderr,
        exitCode: result.exitCode,
        passed: result.exitCode === 0,
      };
    },
  });
}
