# syntax=docker/dockerfile:1
#
# Multi-stage production build for @hrms/web, using Next.js's
# `output: "standalone"` (next.config.ts) — its own build-time file
# tracer already produces a minimal, self-contained node_modules subset,
# so unlike apps/api's Dockerfile this does NOT need `pnpm deploy`; that
# would be redundant with (and untested against) Next's own tracing.
# Verified locally outside Docker first (built with output:"standalone",
# manually copied static assets per Next's docs, ran `node server.js`,
# confirmed a real page AND a real static JS chunk both served) before
# writing this file. See DECISIONS.md ("Infrastructure pass, item 3").

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /workspace

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

# NEXT_PUBLIC_* vars are INLINED into the client bundle at build time,
# not read at runtime — a genuine Next.js constraint, not an oversight.
# Correct long-term fix is a same-origin reverse proxy (item 4) so the
# frontend can use a relative "/api" path and never need to know the
# API's real URL at build time at all; until that exists, this build
# arg lets a real deployment pass its own real API origin in.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @hrms/web build

FROM node:22-alpine AS runtime
RUN addgroup -S hrms && adduser -S hrms -G hrms
WORKDIR /app

# Standalone output nests as apps/web/server.js (mirroring the monorepo
# layout) with node_modules split across TWO levels — a hoisted root
# copy and a package-local copy — that Node's own directory walk-up
# resolves correctly only if this exact relative nesting is preserved.
# Copying the whole standalone tree (not just the apps/web subtree) and
# keeping WORKDIR nested to match is what makes that resolution work;
# verified by testing, not assumed.
COPY --from=build --chown=hrms:hrms /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=hrms:hrms /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=hrms:hrms /workspace/apps/web/public ./apps/web/public

USER hrms
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
