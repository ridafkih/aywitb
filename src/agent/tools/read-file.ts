import { tool } from "ai";
import { z } from "zod";
import { join } from "node:path";
import type { Workspace } from "../../workspace/workspace.ts";

export function createReadFileTool(workspace: Workspace) {
  return tool({
    description: "Read the contents of a file in the workspace.",
    inputSchema: z.object({
      path: z.string().describe("Relative file path within the workspace"),
    }),
    execute: async ({ path }) => {
      const file = Bun.file(join(workspace.dir, path));
      if (!(await file.exists())) return { error: `File not found: ${path}` };
      return { content: await file.text() };
    },
  });
}
