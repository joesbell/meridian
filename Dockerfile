FROM ghcr.io/d4vinci/scrapling:latest

# Node 22 LTS（better-sqlite3@13 要求 >=22；Debian apt 源的 nodejs 只有 18，不能用）
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json requirements.txt ./
RUN npm ci
COPY . .
# 前端 Turnstile 站点密钥在构建期注入 bundle（.dockerignore 排除了 .env，需显式传 build-arg）
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN npm run build

ENV NODE_ENV=production
ENV SCRAPLING_PYTHON=/usr/local/bin/python
ENV PORT=4173
EXPOSE 4173

CMD ["npm", "start"]
