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

export async function runAgent(
  description: string,
  options?: EntryOptions,
): Promise<AgentResult> {
  const workspace = await createWorkspace();
  const systemPrompt = loadSystemPrompt();
  const model = options?.model ?? anthropic("claude-sonnet-4-20250514");

  const userPrompt = options?.contract
    ? `${description}\n\nThe entrypoint (index.ts) MUST export a default value matching this TypeScript type:\n\`\`\`ts\nexport default <implementation> satisfies ${options.contract}\n\`\`\`\nDo NOT run the code as a program. Export it as a library.`
    : description;

  const { steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools: buildTools(workspace),
    stopWhen: stepCountIs(50),
    onStepFinish: options?.verbose
      ? (event) => {
          for (const call of event.toolCalls ?? []) {
            console.log(`[agent] tool call: ${call.toolName}`);
          }
        }
      : undefined,
  });

  const files = await workspace.getAllFiles();
  const entrypoint = workspace.getEntrypoint();

  if (options?.verbose) {
    console.log(
      `[agent] completed in ${steps.length} steps, ${Object.keys(files).length} files generated`,
    );
  }

  return { entrypoint, files };
}
