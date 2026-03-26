import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const programs = sqliteTable("programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  descriptionHash: text("description_hash").notNull().unique(),
  description: text("description").notNull(),
  entrypoint: text("entrypoint").notNull(),
  files: text("files").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
