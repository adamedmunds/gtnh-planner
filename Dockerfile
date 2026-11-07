# Builds the static site and serves it with nginx.
# Game content (public/data, public/textures) is NOT in the image: mount it at runtime (see DEPLOY.md).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Mount points for the game content, so a missing mount gives 404s instead of a broken image.
RUN mkdir -p /usr/share/nginx/html/data /usr/share/nginx/html/textures
EXPOSE 80
