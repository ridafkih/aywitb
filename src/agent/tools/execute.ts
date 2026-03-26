import { tool } from "ai";
import { z } from "zod";
import type { Workspace } from "../../workspace/workspace.ts";

export function createExecuteTool(workspace: Workspace) {
  return tool({
    description:
      "Execute a shell command in the workspace directory. Use for installing packages, running scripts, or any shell operation.",
    inputSchema: z.object({
      command: z
        .string()
        .describe("Shell command to execute in the workspace"),
    }),
    execute: async ({ command }) => {
      const result = Bun.spawnSync(["bash", "-c", command], {
        cwd: workspace.dir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NODE_ENV: "development" },
      });
      return {
        stdout: result.stdout.toString().slice(0, 10_000),
        stderr: result.stderr.toString().slice(0, 10_000),
        exitCode: result.exitCode,
      };
    },
  });
}
