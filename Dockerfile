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
ENV PORT=10000
ENV DB_DIR=/data

# Local silhouette morph + architecture lock (rembg person mask) + before/after checks.
# Use pip OpenCV (not apt python3-opencv) to avoid numpy ABI clashes with rembg.
# Preload u2netp into /opt/u2net so the runtime `node` user can read the weights.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pil python3-pip \
 && pip3 install --no-cache-dir --break-system-packages \
      'numpy<2' 'rembg[cpu]' onnxruntime opencv-python-headless \
 && mkdir -p /opt/u2net \
 && U2NET_HOME=/opt/u2net python3 -c "from rembg import new_session; new_session('u2netp'); print('rembg_ok')" \
 && python3 -c "from PIL import Image; print('pil_ok')" \
 && python3 -c "import cv2, numpy; print('cv2_ok', cv2.__version__, 'np', numpy.__version__)" \
 && chown -R node:node /opt/u2net \
 && rm -rf /var/lib/apt/lists/* /root/.cache/pip

ENV U2NET_HOME=/opt/u2net

RUN mkdir -p /data /app/seed-data && chown -R node:node /data /app

COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./backend/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/public ./backend/public
COPY --from=build /app/seed-data ./seed-data
COPY scripts/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 10000
VOLUME ["/data"]
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
