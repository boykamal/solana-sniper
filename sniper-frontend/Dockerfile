FROM node:20-alpine AS builder

# Install build dependencies including libudev
RUN apk add --no-cache python3 make g++ gcc libc-dev linux-headers eudev-dev

WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps

# Accept build args
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_RPC_ENDPOINT

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_RPC_ENDPOINT=$VITE_RPC_ENDPOINT

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80