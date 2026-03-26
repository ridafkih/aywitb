import { tool } from "ai";
import { z } from "zod";
import type { Workspace } from "../../workspace/workspace.ts";

export function createListFilesTool(workspace: Workspace) {
  return tool({
    description: "List all files in the workspace directory tree.",
    inputSchema: z.object({}),
    execute: async () => {
      const glob = new Bun.Glob("**/*");
      const files: string[] = [];
      for await (const path of glob.scan({ cwd: workspace.dir })) {
        files.push(path);
      }
      return { files };
    },
  });
}
