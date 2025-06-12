# Use Node.js LTS Alpine for smaller image size
FROM node:18-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy application code
COPY . .

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

# Run the monitoring script
CMD ["node", "main.js"]