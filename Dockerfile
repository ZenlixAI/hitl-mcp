FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
WORKDIR /app

COPY . .
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app

ENV PORT=3000 \
    MCP_URL=http://0.0.0.0:3000 \
    HITL_SERVER_NAME=hitl-mcp \
    HITL_SERVER_VERSION=0.1.0 \
    HITL_HTTP_HOST=0.0.0.0 \
    HITL_HTTP_PORT=3000 \
    HITL_HTTP_API_PREFIX=/api/v1 \
    HITL_STORAGE=memory \
    HITL_REDIS_URL=redis://127.0.0.1:6379 \
    HITL_REDIS_PREFIX=hitl \
    HITL_TTL_SECONDS=604800 \
    HITL_ANSWERED_RETENTION_SECONDS=2592000 \
    HITL_PENDING_MAX_WAIT_SECONDS=0 \
    HITL_WAIT_MODE=terminal_only \
    HITL_API_KEY= \
    HITL_AGENT_AUTH_MODE=api_key \
    HITL_AGENT_SESSION_HEADER=x-agent-session-id \
    HITL_CREATE_CONFLICT_POLICY=error \
    HITL_LOG_LEVEL=info \
    HITL_ENABLE_METRICS=true

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/config ./config

USER node

EXPOSE 3000

CMD ["npm", "start"]
