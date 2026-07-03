# YouTube music bot — standalone Node process.
#
# Build:  docker build -t music-bot ./music-bot
# Run:    docker run -e WS_URL=... -e BOT_TOKEN=... -e ROOM_ID=... music-bot
# (or just: docker compose up --build)

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# tsx/typescript are devDependencies but needed to run the bot, so force npm
# to install them even though the container runs with NODE_ENV=production.
RUN npm ci --include=dev
ENV NODE_ENV=production
COPY . .
USER node
# Reads WS_URL, BOT_TOKEN, ROOM_ID (and optional BOT_NAME, COOLDOWN_MS,
# DJ_ROLE) from the environment — pass them via docker compose or -e flags.
CMD ["npm", "start"]
