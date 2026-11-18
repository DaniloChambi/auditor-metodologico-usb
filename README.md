# Auditor Metodológico USB — Segundo Parcial Metodología de la Investigación II

Aplicación web académica para auditar el Segundo Parcial de Metodología de la Investigación II (Guía Talleres de Grado USB 2026) con Gemini 2.5 Flash, rotación aleatoria de API Keys, retry con backoff exponencial ante HTTP 429, escala de calificación oficial (`>= 51` habilita certificado + examen completo en PDF con código Hash SHA-256) y soporte dual PHP / Node.js.

## Despliegue en Dokploy (Docker)

1. Crea una nueva **Application** en Dokploy conectada a este repositorio de GitHub (`main`).
2. En **Build Type**, selecciona **Dockerfile** (`./Dockerfile`).
3. En **Environment Variables**, configura:
   - `GEMINI_API_KEYS`: Una o varias API Keys de Google AI Studio separadas por coma (`AIzaSy...,AIzaSy...`).
   - `SECRET_SALT`: Cadena secreta aleatoria larga para firmar los códigos `verification_hash`.
   - `PORT`: `3000` (puerto por defecto expuesto en el `Dockerfile`).
4. En **Domains**, asigna tu dominio apuntando al puerto `3000` del contenedor y realiza el deploy.
5. Endpoint de healthcheck disponible en `GET /health` (`200 OK`, `{"status":"ok"}`).

## Ejecución Local

```sh
cp .env.example .env
# Edita .env con tus claves reales
node server.js
```

## Uso en Hosting Tradicional PHP

Sube `index.html`, `styles.css`, `app.js` y `evaluate.php` al directorio público de tu servidor PHP 8+ y define `GEMINI_API_KEYS` y `SECRET_SALT` en variables de entorno o en un archivo `.env` protegido.
