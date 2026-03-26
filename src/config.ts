import type { LanguageModel } from "ai";

export interface EntryOptions {
  model?: LanguageModel;
  cache?: boolean;
  verbose?: boolean;
}
