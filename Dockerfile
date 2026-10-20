# --- build ---------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime -------------------------------------------------------------
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# production dependencies only — the compiler and the test runner stay behind
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts ./scripts

# uploads and backups are mounted as volumes; the folders have to exist first
RUN mkdir -p uploads backups && chown -R node:node /app
USER node

EXPOSE 3000

# the API has no health route of its own, so readiness is "login answers"
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>process.exit(r.status===400||r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
