FROM node:22-alpine AS build

WORKDIR /app

# npm workspaces require the root manifest and both workspace manifests.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --include-workspace-root

COPY backend backend
COPY database/migrations database/migrations
RUN npm run build --workspace backend

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/backend/package.json backend/package.json
COPY --from=build --chown=node:node /app/frontend/package.json frontend/package.json
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --from=build --chown=node:node /app/backend/src backend/src
COPY --from=build --chown=node:node /app/database/migrations database/migrations
COPY --from=build --chown=node:node /app/node_modules node_modules

USER node
EXPOSE 4000

# Compose runs the migration runner once before starting the API.
CMD ["npm", "run", "start", "--workspace", "backend"]
