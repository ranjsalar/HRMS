import "./bootstrap-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { initSentry } from "./monitoring/sentry";

async function bootstrap() {
  // First statement in bootstrap — env is already loaded (bootstrap-env
  // is this file's first import, guaranteed to run before this function
  // is even called), and Sentry's own guidance is to initialize before
  // the rest of app startup so it can capture errors during
  // NestFactory.create()/app.listen() too, not just once request
  // handling begins. No-op when SENTRY_DSN is unset — every environment
  // right now. See that file's own comment and DECISIONS.md.
  initSentry();

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: process.env.CORS_ORIGINS?.split(",") ?? [],
      credentials: true,
    },
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix("api");

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
