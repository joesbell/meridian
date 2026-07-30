FROM ghcr.io/d4vinci/scrapling:latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs npm \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json requirements.txt ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV SCRAPLING_PYTHON=/usr/local/bin/python
ENV PORT=4173
EXPOSE 4173

CMD ["npm", "start"]
