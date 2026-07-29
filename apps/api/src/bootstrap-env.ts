import { config } from "dotenv";
import { resolveEnvFilePath } from "./config/env.validation";

// MUST be main.ts's very first import — before anything that
// transitively imports @prisma/client (AppModule -> PrismaModule).
// Prisma's generated client auto-loads plain ".env" the instant it is
// first required, completely independent of NODE_ENV, and dotenv never
// overrides an already-set process.env value. If Prisma's auto-load
// wins that race, it silently poisons process.env with DEV's .env
// values before ConfigModule's own NODE_ENV-aware envFilePath load ever
// gets a chance to run — found live via a failing e2e test after adding
// that envFilePath alone turned out not to be sufficient on its own.
// Loading here, first, wins the race instead. See DECISIONS.md ("Config
// hygiene: envFilePath keyed to NODE_ENV").
config({ path: resolveEnvFilePath(process.env.NODE_ENV) });
