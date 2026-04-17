from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/')    
def home():
   return jsonify({"message": "Backend Flask funcionando correctamente 🚀"})

@app.route('/api/info')
def get_info():
    data = {
        "status": "ok",
        "message": "Datos obtenidos desde el backend Flask 🧠",
        "author": "David González"
    }
    return jsonify(data)

if __name__ == '__main__':
    # Escucha en todas las interfaces dentro del contenedor
    app.run(host='0.0.0.0', port=5000, debug=True)