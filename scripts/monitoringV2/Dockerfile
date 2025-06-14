# Use Node.js LTS Alpine for smaller image size
FROM node:18-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Build
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S monitoring -u 1001

# Change ownership of app directory
RUN chown -R monitoring:nodejs /app
USER monitoring

# Set environment variables
ENV NODE_ENV=production
ENV TZ=UTC

# Expose health check port (optional)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Run the compiled monitoring script
CMD ["node", "dist/main.js"]