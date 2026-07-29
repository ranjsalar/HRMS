import { config } from "dotenv";
import { resolve } from "path";
import { resolveEnvFilePath } from "../src/config/env.validation";

// Jest's setupFiles run before ANY test file's own imports — the
// earliest hook available, and the ONLY one early enough to win a race
// that turned out to matter: Prisma's generated client auto-loads plain
// ".env" (dev) the instant @prisma/client is first required, completely
// independent of NODE_ENV, and BEFORE ConfigModule's own envFilePath
// load (app.module.ts) gets a chance to run — dotenv never overrides an
// already-set process.env value, so whichever load happens FIRST wins.
// Explicitly loading .env.test here — not just setting NODE_ENV and
// trusting ConfigModule to load it later — is what makes test's correct
// values win that race instead of Prisma's. src/bootstrap-env.ts is the
// equivalent guaranteed-first load for the real app (dev/production),
// where main.ts is the entrypoint instead of Jest. See DECISIONS.md
// ("Config hygiene: envFilePath keyed to NODE_ENV") — this file used to
// do exactly this, was briefly simplified to just NODE_ENV on the
// (wrong) assumption ConfigModule's own envFilePath would be enough on
// its own, and was restored after that assumption failed a real test.
process.env.NODE_ENV = "test";
config({ path: resolve(__dirname, "..", resolveEnvFilePath("test")) });
