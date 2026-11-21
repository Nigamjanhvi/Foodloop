FROM node:22-alpine AS build

WORKDIR /app

# Install the existing workspace dependencies and build the existing React app.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root

COPY frontend frontend
RUN npm run build --workspace frontend

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/backend/package.json backend/package.json
COPY --from=build --chown=node:node /app/frontend/package.json frontend/package.json
COPY --from=build --chown=node:node /app/frontend/vite.config.ts frontend/vite.config.ts
COPY --from=build --chown=node:node /app/frontend/dist frontend/dist
COPY --from=build --chown=node:node /app/node_modules node_modules

USER node
EXPOSE 5173

CMD ["npm", "run", "preview", "--workspace", "frontend", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
