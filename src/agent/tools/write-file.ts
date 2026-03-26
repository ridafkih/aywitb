import { tool } from "ai";
import { z } from "zod";
import { join } from "node:path";
import type { Workspace } from "../../workspace/workspace.ts";

export function createWriteFileTool(workspace: Workspace) {
  return tool({
    description:
      "Write content to a file in the workspace. Creates parent directories automatically.",
    inputSchema: z.object({
      path: z.string().describe("Relative file path within the workspace"),
      content: z.string().describe("Full file content to write"),
    }),
    execute: async ({ path, content }) => {
      const fullPath = join(workspace.dir, path);
      await Bun.write(fullPath, content);
      return { success: true, path };
    },
  });
}
