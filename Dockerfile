FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8000
ENV HOST=0.0.0.0
ARG BUILD_SHA=local
ENV BUILD_SHA=$BUILD_SHA

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /data/backups && chown -R node:node /app /data

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.js"]
