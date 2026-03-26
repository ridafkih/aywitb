import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";

const pluginSourceDirectory = dirname(new URL(import.meta.url).pathname);
const packageRootDirectory = resolve(pluginSourceDirectory, "..");

const packageJson = JSON.parse(readFileSync(resolve(packageRootDirectory, "package.json"), "utf-8"));
const packageName: string = packageJson.name;

function collectStringPaths(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    into.add(resolve(packageRootDirectory, value));
  } else if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value)) {
      collectStringPaths(nested, into);
    }
  }
}

function discoverPackageEntrypoints(): Set<string> {
  const entrypoints = new Set<string>();
  collectStringPaths(packageJson.module, entrypoints);
  collectStringPaths(packageJson.main, entrypoints);
  collectStringPaths(packageJson.exports, entrypoints);
  return entrypoints;
}

const packageEntrypoints = discoverPackageEntrypoints();

function isPackageInternalFile(filePath: string): boolean {
  return filePath.startsWith(pluginSourceDirectory) || packageEntrypoints.has(filePath);
}

function shouldSkipTransform(filePath: string): boolean {
  return isPackageInternalFile(filePath) || filePath.includes("/node_modules/");
}

function resolveImportToPackage(specifier: string, importingFilePath: string): boolean {
  if (specifier === packageName) return true;

  const isRelativeOrAbsolute = specifier.startsWith(".") || specifier.startsWith("/");
  if (!isRelativeOrAbsolute) return false;

  const resolvedPath = resolve(dirname(importingFilePath), specifier);
  return isPackageInternalFile(resolvedPath);
}

function getImportedName(element: ts.ImportSpecifier): string {
  if (element.propertyName) return element.propertyName.text;
  return element.name.text;
}

function collectEntryBindings(sourceFile: ts.SourceFile, filePath: string): Set<string> {
  const localNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) continue;
    if (!resolveImportToPackage(moduleSpecifier.text, filePath)) continue;

    const importClause = statement.importClause;
    if (!importClause) continue;

    if (importClause.name?.text === "entry") {
      localNames.add("entry");
    }

    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    for (const element of namedBindings.elements) {
      if (getImportedName(element) === "entry") {
        localNames.add(element.name.text);
      }
    }
  }

  return localNames;
}

function isEntryCallWithGeneric(
  node: ts.Node,
  entryNames: Set<string>,
): node is ts.CallExpression & {
  expression: ts.Identifier;
  typeArguments: ts.NodeArray<ts.TypeNode>;
} {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isIdentifier(node.expression)) return false;
  if (!entryNames.has(node.expression.text)) return false;
  if (!node.typeArguments || node.typeArguments.length !== 1) return false;
  if (node.arguments.length < 1) return false;
  return true;
}

function resolveTypeToString(typeNode: ts.TypeNode, checker: ts.TypeChecker): string {
  const type = checker.getTypeFromTypeNode(typeNode);
  return checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation
      | ts.TypeFormatFlags.WriteArrowStyleSignature
      | ts.TypeFormatFlags.InTypeAlias,
  );
}

function buildContractProperty(contractText: string): ts.PropertyAssignment {
  return ts.factory.createPropertyAssignment(
    ts.factory.createIdentifier("contract"),
    ts.factory.createStringLiteral(contractText),
  );
}

function buildOptionsArgument(
  existingOptionsNode: ts.Expression | undefined,
  contractText: string,
): ts.ObjectLiteralExpression {
  const contractProperty = buildContractProperty(contractText);

  if (existingOptionsNode) {
    return ts.factory.createObjectLiteralExpression([
      ts.factory.createSpreadAssignment(existingOptionsNode),
      contractProperty,
    ]);
  }

  return ts.factory.createObjectLiteralExpression([contractProperty]);
}

function buildReplacementNode(
  node: ts.CallExpression & { expression: ts.Identifier; typeArguments: ts.NodeArray<ts.TypeNode> },
  checker: ts.TypeChecker,
): ts.CallExpression {
  const typeArgument = node.typeArguments[0];
  if (!typeArgument) {
    throw new Error("Expected type argument in entry call — predicate should have guaranteed this");
  }

  const contractText = resolveTypeToString(typeArgument, checker);
  const descriptionArgument = node.arguments[0];
  if (!descriptionArgument) {
    throw new Error("Expected description argument in entry call — predicate should have guaranteed this");
  }

  const existingOptionsNode = node.arguments[1];
  const optionsArgument = buildOptionsArgument(existingOptionsNode, contractText);
  const remainingArguments = Array.from(node.arguments).slice(2);

  return ts.factory.createCallExpression(
    node.expression,
    undefined,
    [descriptionArgument, optionsArgument, ...remainingArguments],
  );
}

function createTransformer(
  entryNames: Set<string>,
  checker: ts.TypeChecker,
): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    function visitor(node: ts.Node): ts.Node {
      if (isEntryCallWithGeneric(node, entryNames)) {
        return buildReplacementNode(node, checker);
      }
      return ts.visitEachChild(node, visitor, context);
    }

    return (file) => {
      const result = ts.visitNode(file, visitor);
      if (!result || !ts.isSourceFile(result)) {
        throw new Error("AST transform produced a non-SourceFile node");
      }
      return result;
    };
  };
}

function createProgramForFile(filePath: string): ts.Program {
  const configPath = ts.findConfigFile(dirname(filePath), ts.sys.fileExists, "tsconfig.json");
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath));
    return ts.createProgram({
      rootNames: [...parsed.fileNames, filePath],
      options: parsed.options,
    });
  }

  return ts.createProgram({
    rootNames: [filePath],
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    },
  });
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function transformEntryGenerics(filePath: string): string | null {
  const program = createProgramForFile(filePath);
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Program could not locate source file: ${filePath}`);
  }

  const entryNames = collectEntryBindings(sourceFile, filePath);
  if (entryNames.size === 0) return null;

  const checker = program.getTypeChecker();
  const transformResult = ts.transform(sourceFile, [createTransformer(entryNames, checker)]);
  const transformedFile = transformResult.transformed[0];
  if (!transformedFile) {
    throw new Error("Transform produced no output");
  }

  const printed = printer.printFile(transformedFile);
  transformResult.dispose();
  return printed;
}

function inferLoader(filePath: string): "ts" | "tsx" {
  return filePath.endsWith(".tsx") ? "tsx" : "ts";
}

function handleLoad(filePath: string) {
  const loader = inferLoader(filePath);

  if (shouldSkipTransform(filePath)) {
    const source = readFileSync(filePath, "utf-8");
    return { contents: source, loader };
  }

  const transformed = transformEntryGenerics(filePath);
  if (!transformed) {
    const source = readFileSync(filePath, "utf-8");
    return { contents: source, loader };
  }

  return { contents: transformed, loader };
}

plugin({
  name: packageName,
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, (args) => handleLoad(args.path));
  },
});
