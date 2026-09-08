FROM node:20-slim

WORKDIR /app

# Salin package.json dan install dependensi
COPY package*.json ./
RUN npm install --omit=dev

# Salin seluruh kode proyek
COPY . .

# Hugging Face Spaces menggunakan port 7860 secara default
EXPOSE 7860
ENV PORT=7860

# Jalankan bot WhatsApp
CMD ["node", "bot.js"]
