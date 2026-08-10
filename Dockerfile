FROM ghcr.io/d4vinci/scrapling:latest

# Node 22 LTS（better-sqlite3@13 要求 >=22；Debian apt 源的 nodejs 只有 18，不能用）
# build-essential：better-sqlite3 预编译包下载失败时需从源码编译（node-gyp 需要 make/g++）
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates build-essential \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json requirements.txt ./
# requirements.txt 必须显式安装：base 镜像的 scrapling 是 /app 下的可编辑安装，
# 被我们的 COPY 混入项目文件后依赖链损坏（site-packages 里实际没有包）
RUN pip install --no-cache-dir -r requirements.txt
# 安装 scrapling 需要的浏览器二进制，base 镜像缓存的版本号与 pip 新装的对不上
RUN scrapling install
# scrape_live.py 的 CHROME_OPTIONS 带 real_chrome=True，需要真正的 Google Chrome
RUN playwright install chrome
RUN npm ci
COPY . .
# 清掉 base 镜像遗留的 scrapling 源码目录，避免 cwd=/app 时遮蔽 site-packages 里的正式安装
RUN rm -rf /app/scrapling
# 前端 Turnstile 站点密钥在构建期注入 bundle（.dockerignore 排除了 .env，需显式传 build-arg）
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
# 小内存 VPS 上 vite build（three.js/Spline 等大包）需要更大的 Node 堆，超出物理内存部分由 swap 承担
ENV NODE_OPTIONS="--max-old-space-size=2560"
RUN npm run build

ENV NODE_ENV=production
ENV SCRAPLING_PYTHON=/usr/local/bin/python
ENV PORT=4173
EXPOSE 4173

# 镜像内置空 .env 占位（.dockerignore 排除了真实 .env；npm start 带 --env-file=.env 要求文件存在，
# 真实配置由 docker run --env-file 注入）
RUN touch .env

# scrapling 基础镜像自带 ENTRYPOINT（scrapling CLI），必须清空，否则 CMD 会变成它的参数
ENTRYPOINT []
CMD ["npm", "start"]
