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

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((val) => typeof val === "string");
}

function resolveFiles(program: ProgramRecord): Record<string, string> {
  if (typeof program.files !== "string") return program.files;

  const parsed: unknown = JSON.parse(program.files);
  if (!isStringRecord(parsed)) {
    throw new Error("Cached program has malformed files field — expected Record<string, string>");
  }
  return parsed;
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

async function importProgram(program: ProgramRecord): Promise<unknown> {
  const files = resolveFiles(program);
  const workspace = await writeToWorkspace(files);

  const mod: unknown = await import(join(workspace.dir, program.entrypoint));
  if (typeof mod !== "object" || mod === null || !("default" in mod)) {
    throw new Error("Generated module does not have a default export");
  }
  return mod.default;
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
      if (options?.verbose) console.log(`\x1b[32m▸ cache hit\x1b[0m \x1b[2m(${hash.slice(0, 8)})\x1b[0m`);
      if (contract) return importProgram(cached[0]!) as Promise<T>;
      await runProgram(cached[0]!);
      // T defaults to void when no contract is provided
      return undefined as T;
    }
  }

  if (options?.verbose) console.log(`\x1b[33m▸ cache miss\x1b[0m \x1b[2m(${hash.slice(0, 8)}), generating...\x1b[0m`);

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

  if (contract) return importProgram(result) as Promise<T>;
  await runProgram(result);
  return undefined as T;
}
