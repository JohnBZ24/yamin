# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Run
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/swagger-ui ./src/swagger-ui

# Never run a network-facing service as root; the alpine node images ship a
# preexisting unprivileged 'node' user for exactly this.
USER node

EXPOSE 3000
CMD ["node", "dist/main"]
