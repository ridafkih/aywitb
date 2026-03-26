import { plugin } from "bun";
import ts from "typescript";

function transformEntryGenerics(source: string, filePath: string): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  // Collect replacements in reverse order so offsets don't shift
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

      // Build the new arguments: inject or merge contract into options
      const args = node.arguments;
      if (args.length === 0) return;

      const descriptionArg = args[0]!.getText(sourceFile);

      let newCall: string;
      if (args.length >= 2) {
        // Merge contract into existing options object
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

  // Apply replacements in reverse order
  let result = source;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }

  return result;
}

export default plugin({
  name: "anythingandeverything",
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      // Don't transform our own source files
      if (args.path.includes("anythingandeverything/src/")) return;

      const source = await Bun.file(args.path).text();

      // Quick bail: skip files that don't reference entry with a generic
      if (!source.includes("entry<") && !source.includes("entry <")) return;

      const transformed = transformEntryGenerics(source, args.path);
      if (transformed === source) return;

      return {
        contents: transformed,
        loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
      };
    });
  },
});
