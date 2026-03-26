import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";

/**
 * Resolves the real directories of the anythingandeverything package source
 * so we can skip transforming our own source files without hardcoded paths.
 */
const packageSrcDir = resolve(dirname(new URL(import.meta.url).pathname));
const packageEntrypoint = resolve(packageSrcDir, "..", "index.ts");

/**
 * Determines whether an import specifier resolves to our package.
 * Handles bare specifiers ("anythingandeverything") and relative
 * paths ("../index.ts") by resolving against the importing file.
 */
function isOurPackageImport(specifier: string, importingFile: string): boolean {
  // Bare specifier match
  if (specifier === "anythingandeverything") return true;

  // Relative/absolute path — resolve and check if it lands inside our package
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const resolved = resolve(dirname(importingFile), specifier);
    return resolved.startsWith(packageSrcDir) || resolved === packageEntrypoint;
  }

  return false;
}

/**
 * Collect the local names that `entry` is imported as from our package.
 * Handles: import { entry }, import { entry as foo }, etc.
 * Uses real path resolution rather than string matching on specifiers.
 */
function collectEntryBindings(sourceFile: ts.SourceFile, filePath: string): Set<string> {
  const bindings = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const specifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;

    if (!isOurPackageImport(specifier.text, filePath)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    // import entry from "..." (default import)
    if (clause.name?.text === "entry") {
      bindings.add("entry");
    }

    // import { entry } or import { entry as foo }
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (imported === "entry") {
          bindings.add(el.name.text);
        }
      }
    }
  }

  return bindings;
}

/**
 * Walks the AST and rewrites `entry<T>(desc, opts?)` calls to inject
 * `{ contract: "T" }` — but only for identifiers that actually resolve
 * to our package's `entry` export.
 */
function transformEntryGenerics(source: string, filePath: string): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const entryNames = collectEntryBindings(sourceFile, filePath);
  if (entryNames.size === 0) return source;

  const replacements: Array<{ start: number; end: number; text: string }> = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      entryNames.has(node.expression.text) &&
      node.typeArguments?.length === 1 &&
      node.arguments.length >= 1
    ) {
      const calleeName = node.expression.text;
      const contractStr = node.typeArguments[0]!.getText(sourceFile);

      // Rebuild args, preserving originals and injecting contract
      const argTexts = node.arguments.map((a) => a.getText(sourceFile));

      let optionsArg: string;
      if (argTexts.length >= 2) {
        optionsArg = `{ ...${argTexts[1]}, contract: ${JSON.stringify(contractStr)} }`;
      } else {
        optionsArg = `{ contract: ${JSON.stringify(contractStr)} }`;
      }

      const allArgs = [argTexts[0], optionsArg, ...argTexts.slice(2)].join(", ");
      const newCall = `${calleeName}(${allArgs})`;

      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: newCall,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (replacements.length === 0) return source;

  let result = source;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }

  return result;
}

plugin({
  name: "anythingandeverything",
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, (args) => {
      const loader: "tsx" | "ts" = args.path.endsWith(".tsx") ? "tsx" : "ts";
      const text = readFileSync(args.path, "utf-8");

      // Skip our own package source and anything in node_modules
      if (args.path.startsWith(packageSrcDir) || args.path === packageEntrypoint || args.path.includes("/node_modules/")) {
        return { contents: text, loader };
      }

      return {
        contents: transformEntryGenerics(text, args.path),
        loader,
      };
    });
  },
});
