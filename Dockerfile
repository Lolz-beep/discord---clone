# Discord clone — Next.js custom server + ws hub in one container.
#
# Build:  docker build -t discord-clone .
# Run:    docker run -p 3000:3000 discord-clone
# (or just: docker compose up --build)

FROM node:22-alpine AS deps
WORKDIR /app
# Install with a clean, reproducible tree from the lockfile.
# Dev dependencies are needed at runtime too: the server runs via tsx.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pre-compile the Next.js app (pages, chunks) into .next/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
# Run as the unprivileged user that ships with the node image.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# "npm start" = tsx server.ts --prod (serves the pre-built .next output).
CMD ["npm", "start"]
