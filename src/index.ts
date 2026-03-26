import { eq } from "drizzle-orm";
import { getDb } from "./db/client.ts";
import { programs } from "./db/schema.ts";
import { runAgent } from "./agent/agent.ts";
import { createWorkspace } from "./workspace/workspace.ts";
import { join } from "node:path";
import type { EntryOptions } from "./config.ts";

export type { EntryOptions } from "./config.ts";

async function hashDescription(description: string): Promise<string> {
  const normalized = description.trim().replace(/\s+/g, " ").toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function runProgram(program: {
  entrypoint: string;
  files: string | Record<string, string>;
}): Promise<void> {
  const files =
    typeof program.files === "string"
      ? (JSON.parse(program.files) as Record<string, string>)
      : program.files;

  const workspace = await createWorkspace();

  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(workspace.dir, path), content);
  }

  const forwardedArgs = process.argv.slice(2);
  const proc = Bun.spawn(["bun", "run", join(workspace.dir, program.entrypoint), ...forwardedArgs], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  await proc.exited;
}

export async function entry(
  description: string,
  options?: EntryOptions,
): Promise<void> {
  const hash = await hashDescription(description);
  const db = getDb();

  if (options?.cache !== false) {
    const cached = db
      .select()
      .from(programs)
      .where(eq(programs.descriptionHash, hash))
      .limit(1)
      .all();

    if (cached.length > 0) {
      if (options?.verbose) console.log("[entry] cache hit, running cached program");
      return runProgram(cached[0]!);
    }
  }

  if (options?.verbose) console.log("[entry] cache miss, generating program...");

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

  return runProgram(result);
}
