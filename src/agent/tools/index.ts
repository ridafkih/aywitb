import type { Workspace } from "../../workspace/workspace.ts";
import { createWriteFileTool } from "./write-file.ts";
import { createReadFileTool } from "./read-file.ts";
import { createListFilesTool } from "./list-files.ts";
import { createExecuteTool } from "./execute.ts";
import { createRunTestsTool } from "./run-tests.ts";
import { createTypeCheckTool } from "./type-check.ts";
import { createFormatTool } from "./format.ts";

export function buildTools(workspace: Workspace) {
  return {
    writeFile: createWriteFileTool(workspace),
    readFile: createReadFileTool(workspace),
    listFiles: createListFilesTool(workspace),
    execute: createExecuteTool(workspace),
    runTests: createRunTestsTool(workspace),
    typeCheck: createTypeCheckTool(workspace),
    format: createFormatTool(workspace),
  };
}
