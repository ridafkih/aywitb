import { aywitb } from "../src/index.ts";

const { serve } = await aywitb<{ serve: (port: number) => Promise<void> }>(`
  a blazingly fast web server that returns a random
  defense that i can send in response to people who
  are unsupportive of my amazing projects
`, { verbose: true })

await serve(3004);
console.log("serving...");
