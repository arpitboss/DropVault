FROM node:22-alpine

# Install wget for container health checks
RUN apk add --no-cache wget

WORKDIR /app

# Ensure uploads directory exists and is owned by the unprivileged node user
RUN mkdir -p /app/uploads && chown -R node:node /app

# Copy package manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application code with unprivileged user ownership
COPY --chown=node:node . .

# Switch to non-root user for enhanced security
USER node

# Expose HTTP listener port
EXPOSE 3000

# Container Health Check (V0-T14)
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Start DropVault server
CMD ["node", "src/index.js"]
