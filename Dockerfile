# Imagen base de Nginx
FROM nginx:alpine

# Elimina la configuración por defecto
RUN rm /etc/nginx/conf.d/default.conf

# Copia tu archivo nginx.conf personalizado
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia los archivos estáticos del frontend (HTML, JS, CSS)
COPY . /usr/share/nginx/html

# Expone el puerto 80
EXPOSE 80
