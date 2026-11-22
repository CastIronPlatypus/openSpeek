# syntax=docker/dockerfile:1
# openSpeek: web client + optional server in one image.
#   docker build -t openspeek .
#   docker run -p 8787:8787 openspeek
# See docker-compose.yml for the variant with a server-side Phonon backend.

# ── 1. Build the web client ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── 2. Server dependencies (production only) ────────────────────────────
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── 3. Runtime ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY --from=client /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "server/src/index.js"]
