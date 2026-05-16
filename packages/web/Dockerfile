FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

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

FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
COPY packages/web packages/web
RUN pnpm --filter @kitchen/shared build && \
    pnpm --filter @kitchen/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/packages/web/build /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8081
