FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install --only=production

# Copy all source files
COPY . .

# Expose the port Railway will use
EXPOSE 3000

# Start the lobby server
CMD ["node", "lobby-server.js"]