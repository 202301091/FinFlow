# Step 1: Base image with official Node.js 20 LTS (Slim Debian-based for maximum compatibility with native modules like bcrypt)
FROM node:20-slim

# Set working directory inside the container
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package manifests first to leverage Docker's build cache
COPY package*.json ./

# Install only production dependencies cleanly
RUN npm ci --omit=dev

# Copy application source code into container
COPY src/ ./src/

# Expose port (default 5000, dynamically configurable)
EXPOSE 5000

# Built-in health check probe for container orchestrators (Docker, Kubernetes, Render)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run as non-root user for container security best practice
USER node

# Start the application using our npm start script
CMD ["npm", "start"]
