# ---- deps: install production dependencies ----
# bcrypt and sharp compile native bindings from source on musl when no prebuilt
# binary is available, so the build toolchain is needed here (but not at runtime).
FROM node:20-alpine AS deps
WORKDIR /usr/src/app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

# ---- dev: full deps (incl. nodemon); used by docker-compose for local dev ----
FROM node:20-alpine AS dev
WORKDIR /usr/src/app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev"]

# ---- runtime (default target: production image) ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /usr/src/app
# apk upgrade pulls Alpine security patches the base image hasn't been rebuilt
# with yet (Trivy flags libssl3/libcrypto3); npm/yarn are removed because the
# runtime only needs the node binary and npm's bundled deps carry their own CVEs.
# hadolint ignore=DL3017
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
# Railway injects PORT at runtime; server.js reads process.env.PORT.
EXPOSE 8080
CMD ["node", "src/server.js"]
