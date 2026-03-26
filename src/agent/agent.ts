import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { buildTools } from "./tools/index.ts";
import { loadSystemPrompt } from "../prompt/loader.ts";
import { createWorkspace } from "../workspace/workspace.ts";
import type { EntryOptions } from "../config.ts";

export interface AgentResult {
  entrypoint: string;
  files: Record<string, string>;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + dim(`… (${s.length - max} more chars)`);
}

function formatToolCall(call: { toolName: string; args: Record<string, unknown> }): string {
  switch (call.toolName) {
    case "writeFile":
      return `${cyan("writeFile")} ${dim("→")} ${call.args.path}`;
    case "readFile":
      return `${cyan("readFile")} ${dim("→")} ${call.args.path}`;
    case "listFiles":
      return cyan("listFiles");
    case "execute":
      return `${cyan("execute")} ${dim("→")} ${dim(String(call.args.command))}`;
    case "runTests":
      return `${cyan("runTests")}${call.args.testFile ? ` ${dim("→")} ${call.args.testFile}` : ""}`;
    case "typeCheck":
      return cyan("typeCheck");
    case "format":
      return `${cyan("format")} ${dim("→")} ${call.args.path}`;
    default:
      return `${cyan(call.toolName)} ${dim(JSON.stringify(call.args))}`;
  }
}

function formatToolResult(call: { toolName: string }, result: unknown): string | null {
  const r = result as Record<string, unknown>;
  switch (call.toolName) {
    case "writeFile":
      return null;
    case "readFile":
      if (r.error) return red(String(r.error));
      return dim(truncate(String(r.content), 200));
    case "listFiles":
      return dim((r.files as string[]).join(", "));
    case "execute": {
      const parts: string[] = [];
      if (r.stdout) parts.push(truncate(String(r.stdout).trim(), 300));
      if (r.stderr) parts.push(red(truncate(String(r.stderr).trim(), 200)));
      if (r.exitCode !== 0) parts.push(red(`exit ${r.exitCode}`));
      return parts.join("\n") || null;
    }
    case "runTests": {
      const passed = r.passed as boolean;
      const icon = passed ? green("pass") : red("fail");
      const parts = [icon];
      const output = (String(r.stdout || "") + String(r.stderr || "")).trim();
      if (output && !passed) parts.push(dim(truncate(output, 400)));
      return parts.join("\n");
    }
    case "typeCheck": {
      const passed = r.passed as boolean;
      if (passed) return green("pass");
      return red("fail\n") + dim(truncate(String(r.diagnostics).trim(), 400));
    }
    case "format":
      return r.formatted ? null : red(String(r.error));
    default:
      return dim(truncate(JSON.stringify(result), 200));
  }
}

export async function runAgent(
  description: string,
  options?: EntryOptions,
): Promise<AgentResult> {
  const workspace = await createWorkspace();
  const systemPrompt = loadSystemPrompt();
  const model = options?.model ?? anthropic("claude-sonnet-4-20250514");
  const verbose = options?.verbose ?? false;

  const userPrompt = options?.contract
    ? `${description}\n\nThe entrypoint (index.ts) MUST export a default value matching this TypeScript type:\n\`\`\`ts\nexport default <implementation> satisfies ${options.contract}\n\`\`\`\nDo NOT run the code as a program. Export it as a library.`
    : description;

  if (verbose) {
    console.log(bold("\n▸ generating program"));
    console.log(dim(`  workspace: ${workspace.dir}`));
    console.log(dim(`  model: ${typeof model === "string" ? model : "modelId" in model ? (model as { modelId: string }).modelId : "custom"}`));
    if (options?.contract) console.log(dim(`  contract: ${options.contract}`));
    console.log();
  }

  let stepNum = 0;

  const { steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools: buildTools(workspace),
    stopWhen: stepCountIs(50),
    onStepFinish: verbose
      ? (event) => {
          stepNum++;
          console.log(dim(`── step ${stepNum} ──`));

          if (event.text) {
            console.log(yellow("  thinking: ") + dim(truncate(event.text.trim(), 300)));
          }

          const calls = event.toolCalls ?? [];
          const results = event.toolResults ?? [];

          for (let i = 0; i < calls.length; i++) {
            const call = calls[i] as unknown as { toolName: string; toolCallId: string; input: Record<string, unknown> };
            console.log(`  ${formatToolCall({ toolName: call.toolName, args: call.input ?? {} })}`);

            const matchingResult = results.find(
              (r: unknown) => {
                const tr = r as { toolCallId?: string };
                return "toolCallId" in tr && tr.toolCallId === call.toolCallId;
              },
            ) as unknown as { output: unknown } | undefined;
            if (matchingResult) {
              const formatted = formatToolResult(call, matchingResult.output);
              if (formatted) {
                for (const line of formatted.split("\n")) {
                  console.log(`    ${line}`);
                }
              }
            }
          }
          console.log();
        }
      : undefined,
  });

  const files = await workspace.getAllFiles();
  const entrypoint = workspace.getEntrypoint();

  if (verbose) {
    const fileNames = Object.keys(files);
    console.log(bold(`▸ done`) + dim(` — ${steps.length} steps, ${fileNames.length} files`));
    for (const f of fileNames) {
      console.log(dim(`  ${f}`));
    }
    console.log();
  }

  return { entrypoint, files };
}
