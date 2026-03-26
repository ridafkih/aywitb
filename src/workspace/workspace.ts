import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTRACT_CHECK_FILE = "_contract.check.ts";

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

function buildContractCheckFile(contract: string): string {
  return [
    `import type _default from "./index.ts";`,
    `type _Contract = ${contract};`,
    `const _check: _Contract = {} as typeof _default;`,
  ].join("\n");
}

export async function createWorkspace(contract?: string): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "aae-"));

  await Bun.write(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  await Bun.write(join(dir, "package.json"), JSON.stringify(packageJson, null, 2));

  if (contract) {
    await Bun.write(join(dir, CONTRACT_CHECK_FILE), buildContractCheckFile(contract));
  }

  Bun.spawnSync(["bun", "install"], { cwd: dir, stdout: "ignore", stderr: "ignore" });

  return {
    dir,
    getEntrypoint: () => "index.ts",
    getAllFiles: async () => {
      const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,json,css,html,md}");
      const files: Record<string, string> = {};
      for await (const path of glob.scan({ cwd: dir })) {
        if (path.includes("node_modules/") || path === CONTRACT_CHECK_FILE) continue;
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
