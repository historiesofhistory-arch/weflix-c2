FROM node:20-slim AS builder

RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/moviebox-test/package.json ./artifacts/moviebox-test/
COPY lib/ ./lib/

RUN pnpm install --no-frozen-lockfile --ignore-scripts

COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/moviebox-test/ ./artifacts/moviebox-test/

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID

RUN NODE_ENV=production BASE_PATH=/ pnpm --filter @workspace/moviebox-test build

RUN pnpm --filter @workspace/api-server build

RUN cp -r artifacts/moviebox-test/dist/public artifacts/api-server/dist/public


FROM node:20-slim AS production

RUN npm install -g pnpm@10

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/lib/ ./lib/

RUN pnpm install --no-frozen-lockfile --ignore-scripts --prod \
    --filter @workspace/api-server

COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist

ENV NODE_ENV=production
ENV PORT=8000
ENV USE_CF_PROXY=true
ENV BFF_PROXY_URL=https://weflix-bff-proxy.popcorntv-proxy.workers.dev

EXPOSE 8000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
