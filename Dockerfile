FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends     ffmpeg fonts-dejavu-core git ca-certificates python3 python3-venv     && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/yt-dlp     && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]'
ENV PATH="/opt/yt-dlp/bin:${PATH}"
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN for arquivo in *.js; do node --check "$arquivo" || exit 1; done
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
