# Meridian game server (Colyseus + POST /matches launch endpoint).
# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:20-slim

WORKDIR /app
RUN corepack enable

# Workspace manifests first so dependency layers cache across source edits.
# tsconfig.base.json is load-bearing at RUNTIME, not just for tsc: the server
# runs through tsx, whose esbuild transform reads apps/server/tsconfig.json —
# which `extends` the root base. Without the base file the whole config is
# dropped, `experimentalDecorators` with it, and the @colyseus/schema
# decorators crash on boot ("Cannot read properties of undefined (reading
# 'constructor')").
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/rules/package.json packages/rules/
COPY packages/protocol/package.json packages/protocol/

RUN pnpm install --frozen-lockfile --filter server... --prod=false

COPY packages/rules packages/rules
COPY packages/protocol packages/protocol
COPY apps/server apps/server

# Stamped by `fly deploy --build-arg GIT_SHA=...`; surfaces in GET /healthz.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
EXPOSE 2567
CMD ["pnpm", "-C", "apps/server", "start"]
