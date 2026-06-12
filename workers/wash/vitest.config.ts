import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // Handed to the test runner so the setup file can apply the
            // schema to each test's isolated D1.
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
