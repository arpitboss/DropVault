FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (production-ready or clean install)
RUN npm install

# Copy application source code
COPY . .

# Expose server port
EXPOSE 3000

# Start server
CMD ["node", "src/index.js"]
