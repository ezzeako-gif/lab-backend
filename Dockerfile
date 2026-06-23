# 1. Usar una imagen oficial y ligera de Node.js
FROM node:18-alpine

# 2. Crear y posicionarse en la carpeta de trabajo dentro del contenedor
WORKDIR /usr/src/app

# 3. Copiar el archivo de dependencias
COPY package*.json ./

# 4. Instalar las librerías necesarias
RUN npm install

# 5. Copiar el resto del código del servidor
COPY . .

# 6. Exponer el puerto del Backend
EXPOSE 5000

# 7. Comando para arrancar el servidor
CMD ["npm", "start"]