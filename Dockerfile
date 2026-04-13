FROM node:24-bookworm AS builder

WORKDIR /app

RUN corepack enable

ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com/
ENV PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com/

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-bookworm AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com/
ENV PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com/

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/config ./config

EXPOSE 3000

CMD ["pnpm", "start"]
