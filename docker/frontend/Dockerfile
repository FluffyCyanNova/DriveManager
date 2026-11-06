FROM node:22-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/frontend/nginx.tls.conf /etc/nginx/tls/nginx.tls.conf
COPY docker/frontend/10-select-tls.sh /docker-entrypoint.d/10-select-tls.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-select-tls.sh && chmod +x /docker-entrypoint.d/10-select-tls.sh
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80 443
