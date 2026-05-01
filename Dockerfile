FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY content ./content
RUN npm ci
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/content ./content
EXPOSE 8080
CMD ["node", "dist/http.js"]
