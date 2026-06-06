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
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
# Railway injects PORT at runtime; server.js reads process.env.PORT.
EXPOSE 8080
CMD ["npm", "start"]
