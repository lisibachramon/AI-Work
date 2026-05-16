# Build the monorepo and produce a small runtime image for the API.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# ---- deps stage: install everything once for the whole workspace ----
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/mcp/package.json packages/mcp/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile=false

# ---- build stage ----
FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/api packages/api
RUN pnpm --filter @kitchen/shared build && \
    pnpm --filter @kitchen/db build && \
    pnpm --filter @kitchen/api build

# ---- runtime image ----
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl tini libvips && \
    rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/packages/api ./packages/api
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./
RUN mkdir -p /app/data/uploads/audio /app/data/uploads/photos
EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node packages/api/dist/server.js"]
