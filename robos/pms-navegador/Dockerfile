# Robô do PMS dos hotéis: Chromium do Playwright (a versão da imagem é a mesma do package.json)
FROM mcr.microsoft.com/playwright:v1.49.1-noble
ENV TZ=America/Fortaleza
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY robo.mjs ./
CMD ["node", "robo.mjs"]
