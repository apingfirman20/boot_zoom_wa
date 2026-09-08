FROM node:20-slim

WORKDIR /app

# Salin package.json dan install dependensi
COPY package*.json ./
RUN npm install --omit=dev

# Salin seluruh kode proyek
COPY . .

# Port default (Railway akan menginjeksi PORT secara dinamis)
EXPOSE 8000
ENV PORT=8000

# Jalankan bot WhatsApp
CMD ["node", "bot.js"]
