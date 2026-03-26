import { eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { programs } from "./db/schema.ts";
import { runAgent } from "./agent/agent.ts";
import { createWorkspace } from "./workspace/workspace.ts";
import { join } from "node:path";
import type { EntryOptions } from "./config.ts";

export type { EntryOptions } from "./config.ts";

async function hashDescription(description: string, contract?: string): Promise<string> {
  const input = (description.trim().replace(/\s+/g, " ").toLowerCase()) +
    (contract ? `::${contract}` : "");
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface ProgramRecord {
  entrypoint: string;
  files: string | Record<string, string>;
}

function resolveFiles(program: ProgramRecord): Record<string, string> {
  return typeof program.files === "string"
    ? (JSON.parse(program.files) as Record<string, string>)
    : program.files;
}

async function writeToWorkspace(files: Record<string, string>) {
  const workspace = await createWorkspace();
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(workspace.dir, path), content);
  }
  return workspace;
}

async function runProgram(program: ProgramRecord): Promise<void> {
  const files = resolveFiles(program);
  const workspace = await writeToWorkspace(files);

  const forwardedArgs = process.argv.slice(2);
  const proc = Bun.spawn(
    ["bun", "run", join(workspace.dir, program.entrypoint), ...forwardedArgs],
    { stdout: "inherit", stderr: "inherit", stdin: "inherit" },
  );

  await proc.exited;
}

async function importProgram<T>(program: ProgramRecord): Promise<T> {
  const files = resolveFiles(program);
  const workspace = await writeToWorkspace(files);

  const mod = await import(join(workspace.dir, program.entrypoint));
  return mod.default as T;
}

export async function entry<T = void>(
  description: string,
  options?: EntryOptions,
): Promise<T> {
  const contract = options?.contract;
  const hash = await hashDescription(description, contract);
  const db = getDb();

  if (options?.cache !== false) {
    const cached = db
      .select()
      .from(programs)
      .where(eq(programs.descriptionHash, hash))
      .limit(1)
      .all();

    if (cached.length > 0) {
      if (options?.verbose) console.log("[entry] cache hit");
      if (contract) return importProgram<T>(cached[0]!);
      await runProgram(cached[0]!);
      return undefined as T;
    }
  }

  if (options?.verbose) console.log("[entry] cache miss, generating...");

  const result = await runAgent(description, options);

  db.insert(programs)
    .values({
      descriptionHash: hash,
      description,
      entrypoint: result.entrypoint,
      files: JSON.stringify(result.files),
      createdAt: new Date(),
    })
    .run();

  if (contract) return importProgram<T>(result);
  await runProgram(result);
  return undefined as T;
}
