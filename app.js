// OJITOS CURIOSOS - proyecto estático para GitHub Pages.
// La cámara se procesa localmente con MediaPipe Face Landmarker.
// No grabamos ni enviamos fotogramas a ningún servidor.

const MEDIAPIPE_VERSION = '0.10.18';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;

const $ = (id) => document.getElementById(id);
const elements = {
  cameraBtn: $('cameraBtn'), cameraBtnText: $('cameraBtnText'),
  demoBtn: $('demoBtn'), demoBtnText: $('demoBtnText'),
  calibrateBtn: $('calibrateBtn'), trackingMode: $('trackingMode'),
  sensitivity: $('sensitivity'), sensitivityValue: $('sensitivityValue'),
  video: $('cameraVideo'), preview: $('miniPreview'), previewText: $('previewText'),
  stage: $('stage'), face: $('faceMotion'), hint: $('stageHint'),
  status: $('statusText'), statusDot: $('statusDot'),
};

let landmarker = null;
let modelPromise = null;
let stream = null;
let mode = 'idle'; // idle | starting | camera | demo
let sessionId = 0;
let lastVideoTime = -1;
let lastInferenceTime = 0;
let lastSeenFace = 0;
let calibrated = false;
let calibrationSamples = [];
let neutral = null;

const target = { x: 0, y: 0 };
const smooth = { x: 0, y: 0 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function status(message, type = 'idle') {
  if (elements.status.textContent !== message) elements.status.textContent = message;
  elements.statusDot.className = `status-dot ${type}`;
}

function setMode(next) {
  mode = next;
  const hasCamera = next === 'camera' || next === 'starting';
  elements.cameraBtnText.textContent = hasCamera ? 'Apagar cámara' : 'Activar cámara';
  elements.demoBtnText.textContent = next === 'demo' ? 'Salir de prueba' : 'Probar sin cámara';
  elements.preview.classList.toggle('show-video', hasCamera && !!stream);
  elements.previewText.textContent = hasCamera ? 'Vista previa en vivo' : 'Apagada por ahora';
  elements.calibrateBtn.disabled = next !== 'camera';
  if (next === 'idle') {
    target.x = target.y = 0;
    elements.hint.textContent = '¡Aquí estoy! ♡';
    status('Esperando para jugar');
  }
  if (next === 'demo') {
    elements.hint.textContent = 'Mueve el cursor o tu dedo ✨';
    status('Modo prueba activado', 'active');
  }
}

function resetCalibration() {
  calibrated = false;
  calibrationSamples = [];
  neutral = null;
  target.x = target.y = 0;
  if (mode === 'camera') status('Mira al centro unos segundos…', 'busy');
}

async function getLandmarker() {
  if (landmarker) return landmarker;
  if (!modelPromise) {
    modelPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(`${CDN_BASE}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${CDN_BASE}/wasm`);
      const common = {
        runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      };
      try {
        return await FaceLandmarker.createFromOptions(vision, {
          ...common, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        });
      } catch (gpuError) {
        console.warn('GPU no disponible; intentando CPU.', gpuError);
        return FaceLandmarker.createFromOptions(vision, {
          ...common, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        });
      }
    })().then((instance) => {
      landmarker = instance;
      return instance;
    }).catch((error) => {
      modelPromise = null; // Permite reintentar si falla la red.
      throw error;
    });
  }
  return modelPromise;
}

function stopCamera() {
  ++sessionId; // Invalida tareas asíncronas anteriores.
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  elements.video.pause();
  elements.video.srcObject = null;
  lastVideoTime = -1;
  setMode('idle');
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    status('Abre la página con HTTPS (GitHub Pages) para usar cámara', 'error');
    return;
  }
  const mySession = ++sessionId;
  setMode('starting');
  status('Solicitando permiso de cámara…', 'busy');

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
    });
    if (mySession !== sessionId) {
      newStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = newStream;
    elements.video.srcObject = stream;
    elements.preview.classList.add('show-video');
    await elements.video.play();
    if (mySession !== sessionId) return;

    status('Preparando detección de rostro…', 'busy');
    await getLandmarker();
    if (mySession !== sessionId) return;

    setMode('camera');
    elements.hint.textContent = 'Mira a la cámara para empezar ♡';
    resetCalibration();
    lastVideoTime = -1;
  } catch (error) {
    if (mySession !== sessionId) return;
    console.error('No se pudo iniciar la cámara:', error);
    stopCamera();
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
      status('Permite el acceso a la cámara en tu navegador', 'error');
    } else if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
      status('No se encontró una cámara disponible', 'error');
    } else {
      status('No se pudo cargar la cámara o el modelo. Revisa tu conexión', 'error');
    }
    elements.hint.textContent = 'Puedes probar sin cámara ♡';
  }
}

// Cada ojo: esquinas, iris y párpados. Se normaliza por el tamaño del ojo.
function readEye(points, irisIndex, cornerA, cornerB, topIndex, bottomIndex) {
  const iris = points[irisIndex];
  const a = points[cornerA], b = points[cornerB];
  const upper = points[topIndex], lower = points[bottomIndex];
  if (!iris || !a || !b || !upper || !lower) return null;
  const xMin = Math.min(a.x, b.x), xMax = Math.max(a.x, b.x);
  const yMin = Math.min(upper.y, lower.y), yMax = Math.max(upper.y, lower.y);
  const width = xMax - xMin, height = yMax - yMin;
  if (width < 0.001 || height / width < 0.14) return null; // Parpadeo.
  return {
    x: (iris.x - xMin) / width - 0.5,
    y: (iris.y - yMin) / height - 0.5,
  };
}

