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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `... (${text.length - max} more chars)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function getStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((element): element is string => typeof element === "string") ? value : undefined;
}

interface ToolCallShape {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

function isToolCall(value: unknown): value is ToolCallShape {
  if (!isRecord(value)) return false;
  if (typeof value.toolName !== "string") return false;
  if (typeof value.toolCallId !== "string") return false;
  if (value.input !== undefined && !isRecord(value.input)) return false;
  return true;
}

interface ToolResultShape {
  toolCallId: string;
  output: unknown;
}

function isToolResult(value: unknown): value is ToolResultShape {
  if (!isRecord(value)) return false;
  if (typeof value.toolCallId !== "string") return false;
  return "output" in value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string for "${key}", got ${typeof value}`);
  }
  return value;
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "writeFile":
      return `writeFile ${requireString(input, "path")}`;
    case "readFile":
      return `readFile ${requireString(input, "path")}`;
    case "listFiles":
      return "listFiles";
    case "execute":
      return `execute: ${requireString(input, "command")}`;
    case "runTests":
      return `runTests${input.testFile ? ` ${input.testFile}` : ""}`;
    case "typeCheck":
      return "typeCheck";
    case "format":
      return `format ${requireString(input, "path")}`;
    default:
      return `${name} ${JSON.stringify(input)}`;
  }
}

function describeToolResult(name: string, output: unknown): string | null {
  if (!isRecord(output)) return truncate(JSON.stringify(output), 200);

  switch (name) {
    case "writeFile":
      return null;
    case "readFile": {
      const error = getString(output, "error");
      if (error) return error;
      const content = getString(output, "content");
      if (content) return truncate(content, 200);
      return null;
    }
    case "listFiles": {
      const files = getStringArray(output, "files");
      if (files) return files.join(", ");
      return null;
    }
    case "execute": {
      const parts: string[] = [];
      if (output.stdout) parts.push(truncate(String(output.stdout).trim(), 300));
      if (output.stderr) parts.push(truncate(String(output.stderr).trim(), 200));
      if (output.exitCode !== 0) parts.push(`exit ${output.exitCode}`);
      return parts.join("\n") || null;
    }
    case "runTests": {
      const passed = getBoolean(output, "passed");
      if (passed === undefined) return null;
      if (passed) return "passed";
      const text = (String(output.stdout ?? "") + String(output.stderr ?? "")).trim();
      return text ? `failed\n${truncate(text, 400)}` : "failed";
    }
    case "typeCheck": {
      const passed = getBoolean(output, "passed");
      if (passed === undefined) return null;
      if (passed) return "passed";
      return `failed\n${truncate(String(output.diagnostics ?? "").trim(), 400)}`;
    }
    case "format":
      if (output.formatted) return null;
      return String(output.error ?? "unknown error");
    default:
      return truncate(JSON.stringify(output), 200);
  }
}

function getModelId(model: unknown): string {
  if (typeof model === "string") return model;
  if (isRecord(model) && typeof model.modelId === "string") return model.modelId;
  return "custom";
}

function log(depth: number, message: string) {
  const indent = "\t".repeat(depth);
  for (const line of message.split("\n")) {
    console.log(`${indent}${line}`);
  }
}

export async function runAgent(
  description: string,
  options?: EntryOptions,
): Promise<AgentResult> {
  const workspace = await createWorkspace();
  const systemPrompt = loadSystemPrompt();
  const model = options?.model ?? anthropic("claude-sonnet-4-6");
  const verbose = options?.verbose ?? false;

  const userPrompt = options?.contract
    ? `${description}\n\nThe entrypoint (index.ts) MUST export a default value matching this TypeScript type:\n\`\`\`ts\nexport default <implementation> satisfies ${options.contract}\n\`\`\`\nDo NOT run the code as a program. Export it as a library.`
    : description;

  if (verbose) {
    log(0, "generating program");
    log(1, `workspace: ${workspace.dir}`);
    log(1, `model: ${getModelId(model)}`);
    if (options?.contract) log(1, `contract: ${options.contract}`);
  }

  let stepNumber = 0;

  function onStepFinish(event: { text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }) {
    if (!verbose) return;

    stepNumber++;
    log(1, `step ${stepNumber}`);

    if (event.text) {
      log(2, truncate(event.text.trim(), 300));
    }

    const toolCalls = event.toolCalls ?? [];
    const toolResults = event.toolResults ?? [];

    for (const rawCall of toolCalls) {
      if (!isToolCall(rawCall)) continue;
      const input = rawCall.input ?? {};

      log(2, describeToolCall(rawCall.toolName, input));

      const matchingResult = toolResults.find(
        (result) => isToolResult(result) && result.toolCallId === rawCall.toolCallId,
      );
      if (matchingResult && isToolResult(matchingResult)) {
        const description = describeToolResult(rawCall.toolName, matchingResult.output);
        if (description) {
          log(3, description);
        }
      }
    }
  }

  const { steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools: buildTools(workspace),
    stopWhen: stepCountIs(50),
    onStepFinish,
  });

  const files = await workspace.getAllFiles();
  const entrypoint = workspace.getEntrypoint();

  if (verbose) {
    log(1, `done: ${steps.length} steps, ${Object.keys(files).length} files`);
    for (const fileName of Object.keys(files)) {
      log(2, fileName);
    }
  }

  return { entrypoint, files };
}
