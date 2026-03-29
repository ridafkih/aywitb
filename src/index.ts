import { eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { programs } from "./db/schema.ts";
import { runAgent } from "./agent/agent.ts";
import { createWorkspace } from "./workspace/workspace.ts";
import { join } from "node:path";
import type { EntryOptions } from "./config.ts";

export type { EntryOptions as AywitbOptions } from "./config.ts";

function hashDescription(description: string, contract?: string): string {
  const seed = Bun.hash(description);
  if (!contract) return seed.toString(36);
  return Bun.hash(contract, seed).toString(36);
}

interface ProgramRecord {
  entrypoint: string;
  files: string | Record<string, string>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((val) => typeof val === "string");
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

export async function entry<T>(description: string, options: EntryOptions & { contract: string }): Promise<T>;
export async function entry<T>(description: string, options?: EntryOptions): Promise<T>;
export async function entry(description: string, options?: EntryOptions): Promise<void>;
export async function entry(description: string, options?: EntryOptions): Promise<unknown> {
  const contract = options?.contract;
  const hash = hashDescription(description, contract);
  const db = getDb();

  if (options?.cache !== false) {
    const cached = db
      .select()
      .from(programs)
      .where(eq(programs.descriptionHash, hash))
      .limit(1)
      .all();

    const cachedRecord = cached[0];
    if (cachedRecord) {
      if (options?.verbose) console.log(`cache hit (${hash.slice(0, 8)})`);
      if (contract) return importProgram(cachedRecord);
      await runProgram(cachedRecord);
      return;
    }
  }

  if (options?.verbose) console.log(`cache miss (${hash.slice(0, 8)}), generating...`);

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

  if (contract) return importProgram(result);
  await runProgram(result);
}

export { entry as aywitb };
