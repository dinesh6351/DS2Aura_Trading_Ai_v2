# Frontend (Next.js 15). BUILD CONTEXT = repo root (saas-platform/).
# Railway: Root Directory = BLANK, Build → Dockerfile Path = frontend/Dockerfile,
# and a service variable NEXT_PUBLIC_API_URL = your backend's public https URL.
# NOTE: NODE_ENV is left unset during build so devDependencies (typescript,
# tailwind, postcss) install and `next build` succeeds.
FROM node:20-slim
WORKDIR /app

# NEXT_PUBLIC_* must be present at BUILD time (Next inlines it into the bundle).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install

COPY . .
RUN npm run build --workspace=shared \
 && npm run build --workspace=frontend

WORKDIR /app/frontend
EXPOSE 3000
ENV NODE_ENV=production
# Honour Railway's $PORT; fall back to 3000 locally.
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
