# Clínica Tanah — production image for DigitalOcean App Platform / Droplets
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN npm run install:all

COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts

RUN npm run build \
 && mkdir -p /app/seed-data \
 && DB_DIR=/app/seed-data npm run seed

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DB_DIR=/data

RUN mkdir -p /data /app/seed-data && chown -R node:node /data /app

COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./backend/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/public ./backend/public
COPY --from=build /app/seed-data ./seed-data
COPY scripts/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
