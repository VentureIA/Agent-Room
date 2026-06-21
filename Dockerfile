FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=4318
ENV HOST=0.0.0.0
ENV AGENTROOM_RELAY_DATA_DIR=/data

WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/README.md ./README.md

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4318

CMD ["node", "dist/server/hosted-relay.js"]
