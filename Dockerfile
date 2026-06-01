# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/platform-admin/package.json apps/platform-admin/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/auth-client/package.json packages/auth-client/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN npm ci

FROM deps AS source
COPY . .

FROM source AS api-build
RUN npm run build --workspace @zara/core \
  && npm run build --workspace @zara/api

FROM node:22-alpine AS api
ENV NODE_ENV=production
ENV PORT=4010
WORKDIR /app

COPY --from=api-build /app/package.json /app/package-lock.json ./
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/apps/api/package.json ./apps/api/package.json
COPY --from=api-build /app/apps/api/dist-js ./apps/api/dist-js
COPY --from=api-build /app/packages/core/package.json ./packages/core/package.json
COPY --from=api-build /app/packages/core/dist ./packages/core/dist

USER node
EXPOSE 4010
CMD ["node", "apps/api/dist-js/main.js"]

FROM source AS web-build
ARG VITE_API_BASE_URL
ARG VITE_AUTH_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_AUTH_BASE_URL=${VITE_AUTH_BASE_URL}
RUN npm run build --workspace @zara/core \
  && npm run build --workspace @zara/auth-client \
  && npm run build --workspace @zara/web

FROM nginx:1.27-alpine AS web
COPY deploy/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM source AS platform-admin-build
ARG VITE_API_BASE_URL
ARG VITE_AUTH_BASE_URL
ARG VITE_PLATFORM_ADMIN_ORIGIN
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_AUTH_BASE_URL=${VITE_AUTH_BASE_URL}
ENV VITE_PLATFORM_ADMIN_ORIGIN=${VITE_PLATFORM_ADMIN_ORIGIN}
RUN npm run build --workspace @zara/auth-client \
  && npm run build --workspace @zara/platform-admin

FROM nginx:1.27-alpine AS platform-admin
COPY deploy/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=platform-admin-build /app/apps/platform-admin/dist /usr/share/nginx/html
EXPOSE 80
