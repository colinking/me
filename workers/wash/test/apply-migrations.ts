import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.WASH_DB, env.TEST_MIGRATIONS);
