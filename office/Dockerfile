# DocuMind Office (Next.js standalone). Build context = repo root:
#   docker build -f office/Dockerfile -t documind-office \
#     --build-arg NEXT_PUBLIC_APP_URL=https://documind.zeeshanai.cloud .
# Migrate prod after a deploy: docker exec <office container> node scripts/migrate.mjs
FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY office/package.json office/pnpm-lock.yaml office/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY office/ ./
# DocuMind's public URL ("Continue in DocuMind", "Forgot password") and the Umami values are
# inlined into the bundle at build time. Everything else (auth, DB, API) is runtime-only.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_OFFICE_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_UMAMI_SCRIPT_URL=$NEXT_PUBLIC_UMAMI_SCRIPT_URL \
    NEXT_PUBLIC_OFFICE_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_OFFICE_UMAMI_WEBSITE_ID
RUN mkdir -p public && pnpm build

FROM node:24-alpine AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# `node scripts/migrate.mjs` needs only `pg` (in the standalone node_modules) and the SQL files.
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/robots.txt >/dev/null || exit 1
CMD ["node", "server.js"]
