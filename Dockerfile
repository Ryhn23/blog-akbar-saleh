# Base image with Node.js LTS (Alpine Linux)
FROM node:20-alpine AS base

# Install build dependencies for native addons (better-sqlite3) and font packages for canvas rendering
RUN apk add --no-cache python3 make g++ font-dejavu ttf-freefont fontconfig

WORKDIR /app

# Copy package manifests first for caching layers
COPY package*.json ./

# Install production dependencies and devDependencies (for tailwind build)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build production minified Tailwind CSS
RUN npm run build:css

# Clean up devDependencies to reduce image size
RUN npm prune --production

# Remove build tools to keep image lightweight
RUN apk del python3 make g++

# Create data and upload storage directories
RUN mkdir -p /app/data /app/public/uploads

# Environment settings
ENV NODE_ENV=production
ENV PORT=7842
ENV DATABASE_PATH=/app/data/database.sqlite

EXPOSE 7842

# Start application
CMD ["node", "app.js"]
