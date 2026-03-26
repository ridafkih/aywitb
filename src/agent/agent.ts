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

// -- Type guards for tool call/result shapes --

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function getBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === "boolean" ? v : undefined;
}

function getStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;
  return v.every((el): el is string => typeof el === "string") ? v : undefined;
}

interface ToolCallShape {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

function isToolCall(v: unknown): v is ToolCallShape {
  if (!isRecord(v)) return false;
  if (typeof v.toolName !== "string") return false;
  if (typeof v.toolCallId !== "string") return false;
  // input may be absent for zero-arg tools
  if (v.input !== undefined && !isRecord(v.input)) return false;
  return true;
}

interface ToolResultShape {
  toolCallId: string;
  output: unknown;
}

function isToolResult(v: unknown): v is ToolResultShape {
  if (!isRecord(v)) return false;
  if (typeof v.toolCallId !== "string") return false;
  return "output" in v;
}

// -- Formatting --

function formatToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "writeFile":
      return `${cyan("writeFile")} ${dim("→")} ${input.path ?? "?"}`;
    case "readFile":
      return `${cyan("readFile")} ${dim("→")} ${input.path ?? "?"}`;
    case "listFiles":
      return cyan("listFiles");
    case "execute":
      return `${cyan("execute")} ${dim("→")} ${dim(String(input.command ?? ""))}`;
    case "runTests":
      return `${cyan("runTests")}${input.testFile ? ` ${dim("→")} ${input.testFile}` : ""}`;
    case "typeCheck":
      return cyan("typeCheck");
    case "format":
      return `${cyan("format")} ${dim("→")} ${input.path ?? "?"}`;
    default:
      return `${cyan(name)} ${dim(JSON.stringify(input))}`;
  }
}

function formatToolResult(name: string, output: unknown): string | null {
  if (!isRecord(output)) return dim(truncate(JSON.stringify(output), 200));

  switch (name) {
    case "writeFile":
      return null;
    case "readFile": {
      const err = getString(output, "error");
      if (err) return red(err);
      const content = getString(output, "content");
      if (content) return dim(truncate(content, 200));
      return null;
    }
    case "listFiles": {
      const files = getStringArray(output, "files");
      if (files) return dim(files.join(", "));
      return null;
    }
    case "execute": {
      const parts: string[] = [];
      if (output.stdout) parts.push(truncate(String(output.stdout).trim(), 300));
      if (output.stderr) parts.push(red(truncate(String(output.stderr).trim(), 200)));
      if (output.exitCode !== 0) parts.push(red(`exit ${output.exitCode}`));
      return parts.join("\n") || null;
    }
    case "runTests": {
      const passed = getBoolean(output, "passed");
      if (passed === undefined) return null;
      const icon = passed ? green("pass") : red("fail");
      const parts = [icon];
      const text = (String(output.stdout ?? "") + String(output.stderr ?? "")).trim();
      if (text && !passed) parts.push(dim(truncate(text, 400)));
      return parts.join("\n");
    }
    case "typeCheck": {
      const passed = getBoolean(output, "passed");
      if (passed === undefined) return null;
      if (passed) return green("pass");
      return red("fail\n") + dim(truncate(String(output.diagnostics ?? "").trim(), 400));
    }
    case "format":
      if (output.formatted) return null;
      return red(String(output.error ?? "unknown error"));
    default:
      return dim(truncate(JSON.stringify(output), 200));
  }
}

function getModelId(model: unknown): string {
  if (typeof model === "string") return model;
  if (isRecord(model) && typeof model.modelId === "string") return model.modelId;
  return "custom";
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
    console.log(dim(`  model: ${getModelId(model)}`));
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

          for (const rawCall of calls) {
            if (!isToolCall(rawCall)) continue;
            const input = rawCall.input ?? {};

            console.log(`  ${formatToolCall(rawCall.toolName, input)}`);

            const matchingResult = results.find(
              (r) => isToolResult(r) && r.toolCallId === rawCall.toolCallId,
            );
            if (matchingResult && isToolResult(matchingResult)) {
              const formatted = formatToolResult(rawCall.toolName, matchingResult.output);
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
