import { aywitb } from "../index.ts";

type SumFn = (a: number, b: number) => { sum: number };

const sum = await aywitb<SumFn>(
  "a function that takes two numbers and returns an object with their sum",
  { verbose: true },
);

console.log(sum(2, 3));
