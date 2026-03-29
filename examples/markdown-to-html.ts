import { aywitb } from "../src/index.ts";

await aywitb(`
  a CLI tool that reads a markdown file from the first
  command line argument and converts it to HTML

  only argument is the file
`, { verbose: true });
