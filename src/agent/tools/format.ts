import { tool } from "ai";
import { z } from "zod";
import { join } from "node:path";
import type { Workspace } from "../../workspace/workspace.ts";

export function createFormatTool(workspace: Workspace) {
  return tool({
    description: "Format a source file using Prettier.",
    inputSchema: z.object({
      path: z.string().describe("Relative file path to format"),
    }),
    execute: async ({ path }) => {
      const result = Bun.spawnSync(
        ["bunx", "prettier", "--write", path],
        {
          cwd: workspace.dir,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      if (result.exitCode !== 0) {
        return {
          formatted: false,
          error: result.stderr.toString().slice(0, 5_000),
        };
      }
      return { formatted: true, path };
    },
  });
}
