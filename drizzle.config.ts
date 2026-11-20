import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env.local / .env exactly the way Next.js does.
loadEnvConfig(process.cwd());

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "Set DIRECT_URL (session pooler, preferred) or DATABASE_URL in .env.local before running drizzle-kit.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  // Only manage the app's own schema — never touch Supabase's auth/storage schemas.
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
