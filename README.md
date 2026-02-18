# Voice UI - Interfaz de Voz Multimodelo

Interfaz web para interactuar por voz con ChatGPT, Grok y Gemini con visualizaciones en tiempo real.

## ⚙️ Configuración

1. Abre el archivo `script.js`.
2. Busca la constante `N8N_CLIENT_SECRET_URL` (hacia la línea 14).
3. Pega ahí la URL de tu endpoint de backend.

## 🔌 Requisitos del Backend

El proyecto necesita un endpoint que actúe como "pasarela" de claves API para no exponerlas en el frontend.

**Petición (POST):**
```json
{ "model": "chatgpt" }
```
*Los valores posibles de `model` son: `chatgpt`, `grok`, `gemini`, `elevenlabs`.*

**Respuesta Esperada:**
```json
{ "secret": "sk-..." }
```

## 🚀 Cómo ejecutar localmente

Debido al uso del micrófono, debes servir los archivos a través de un servidor local (localhost) o HTTPS.

**Con Python:**
```bash
python3 -m http.server
```

**Con Node.js:**
```bash
npx serve
```

Abre la URL que se muestre en la terminal (ej. `http://localhost:8000`) en tu navegador.
