# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# EXPO_PUBLIC_* vars are inlined into the bundle at export time, not read at
# runtime — so the API address has to be decided here. Empty default keeps the
# app's own fallback (http://localhost:3000), which is right for a desktop
# browser on this machine but useless from a phone, where "localhost" is the
# phone. Set it to the host's LAN address to test on a real device:
#   docker compose build --build-arg EXPO_PUBLIC_API_URL=http://192.168.10.61:3000 frontend
ARG EXPO_PUBLIC_API_URL=""
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web

# Stage 2: Serve
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
# `serve` reads its config from the directory it serves. Without this, index.html
# is cached by the browser and keeps pointing at a stale hashed bundle, so a
# redeploy appears to change nothing until the user hard-refreshes.
#
# serve.json must contain ONLY keys serve's schema knows about — it validates
# strictly and refuses to start on anything extra, so no "$schema" key and no
# "//" comments in that file (which is why this explanation lives here).
COPY serve.json ./dist/serve.json

USER node

EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
