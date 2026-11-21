# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Tools that node-gyp needs to compile better-sqlite3 (Stage 1 only)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy only the package files first, so Docker can reuse this layer
# when only the source code changes
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev packages (typescript, tsx, types). Keeps the native build of better-sqlite3.
RUN npm prune --omit=dev

# ---------- Stage 2: run ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The SQLite file lives here. Owned by the non-root user so it can write.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]