FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install backend deps
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci || npm install

# Install frontend deps
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci || npm install

# Copy source
COPY . .

# Build frontend
RUN cd frontend && npm run build

# Build backend
RUN cd backend && npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Copy built artifacts + production deps
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/frontend/dist ./backend/public

# Data directory (Render has ephemeral disk; we recommend Render Disks for production)
RUN mkdir -p /app/backend/data

ENV NODE_ENV=production
ENV PORT=10000
ENV DB_DIR=/app/backend/data

EXPOSE 10000

WORKDIR /app/backend
CMD ["node", "dist/server.js"]
