FROM node:18

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json (y lock) antes de copiar todo el código,
# así se aprovecha la cache si no cambian las dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer puerto y comando para iniciar
EXPOSE 5005
CMD ["npm", "start"]
