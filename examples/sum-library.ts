import { aywitb } from "../src/index.ts";

const sum = await aywitb<(a: number, b: number) => { sum: number }>(
  "a function that takes two numbers and returns an object with their sum",
  { verbose: true }
);

console.log(sum(2, 3));
