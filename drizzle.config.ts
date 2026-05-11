import { defineConfig } from "drizzle-kit";
import { drizzleConfigValues } from "./apps/api/src/database/drizzle-config";

export default defineConfig(drizzleConfigValues);
