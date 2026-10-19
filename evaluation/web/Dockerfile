# DocuMind Evaluation web (Next.js standalone). Build context = repo root:
#   docker build -f evaluation/web/Dockerfile -t documind-eval-web \
#     --build-arg NEXT_PUBLIC_APP_URL=https://documind.zeeshanai.cloud .
FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY evaluation/web/package.json evaluation/web/pnpm-lock.yaml evaluation/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY evaluation/web/ ./
# DocuMind's public URL ("Forgot password", "Open DocuMind"), inlined into the bundle at build
# time. Everything else (auth, eval API, DB) is runtime-only.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# public/ is empty (so untracked by git) and may be missing in the checkout.
RUN mkdir -p public && pnpm build

FROM node:24-alpine AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/robots.txt >/dev/null || exit 1
CMD ["node", "server.js"]
