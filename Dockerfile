FROM node:20-alpine

# Crear usuario no-root para reducir superficie de ataque (A05 OWASP)
RUN addgroup -g 1001 -S nodejs && adduser -S finanzas -u 1001 -G nodejs

WORKDIR /app

# Instalación de dependencias en capa separada para aprovechar cache
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia el código de la aplicación
COPY --chown=finanzas:nodejs . .

# Asegurar que logs/ y data/ existen y son escribibles
RUN mkdir -p logs data && chown -R finanzas:nodejs logs data

USER finanzas

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
