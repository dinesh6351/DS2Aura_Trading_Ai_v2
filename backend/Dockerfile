# Backend (Express + Prisma + bot worker). BUILD CONTEXT = repo root (saas-platform/).
# Railway: Root Directory = BLANK, Build → Dockerfile Path = backend/Dockerfile.
# NOTE: do NOT set NODE_ENV=production during the build — that makes npm skip
# devDependencies (typescript, prisma) and the build fails. Railway sets
# NODE_ENV=production at RUNTIME via the service variable.
FROM node:20-slim
WORKDIR /app

# openssl + ca-certificates are required by Prisma's query engine
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install ALL workspace deps (every workspace's package.json must be present or
# npm workspace resolution fails).
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install

# Bring in the source and build: shared → prisma client (linux) → backend
COPY . .
RUN npm run build --workspace=shared \
 && npx prisma generate --schema backend/prisma/schema.prisma \
 && npm run build --workspace=backend

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "dist/index.js"]
