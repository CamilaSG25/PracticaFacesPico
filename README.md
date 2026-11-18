# Ojitos curiosos ✨

Una página web estática con una carita animada que sigue una **estimación de la mirada** o el movimiento de tu cara usando la cámara del dispositivo.

## Funciona en

- Computadora y celular con un navegador moderno compatible con cámara y WebAssembly.
- GitHub Pages, sin backend ni Node.js.
- Modo de prueba sin cámara: mueve el cursor sobre la carita o desliza un dedo.

## Archivos para subir a GitHub

```text
index.html   ← página principal
styles.css   ← diseño de la carita y el sitio
app.js       ← cámara, seguimiento y animaciones
.nojekyll    ← indica a GitHub Pages que sirva los archivos tal cual
README.md    ← instrucciones
```

## Publicarla en GitHub Pages

1. Crea un repositorio público en GitHub (por ejemplo, `ojitos-curiosos`).
2. En **Add file → Upload files**, sube estos archivos **a la raíz del repositorio**, sin la carpeta contenedora.
3. Haz clic en **Commit changes**.
4. En **Settings → Pages**, selecciona **Deploy from a branch**, la rama **main** y la carpeta **/(root)**. Guarda.
5. Abre la dirección que te indique Pages: `https://TU-USUARIO.github.io/ojitos-curiosos/`.
6. Pulsa **Activar cámara**, acepta el permiso y **mira al centro durante un momento** para calibrar. Después mira a los lados. Puedes repetir con **Recentrar mirada**.

> La cámara necesita HTTPS o `localhost`. Abrir `index.html` directamente como `file://` no es una forma fiable de probar los permisos. GitHub Pages ya usa HTTPS.

## Cómo funciona

- `getUserMedia()` solicita acceso explícito a la cámara frontal.
- [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) encuentra puntos del rostro e iris en tiempo real.
- Se calcula una dirección **aproximada** según las posiciones de los iris dentro de los ojos y el movimiento de la nariz respecto a la calibración inicial.
- CSS y JavaScript mueven la carita y sus pupilas suavemente.

**Limitaciones:** es una aproximación visual, **no** un eye tracker profesional que sepa exactamente qué punto de la pantalla estás mirando. La iluminación, las gafas, los parpadeos, el dispositivo y la posición de la cámara influyen. Si los ojos no se detectan bien, prueba el ajuste **Solo mi rostro**.

## Privacidad y conexión

Este proyecto no almacena fotos ni videos, ni los sube a un servidor. El análisis de los fotogramas se ejecuta en el navegador, en el dispositivo del visitante. La primera vez sí necesita internet para descargar el JavaScript/WASM de MediaPipe, la fuente tipográfica y el modelo de detección, desde sus proveedores externos. La biblioteca de MediaPipe puede emitir métricas técnicas de uso de su API según su política de privacidad.

## Personalización

- Colores y tamaño de la carita: `styles.css`.
- Velocidad de seguimiento: parámetro `0.12` en la función `animate` de `app.js`.
- Intensidad: control **Sensibilidad** del sitio.
- Algoritmo de mirada: función `updateFromFace()` de `app.js`.

Hecho en HTML, CSS y JavaScript puro. Sin instalaciones ni compilación.
