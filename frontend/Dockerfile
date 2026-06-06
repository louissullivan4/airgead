# ---- deps: install all dependencies (build needs dev deps) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- dev: used by docker-compose for local development (next dev) ----
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- builder: produce the standalone Next.js output ----
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined at build time. Override via --build-arg if the
# feature flag should be on in a given image.
ARG NEXT_PUBLIC_OCR_AUTOFILL_ENABLED=false
ENV NEXT_PUBLIC_OCR_AUTOFILL_ENABLED=${NEXT_PUBLIC_OCR_AUTOFILL_ENABLED}
RUN npm run build

# ---- runner (default target: production image) ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# Standalone output bundles a minimal node_modules + server.js; static assets
# and public/ (incl. the Serwist-generated sw.js) are copied alongside it.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
