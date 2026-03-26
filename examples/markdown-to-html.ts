import { entry } from "../index.ts";

await entry(`
  a CLI tool that reads a markdown file from the first
  command line argument and converts it to HTML
  it should support headings, bold, italic, links,
  code blocks, and unordered lists
  print the HTML to stdout
`, { verbose: true });
