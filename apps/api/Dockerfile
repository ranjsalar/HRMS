# syntax=docker/dockerfile:1
#
# Multi-stage production build for @hrms/api. Two stages: "build" (full
# monorepo install + compile + a clean production-only dependency tree
# via `pnpm deploy`), and a minimal "runtime" stage that only ever sees
# that clean output — no dev dependencies, no TypeScript source, no
# workspace symlinks. See DECISIONS.md ("Infrastructure pass, item 3:
# production Dockerfiles") for why `pnpm deploy` specifically: pnpm
# workspace node_modules are symlink-heavy (into a shared content-
# addressable store), and those symlinks break if copied verbatim across
# Docker stages/layers — `pnpm deploy --prod` is pnpm's own tool for
# materializing a real, non-symlinked, production-only dependency tree
# for exactly one workspace package, safe to copy anywhere. Verified
# locally (outside Docker) before relying on it here.

FROM node:22-alpine AS build
# Prisma's query engine needs OpenSSL at both generate-time and runtime
# on Alpine (musl libc) — a well-known Prisma+Alpine requirement.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /workspace

# Install with full monorepo context (workspace protocol deps need
# every involved package.json present to resolve) but not yet full
# source, so this layer only invalidates when dependencies change.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api

# @prisma/client's generated engine binary is platform-specific and
# NODE_ENV/binaryTargets-unaware unless configured — generating here,
# inside the exact image that will also run in production, is what
# guarantees the right (musl) binary without needing an explicit
# binaryTargets override in schema.prisma.
RUN pnpm --filter @hrms/api exec prisma generate
RUN pnpm --filter @hrms/api build

# Materializes a clean, production-only, non-symlinked dependency tree
# (no devDependencies — no jest/ts-node/@nestjs/cli/typescript; no
# @hrms/shared, which is a devDependency here and never imported by any
# runtime code path, only by a test file — verified before writing this
# Dockerfile) alongside the already-built dist/ and this package's own
# files, all copied together into /deploy in the next stage.
RUN pnpm --filter @hrms/api deploy --prod /deploy

# `pnpm deploy` does a FRESH dependency resolution into /deploy, not a
# copy of the already-generated node_modules above — @prisma/client's
# own postinstall hook runs again there, can't find schema.prisma
# relative to its new location, and silently falls back to a tiny
# placeholder client (Prisma's own "default-index.ts" stub) with no
# real models — everything typechecks fine (the .d.ts files are
# unaffected) but crashes at runtime the first time real generated code
# is touched ("Prisma.Decimal is not a constructor"). Found by actually
# running the built image, not from the build log alone — the build
# itself reports success either way.
#
# Fix takes two parts, both verified necessary by testing, not guessed:
# `prisma generate` resolves WHERE to write the client by walking up
# from the SCHEMA FILE's own location looking for node_modules — not
# from cwd. Pointing --schema at the original /workspace copy (even
# from inside /deploy) just regenerates into /workspace's node_modules
# again, a no-op for /deploy. The schema has to physically exist inside
# /deploy for the walk-up to land in /deploy/node_modules.
RUN mkdir -p /deploy/src/database/prisma
RUN cp /workspace/apps/api/src/database/prisma/schema.prisma /deploy/src/database/prisma/schema.prisma
RUN cd /deploy && /workspace/apps/api/node_modules/.bin/prisma generate --schema=/deploy/src/database/prisma/schema.prisma

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
RUN addgroup -S hrms && adduser -S hrms -G hrms
WORKDIR /app
COPY --from=build --chown=hrms:hrms /deploy/node_modules ./node_modules
COPY --from=build --chown=hrms:hrms /deploy/dist ./dist
COPY --from=build --chown=hrms:hrms /deploy/package.json ./package.json
# Migrations aren't run from this image (see docker-compose.prod.yml —
# `prisma migrate deploy` runs as its own one-off step against the real
# schema source, not bundled into the long-running app container), but
# the schema file itself is needed at runtime: @prisma/client's
# generated code reads schema.prisma's relative path for some
# operations (datasource introspection metadata).
COPY --from=build --chown=hrms:hrms /deploy/src/database/prisma/schema.prisma ./src/database/prisma/schema.prisma

USER hrms
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main.js"]
