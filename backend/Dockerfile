FROM python:3.11.13-alpine3.21

WORKDIR /app

COPY requirements.txt . 
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Exponer el puerto 5000 (Flask)
EXPOSE 5000

# Variable de entorno para Flask
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0
ENV FLASK_ENV=development

# Ejecutamos directamente el script en lugar de usar 'flask run'
CMD ["python", "app.py"]