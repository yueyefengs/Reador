FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci
FROM dependencies AS builder
COPY . .
RUN npm run build
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=builder --chown=node:node /app/src/lib ./src/lib
COPY --from=dependencies /app/node_modules ./node_modules
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
CMD ["sh", "-c", "node --import tsx scripts/migrate.ts && node server.js"]
