import { plugin } from "bun";
import { readFileSync } from "node:fs";
import ts from "typescript";

function transformEntryGenerics(source: string, filePath: string): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const replacements: Array<{ start: number; end: number; text: string }> = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "entry" &&
      node.typeArguments?.length === 1
    ) {
      const typeArg = node.typeArguments[0]!;
      const contractStr = typeArg.getText(sourceFile);

      const args = node.arguments;
      if (args.length === 0) return;

      const descriptionArg = args[0]!.getText(sourceFile);

      let newCall: string;
      if (args.length >= 2) {
        const existingOpts = args[1]!.getText(sourceFile);
        newCall = `entry(${descriptionArg}, { ...${existingOpts}, contract: ${JSON.stringify(contractStr)} })`;
      } else {
        newCall = `entry(${descriptionArg}, { contract: ${JSON.stringify(contractStr)} })`;
      }

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
      const text = readFileSync(args.path, "utf-8");
      const loader = (args.path.endsWith(".tsx") ? "tsx" : "ts") as "tsx" | "ts";

      // Only transform user files that contain entry<
      const shouldTransform =
        !args.path.includes("/node_modules/") &&
        !args.path.includes("/anythingandeverything/src/") &&
        !args.path.endsWith("/anythingandeverything/index.ts") &&
        (text.includes("entry<") || text.includes("entry <"));

      return {
        contents: shouldTransform ? transformEntryGenerics(text, args.path) : text,
        loader,
      };
    });
  },
});
