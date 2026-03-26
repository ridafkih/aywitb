import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Workspace {
  dir: string;
  getEntrypoint(): string;
  getAllFiles(): Promise<Record<string, string>>;
  cleanup(): Promise<void>;
}

export async function createWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "aae-"));

  await Bun.write(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext"],
          target: "ESNext",
          module: "Preserve",
          moduleDetection: "force",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
        },
      },
      null,
      2,
    ),
  );

  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "generated", type: "module", private: true },
      null,
      2,
    ),
  );

  return {
    dir,
    getEntrypoint: () => "index.ts",
    getAllFiles: async () => {
      const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,json,css,html,md}");
      const files: Record<string, string> = {};
      for await (const path of glob.scan({ cwd: dir })) {
        files[path] = await Bun.file(join(dir, path)).text();
      }
      return files;
    },
    cleanup: async () => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    },
  };
}
