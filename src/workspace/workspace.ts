import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Workspace {
  dir: string;
  getEntrypoint(): string;
  getAllFiles(): Promise<Record<string, string>>;
  cleanup(): Promise<void>;
}

const tsconfig = {
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
    types: ["bun-types"],
  },
};

const packageJson = {
  name: "generated",
  type: "module",
  private: true,
  devDependencies: {
    "@types/bun": "latest",
  },
};

export async function createWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "aae-"));

  await Bun.write(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  await Bun.write(join(dir, "package.json"), JSON.stringify(packageJson, null, 2));

  Bun.spawnSync(["bun", "install"], { cwd: dir, stdout: "ignore", stderr: "ignore" });

  return {
    dir,
    getEntrypoint: () => "index.ts",
    getAllFiles: async () => {
      const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,json,css,html,md}");
      const files: Record<string, string> = {};
      for await (const path of glob.scan({ cwd: dir })) {
        if (path.includes("node_modules/")) continue;
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
