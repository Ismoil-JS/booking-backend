# ─────────────────────────────────────────────────────────
# Stage 1 — Builder
#   Installs ALL dependencies, generates Prisma client,
#   and compiles the TypeScript source to /dist
# ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Prisma engines on Alpine need OpenSSL runtime libs available
RUN apk add --no-cache openssl libc6-compat

# Copy manifests first so layer cache is reused when source changes
COPY package.json package-lock.json ./

# Install all deps (including devDependencies needed for nest build)
RUN npm ci

# Copy Prisma schema and generate the Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy the rest of the source
COPY . .

# Compile NestJS → dist/
RUN npm run build

# ─────────────────────────────────────────────────────────
# Stage 2 — Production image
#   Copies only the compiled output and production deps
# ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Prisma migrate/client also needs OpenSSL libs at runtime on Alpine
RUN apk add --no-cache openssl libc6-compat

# Copy package manifests and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema + generated client from builder
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy nest-cli.json (needed by nest start at runtime)
COPY nest-cli.json ./

# Uploads directory (persisted via a volume in production)
RUN mkdir -p uploads

# Expose the port NestJS listens on
EXPOSE 3000

# Run pending Prisma migrations then start the app.
# To skip auto-migration, override CMD in docker-compose / k8s.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