function getMeasurements(points) {
  const nose = points[1];
  if (!nose) return null;
  // Índices MediaPipe: iris 468 / 473; esquinas 33-133 / 362-263.
  const eyes = [
    readEye(points, 468, 33, 133, 159, 145),
    readEye(points, 473, 362, 263, 386, 374),
  ].filter(Boolean);
  const gaze = eyes.length ? {
    x: eyes.reduce((sum, eye) => sum + eye.x, 0) / eyes.length,
    y: eyes.reduce((sum, eye) => sum + eye.y, 0) / eyes.length,
  } : null;
  return { faceX: nose.x, faceY: nose.y, gaze };
}

function updateFromFace(points) {
  const current = getMeasurements(points);
  if (!current) return;
  lastSeenFace = performance.now();

  // Los primeros fotogramas se toman como la mirada neutral.
  // También se puede repetir con «Recentrar mirada».
  if (!calibrated) {
    if (!current.gaze && elements.trackingMode.value === 'eyes') return;
    calibrationSamples.push(current);
    if (calibrationSamples.length < 20) return;
    neutral = {
      faceX: calibrationSamples.reduce((s, v) => s + v.faceX, 0) / calibrationSamples.length,
      faceY: calibrationSamples.reduce((s, v) => s + v.faceY, 0) / calibrationSamples.length,
      gazeX: calibrationSamples.filter((v) => v.gaze).reduce((s, v) => s + v.gaze.x, 0) / (calibrationSamples.filter((v) => v.gaze).length || 1),
      gazeY: calibrationSamples.filter((v) => v.gaze).reduce((s, v) => s + v.gaze.y, 0) / (calibrationSamples.filter((v) => v.gaze).length || 1),
    };
    calibrated = true;
    calibrationSamples = [];
    status('¡Te encontré! ✨', 'active');
    elements.hint.textContent = 'Mira a los lados ♡';
  }

  const sensitivity = Number(elements.sensitivity.value);
  // X se invierte porque la cámara frontal se muestra como un espejo.
  const headX = clamp((neutral.faceX - current.faceX) * 5, -1, 1);
  const headY = clamp((current.faceY - neutral.faceY) * 5, -1, 1);
  const eyesX = current.gaze ? clamp((neutral.gazeX - current.gaze.x) * 4.8, -1, 1) : 0;
  const eyesY = current.gaze ? clamp((current.gaze.y - neutral.gazeY) * 3.4, -1, 1) : 0;
  const followEyes = elements.trackingMode.value === 'eyes' && !!current.gaze;
  target.x = clamp((followEyes ? eyesX * 0.78 + headX * 0.22 : headX) * sensitivity, -1, 1);
  target.y = clamp((followEyes ? eyesY * 0.78 + headY * 0.22 : headY) * sensitivity, -1, 1);
  status('Siguiendo tus movimientos', 'active');
}

function updateVideo(now) {
  if (mode !== 'camera' || !landmarker || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (now - lastInferenceTime < 65 || lastVideoTime === elements.video.currentTime) return;
  lastInferenceTime = now;
  lastVideoTime = elements.video.currentTime;
  try {
    const result = landmarker.detectForVideo(elements.video, now);
    const points = result.faceLandmarks?.[0];
    if (points) updateFromFace(points);
    else if (now - lastSeenFace > 500) {
      target.x = target.y = 0;
      status('No veo tu rostro. Acércate un poco', 'busy');
    }
  } catch (error) {
    console.error('Error al detectar el rostro:', error);
    stopCamera();
    status('Hubo un problema con el seguimiento', 'error');
  }
}

function animate(now) {
  updateVideo(now);
  // Suavizado para evitar saltos entre fotogramas.
  smooth.x += (target.x - smooth.x) * 0.12;
  smooth.y += (target.y - smooth.y) * 0.12;
  const maxX = Math.max(0, (elements.stage.clientWidth - elements.face.offsetWidth) / 2 - 14);
  const maxY = Math.max(0, (elements.stage.clientHeight - elements.face.offsetHeight) / 2 - 26);
  elements.face.style.setProperty('--move-x', `${(smooth.x * Math.min(maxX, 125)).toFixed(2)}px`);
  elements.face.style.setProperty('--move-y', `${(smooth.y * Math.min(maxY, 84)).toFixed(2)}px`);
  elements.face.style.setProperty('--tilt', `${(smooth.x * 5).toFixed(2)}deg`);
  document.documentElement.style.setProperty('--pupil-x', `${(smooth.x * 11).toFixed(2)}px`);
  document.documentElement.style.setProperty('--pupil-y', `${(smooth.y * 9).toFixed(2)}px`);
  requestAnimationFrame(animate);
}

elements.cameraBtn.addEventListener('click', () => {
  if (mode === 'camera' || mode === 'starting') stopCamera();
  else startCamera();
});

elements.demoBtn.addEventListener('click', () => {
  if (mode === 'camera' || mode === 'starting') stopCamera();
  setMode(mode === 'demo' ? 'idle' : 'demo');
});

elements.stage.addEventListener('pointermove', (event) => {
  if (mode !== 'demo') return;
  const bounds = elements.stage.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  const sensitivity = Number(elements.sensitivity.value);
  target.x = clamp((x - 0.5) * 2 * sensitivity, -1, 1);
  target.y = clamp((y - 0.5) * 2 * sensitivity, -1, 1);
});

elements.stage.addEventListener('pointerleave', () => {
  if (mode === 'demo') target.x = target.y = 0;
});

elements.calibrateBtn.addEventListener('click', () => resetCalibration());
elements.trackingMode.addEventListener('change', () => {
  if (mode === 'camera') resetCalibration();
});
elements.sensitivity.addEventListener('input', () => {
  elements.sensitivityValue.textContent = `${Number(elements.sensitivity.value).toFixed(1)}×`;
});

window.addEventListener('pagehide', () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

requestAnimationFrame(animate);
