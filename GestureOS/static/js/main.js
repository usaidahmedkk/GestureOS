/**
 * GestureOS — Main Frontend JavaScript
 * Handles SocketIO, all 6 modules, UI interactions, particles, etc.
 */

'use strict';

// ─── SocketIO Connection ──────────────────────────────────────────────────────
const socket = io({ reconnection: true, reconnectionDelay: 3000, reconnectionAttempts: Infinity });

// ─── Global State ─────────────────────────────────────────────────────────────
const state = {
  cameraActive: false,
  voiceActive: false,
  currentModule: null,
  volume: 50,
  brightness: 70,
  muted: false,
  handDetected: false,
  currentGesture: 'none',
  lastLandmarks: null,

  // Drawing state
  drawing: {
    active: false,
    color: '#00F5FF',
    brushSize: 6,
    strokes: 0,
    isErasing: false,
    lastX: null,
    lastY: null,
    history: [],
  },

  // Piano state
  piano: {
    baseOctave: 4,
    volume: 0.6,
    sustain: false,
    waveform: 'triangle',
    noteHistory: [],
    synth: null,
    activeKeys: new Set(),
  },

  // Theremin state
  theremin: {
    active: false,
    oscillator: null,
    gainNode: null,
    freq: 440,
    volume: 0.5,
    waveform: 'sine',
    pitchMin: 200,
    pitchMax: 1200,
  },

  // 3D state
  cube3d: {
    rotX: 0, rotY: 0, rotZ: 0,
    zoom: 1.0,
    speed: 1.0,
    shape: 'cube',
    dragging: false,
    lastX: 0, lastY: 0,
    autoRotate: false,
  },
};

// ─── Particles System ─────────────────────────────────────────────────────────
const particlesCanvas = document.getElementById('particles-canvas');
const pCtx = particlesCanvas.getContext('2d');
let particles = [];

function resizeParticles() {
  particlesCanvas.width = window.innerWidth;
  particlesCanvas.height = window.innerHeight;
}

function createParticle() {
  return {
    x: Math.random() * window.innerWidth,
    y: window.innerHeight + 10,
    size: Math.random() * 2 + 0.5,
    speedY: Math.random() * 0.8 + 0.3,
    speedX: (Math.random() - 0.5) * 0.3,
    opacity: Math.random() * 0.5 + 0.1,
    color: Math.random() > 0.5 ? '#00F5FF' : '#BF00FF',
    life: 0,
    maxLife: Math.random() * 300 + 200,
  };
}

function animateParticles() {
  pCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);

  // Add particles
  if (particles.length < 50) particles.push(createParticle());

  particles = particles.filter(p => p.life < p.maxLife && p.y > -10);

  for (const p of particles) {
    p.x += p.speedX;
    p.y -= p.speedY;
    p.life++;
    const progress = p.life / p.maxLife;
    const alpha = p.opacity * (1 - progress);
    pCtx.beginPath();
    pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    pCtx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
    pCtx.fill();
  }

  requestAnimationFrame(animateParticles);
}

window.addEventListener('resize', resizeParticles);
resizeParticles();
animateParticles();

// ─── Toast Notifications ──────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');

function showToast(message, icon = '✦') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
  console.log(`[Toast] ${message}`);
}

// ─── Side Panel ───────────────────────────────────────────────────────────────
const panelOverlay = document.getElementById('side-panel-overlay');
const sidePanel = document.getElementById('side-panel');

function openPanel() {
  panelOverlay.classList.add('open');
  sidePanel.classList.add('open');
}

function closePanel() {
  panelOverlay.classList.remove('open');
  sidePanel.classList.remove('open');
}

document.getElementById('btn-about').addEventListener('click', openPanel);
document.getElementById('btn-team').addEventListener('click', () => { openPanel(); setTimeout(() => { document.getElementById('team-section').scrollIntoView({ behavior: 'smooth' }); }, 300); });
panelOverlay.addEventListener('click', closePanel);
document.getElementById('btn-close-panel').addEventListener('click', closePanel);

// ─── Status Bar Updates ───────────────────────────────────────────────────────
function updateStatusBar() {
  document.getElementById('dot-camera').classList.toggle('active', state.cameraActive);
  document.getElementById('dot-hand').classList.toggle('active', state.handDetected);
  document.getElementById('dot-voice').classList.toggle('active', state.voiceActive);
  document.getElementById('stat-volume').textContent = state.volume + '%';
  document.getElementById('stat-brightness').textContent = state.brightness + '%';
}

// ─── Modal System ─────────────────────────────────────────────────────────────
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');

function openModal(moduleId) {
  state.currentModule = moduleId;

  // BUG 2 FIX: tell the backend which module is active so gesture-based
  // volume/brightness control (which lives server-side in app.py) only
  // ever fires while the Volume & Brightness module is actually open.
  socket.emit('set_active_module', { module: moduleId });

  modalOverlay.classList.add('open');
  const moduleConfig = MODULES[moduleId];
  if (moduleConfig) {
    modalTitle.innerHTML = `<span>${moduleConfig.icon}</span> ${moduleConfig.title}`;
    modalBody.innerHTML = moduleConfig.buildHTML();
    moduleConfig.init?.();
  }
  startCamera();
  console.log(`[Modal] Opened module: ${moduleId}`);
}

function closeModal() {
  const mod = MODULES[state.currentModule];
  mod?.teardown?.();
  state.currentModule = null;

  // BUG 2 FIX: clear active module server-side too, so nothing keeps
  // listening for brightness/volume gestures after the modal closes.
  socket.emit('set_active_module', { module: null });

  modalOverlay.classList.remove('open');
  modalBody.innerHTML = '';
  stopCamera();
  stopThereminAudio();
  console.log('[Modal] Closed');
}

document.getElementById('btn-modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal(); });

// ─── Camera Feed ──────────────────────────────────────────────────────────────
// BUG 1 FIX: the browser used to open its own webcam stream via
// getUserMedia() in parallel with the backend's OpenCV capture. On most
// Windows setups a webcam can't be held open by two separate processes at
// once, so the browser's getUserMedia() call silently failed after a few
// retries — leaving a black background even though the backend camera
// (and therefore the skeleton overlay, which only needs landmark data)
// worked fine. The fix: stop trying to grab the camera in the browser at
// all. Instead, the backend now streams JPEG frames over SocketIO
// ('video_frame' events, see app.py), and we draw them onto a canvas
// that sits behind the skeleton canvas.
let videoCanvas = null, videoCtx = null;
let skeletonCanvas = null, skeletonCtx = null;

function startCamera() {
  socket.emit('start_camera');
  setupSkeletonCanvas();
  state.cameraActive = true;
  updateStatusBar();
  showToast('Camera activated', '📸');
}

function stopCamera() {
  socket.emit('stop_camera');
  state.cameraActive = false;
  updateStatusBar();
}

function setupSkeletonCanvas() {
  skeletonCanvas = document.getElementById('skeleton-canvas');
  videoCanvas = document.getElementById('video-canvas');
  if (!skeletonCanvas || !videoCanvas) return;
  skeletonCtx = skeletonCanvas.getContext('2d');
  videoCtx = videoCanvas.getContext('2d');
  skeletonCanvas.width = 640;
  skeletonCanvas.height = 480;
  videoCanvas.width = 640;
  videoCanvas.height = 480;
}

// Draw incoming server-streamed frames as the background layer.
socket.on('video_frame', (data) => {
  if (!videoCtx || !videoCanvas) return;
  const img = new Image();
  img.onload = () => {
    videoCtx.drawImage(img, 0, 0, videoCanvas.width, videoCanvas.height);
    const placeholder = document.querySelector('.camera-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  };
  img.src = 'data:image/jpeg;base64,' + data.frame;
});

// ─── Hand Skeleton Drawing ────────────────────────────────────────────────────
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],         // Thumb
  [0,5],[5,6],[6,7],[7,8],         // Index
  [0,9],[9,10],[10,11],[11,12],    // Middle
  [0,13],[13,14],[14,15],[15,16],  // Ring
  [0,17],[17,18],[18,19],[19,20],  // Pinky
  [5,9],[9,13],[13,17]             // Palm
];

const FINGER_COLORS = ['#00F5FF','#00F5FF','#00F5FF','#00F5FF',  // Thumb (cyan)
  '#FF006E','#FF006E','#FF006E','#FF006E',  // Index (pink)
  '#AAFF00','#AAFF00','#AAFF00','#AAFF00',  // Middle (green)
  '#FF6B00','#FF6B00','#FF6B00','#FF6B00',  // Ring (orange)
  '#BF00FF','#BF00FF','#BF00FF','#BF00FF',  // Pinky (purple)
  '#ffffff','#ffffff','#ffffff'              // Palm (white)
];

function drawHandSkeleton(hands) {
  if (!skeletonCtx || !skeletonCanvas) return;
  skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);

  for (const hand of hands) {
    const lm = hand.landmarks;
    const w = skeletonCanvas.width, h = skeletonCanvas.height;

    // Draw connections
    HAND_CONNECTIONS.forEach(([a, b], i) => {
      const ptA = lm[a], ptB = lm[b];
      const color = FINGER_COLORS[i] || '#ffffff';
      skeletonCtx.beginPath();
      skeletonCtx.moveTo(ptA.x * w, ptA.y * h);
      skeletonCtx.lineTo(ptB.x * w, ptB.y * h);
      skeletonCtx.strokeStyle = color + 'aa';
      skeletonCtx.lineWidth = 2;
      skeletonCtx.stroke();
    });

    // Draw landmark dots
    lm.forEach((pt, idx) => {
      const x = pt.x * w, y = pt.y * h;
      skeletonCtx.beginPath();
      skeletonCtx.arc(x, y, 5, 0, Math.PI * 2);
      skeletonCtx.fillStyle = '#00F5FF';
      skeletonCtx.shadowColor = '#00F5FF';
      skeletonCtx.shadowBlur = 10;
      skeletonCtx.fill();
      skeletonCtx.shadowBlur = 0;
    });
  }
}

// ─── SocketIO Event Handlers ──────────────────────────────────────────────────
socket.on('connect', () => {
  console.log('[Socket] Connected:', socket.id);
  showToast('Connected to GestureOS server', '🟢');
  socket.emit('get_status');
});

socket.on('disconnect', () => {
  console.log('[Socket] Disconnected — will retry...');
  showToast('Connection lost — reconnecting...', '🔴');
  state.cameraActive = false;
  state.handDetected = false;
  updateStatusBar();
});

socket.on('system_status', (data) => {
  console.log('[Status]', data);
  state.volume = data.volume || 50;
  state.brightness = data.brightness || 70;
  updateStatusBar();
  updateVolumeUI(state.volume);
  updateBrightnessUI(state.brightness);
});

socket.on('hand_landmarks', (data) => {
  state.handDetected = data.hands && data.hands.length > 0;
  state.currentGesture = data.gesture || 'none';
  state.lastLandmarks = data;

  // Update status
  const dot = document.getElementById('dot-hand');
  if (dot) dot.classList.toggle('active', state.handDetected);

  const gestureEl = document.getElementById('gesture-value');
  if (gestureEl) gestureEl.textContent = state.currentGesture.toUpperCase();

  // Draw skeleton
  if (state.handDetected) drawHandSkeleton(data.hands);

  // Module-specific handling
  if (state.currentModule === 'drawing' && data.index_tip) {
    handleDrawingGesture(data);
  } else if (state.currentModule === 'theremin' && data.hand_position) {
    handleThereminPosition(data.hand_position);
  } else if (state.currentModule === 'spatial' && data.hand_position) {
    handleSpatialGesture(data);
  } else if (state.currentModule === 'piano' && data.hands?.length) {
    handlePianoGesture(data);
  }
});

socket.on('volume_changed', (data) => {
  state.volume = data.level;
  state.muted = data.muted || false;
  updateVolumeUI(state.volume);
  updateStatusBar();
});

socket.on('brightness_changed', (data) => {
  state.brightness = data.level;
  updateBrightnessUI(state.brightness);
  updateStatusBar();
});

socket.on('camera_status', (data) => {
  state.cameraActive = data.active;
  updateStatusBar();
});

socket.on('voice_status', (data) => {
  state.voiceActive = data.active;
  updateStatusBar();
  const dot = document.getElementById('dot-voice');
  if (dot) dot.classList.toggle('active', state.voiceActive);
});

socket.on('voice_result', (data) => {
  console.log('[Voice]', data);
  updateVoiceUI(data);
  highlightCommandChip(data.command);
  addCommandLog(data.command, data.text);
  if (data.command === 'selfie' || data.action === 'selfie') takeSelfie();
  if (data.command === 'clear' || data.action === 'clear_canvas') clearDrawingCanvas();
});

socket.on('voice_action', (data) => {
  if (data.action === 'selfie') takeSelfie();
  if (data.action === 'clear_canvas') clearDrawingCanvas();
});

socket.on('error', (data) => {
  console.error('[Error]', data.message);
  showToast(data.message, '⚠️');
});

// ─── Volume & Brightness UI ───────────────────────────────────────────────────
function updateVolumeUI(level) {
  const el = document.getElementById('vol-meter-fill');
  if (el) {
    const circ = 2 * Math.PI * 52;
    el.style.strokeDasharray = circ;
    el.style.strokeDashoffset = circ * (1 - level / 100);
  }
  const numEl = document.getElementById('vol-number');
  if (numEl) numEl.textContent = level;
  const sliderEl = document.getElementById('vol-slider');
  if (sliderEl) sliderEl.value = level;
  const sliderEl2 = document.getElementById('vol-slider-2');
  if (sliderEl2) sliderEl2.value = level;
}

function updateBrightnessUI(level) {
  const el = document.getElementById('bright-meter-fill');
  if (el) {
    const circ = 2 * Math.PI * 52;
    el.style.strokeDasharray = circ;
    el.style.strokeDashoffset = circ * (1 - level / 100);
  }
  const numEl = document.getElementById('bright-number');
  if (numEl) numEl.textContent = level;
  const sliderEl = document.getElementById('bright-slider');
  if (sliderEl) sliderEl.value = level;
}

// ─── MODULE DEFINITIONS ───────────────────────────────────────────────────────
// NOTE: every module's camera-container markup now uses
// <canvas id="video-canvas"> (server-streamed feed, Bug 1 fix) instead of
// <video id="modal-video">. The skeleton canvas sits directly on top of it
// via CSS stacking (see the note at the end of this file about CSS).
const MODULES = {

  // ── Module 1: Air Drawing ─────────────────────────────────────────────────
  drawing: {
    icon: '✏️', title: 'Air Drawing',
    buildHTML: () => `
      <div class="modal-camera-side">
        <div class="camera-container">
          <canvas id="video-canvas"></canvas>
          <canvas id="skeleton-canvas"></canvas>
          <div class="camera-placeholder"><div class="cam-icon">📷</div><span>Starting camera...</span></div>
          <div class="camera-label">LIVE — HAND TRACKING</div>
        </div>
        <div class="gesture-display">
          <span class="gesture-label">Current Gesture</span>
          <span class="gesture-value" id="gesture-value">NONE</span>
        </div>
        <button class="btn-cam-toggle" id="btn-cam-toggle">📷 Camera Active</button>
      </div>
      <div class="modal-controls-side">
        <div class="section-title">Drawing Canvas</div>
        <div class="drawing-canvas-wrap">
          <canvas id="drawing-canvas" width="640" height="480"></canvas>
        </div>

        <div class="section-title">Brush Settings</div>
        <div class="color-picker-row" id="color-row">
          ${['#00F5FF','#FF006E','#AAFF00','#FF6B00','#BF00FF','#FFE000'].map(c =>
            `<div class="color-swatch${c==='#00F5FF'?' active':''}" style="background:${c}" data-color="${c}" onclick="setDrawColor('${c}', this)"></div>`
          ).join('')}
          <input type="color" id="custom-color" class="custom-color-input" value="#ffffff" title="Custom color" onchange="setDrawColor(this.value, null)">
        </div>
        <div class="range-group">
          <span class="range-label">Brush Size</span>
          <input type="range" class="range-input" id="brush-slider" min="1" max="30" value="6" oninput="setBrushSize(this.value)">
          <span class="range-value" id="brush-val">6</span>
        </div>
        <div class="btn-row">
          <button class="btn-action" id="btn-eraser" onclick="toggleEraser()">🧹 Eraser</button>
          <button class="btn-action danger" onclick="clearDrawingCanvas()">🗑 Clear</button>
          <button class="btn-action" onclick="saveDrawing()">💾 Save</button>
        </div>

        <div class="section-title">Drawing Stats</div>
        <div class="stats-grid">
          <div class="stat-box"><div class="stat-box-label">Total Strokes</div><div class="stat-box-value" id="stroke-count">0</div></div>
          <div class="stat-box"><div class="stat-box-label">Canvas Fill</div><div class="stat-box-value" id="canvas-fill">0%</div></div>
          <div class="stat-box"><div class="stat-box-label">Brush Color</div><div class="stat-box-value" id="current-color" style="color:#00F5FF">#00F5FF</div></div>
          <div class="stat-box"><div class="stat-box-label">Brush Size</div><div class="stat-box-value" id="current-size">6px</div></div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-dim);margin-top:8px;line-height:1.6;">
          ☝️ <b>1 finger</b> = Draw &nbsp; ✌️ <b>2 fingers</b> = Pause &nbsp; ✊ <b>Fist</b> = Stop
        </div>
      </div>`,
    init: () => initDrawingCanvas(),
    teardown: () => { state.drawing.lastX = null; state.drawing.lastY = null; }
  },

  // ── Module 2: Volume & Brightness ─────────────────────────────────────────
  volume: {
    icon: '🔊', title: 'Volume & Brightness',
    buildHTML: () => `
      <div class="modal-camera-side">
        <div class="camera-container">
          <canvas id="video-canvas"></canvas>
          <canvas id="skeleton-canvas"></canvas>
          <div class="camera-placeholder"><div class="cam-icon">📷</div><span>Starting camera...</span></div>
          <div class="camera-label">LIVE — HAND TRACKING</div>
        </div>
        <div class="gesture-display">
          <span class="gesture-label">Gesture</span>
          <span class="gesture-value" id="gesture-value">NONE</span>
        </div>
        <button class="btn-cam-toggle" id="btn-cam-toggle">📷 Camera Active</button>
      </div>
      <div class="modal-controls-side">
        <div class="section-title">Volume & Brightness Meters</div>
        <div class="meters-row">
          <div class="circular-meter">
            <svg width="130" height="130" viewBox="0 0 130 130">
              <circle class="meter-track" cx="65" cy="65" r="52" stroke-width="10"/>
              <circle class="meter-fill" id="vol-meter-fill" cx="65" cy="65" r="52" stroke-width="10" stroke="${'#00F5FF'}"
                stroke-dasharray="${2*Math.PI*52}" stroke-dashoffset="${2*Math.PI*52*(1-0.5)}"
                transform="rotate(-90 65 65)"/>
              <text class="meter-text-val" x="65" y="60" text-anchor="middle" id="vol-number">50</text>
              <text class="meter-text-unit" x="65" y="75" text-anchor="middle">%</text>
              <text class="meter-text-label" x="65" y="95" text-anchor="middle">VOLUME</text>
            </svg>
          </div>
          <div class="circular-meter">
            <svg width="130" height="130" viewBox="0 0 130 130">
              <circle class="meter-track" cx="65" cy="65" r="52" stroke-width="10"/>
              <circle class="meter-fill" id="bright-meter-fill" cx="65" cy="65" r="52" stroke-width="10" stroke="${'#FFE000'}"
                stroke-dasharray="${2*Math.PI*52}" stroke-dashoffset="${2*Math.PI*52*(1-0.7)}"
                transform="rotate(-90 65 65)"/>
              <text class="meter-text-val" x="65" y="60" text-anchor="middle" id="bright-number">70</text>
              <text class="meter-text-unit" x="65" y="75" text-anchor="middle">%</text>
              <text class="meter-text-label" x="65" y="95" text-anchor="middle">BRIGHTNESS</text>
            </svg>
          </div>
        </div>

        <div class="section-title">Manual Controls</div>
        <div class="range-group">
          <span class="range-label">Volume</span>
          <input type="range" class="range-input" id="vol-slider" min="0" max="100" value="50"
            oninput="setVolumeManual(this.value)">
          <span class="range-value" id="vol-slider-2">${state.volume}</span>
        </div>
        <div class="range-group">
          <span class="range-label">Brightness</span>
          <input type="range" class="range-input" id="bright-slider" min="0" max="100" value="70"
            oninput="setBrightnessManual(this.value)">
          <span class="range-value" id="bright-val">${state.brightness}</span>
        </div>
        <button class="btn-mute" id="btn-mute" onclick="toggleMute()">🔇 Toggle Mute</button>

        <div style="font-size:0.75rem;color:var(--text-dim);margin-top:12px;line-height:1.8;">
          🤏 <b>Right hand pinch</b> = Volume &nbsp; | &nbsp; 🤏 <b>Left hand pinch</b> = Brightness<br>
          ✊ <b>Fist</b> = Mute toggle
        </div>
      </div>`,
    init: () => {
      updateVolumeUI(state.volume);
      updateBrightnessUI(state.brightness);
    }
  },

  // ── Module 3: Piano ────────────────────────────────────────────────────────
  piano: {
    icon: '🎹', title: 'Piano Instrument',
    buildHTML: () => `
      <div class="modal-camera-side">
        <div class="camera-container">
          <canvas id="video-canvas"></canvas>
          <canvas id="skeleton-canvas"></canvas>
          <div class="camera-placeholder"><div class="cam-icon">📷</div><span>Starting camera...</span></div>
          <div class="camera-label">LIVE — HAND TRACKING</div>
        </div>
        <div class="gesture-display">
          <span class="gesture-label">Gesture</span>
          <span class="gesture-value" id="gesture-value">NONE</span>
        </div>
        <button class="btn-cam-toggle" id="btn-cam-toggle">📷 Camera Active</button>
      </div>
      <div class="modal-controls-side">
        <div class="section-title">Piano Keyboard</div>
        <div class="piano-keyboard" id="piano-keyboard"></div>

        <div class="section-title">Piano Settings</div>
        <div class="range-group">
          <span class="range-label">Octave</span>
          <button class="btn-action" onclick="pianoOctaveDown()" style="flex:0;padding:8px 14px">▼</button>
          <span class="range-value" style="width:40px;text-align:center" id="piano-octave">4</span>
          <button class="btn-action" onclick="pianoOctaveUp()" style="flex:0;padding:8px 14px">▲</button>
        </div>
        <div class="range-group">
          <span class="range-label">Volume</span>
          <input type="range" class="range-input" id="piano-vol-slider" min="0" max="100" value="60"
            oninput="setPianoVolume(this.value/100)">
          <span class="range-value" id="piano-vol-val">60</span>
        </div>
        <select class="styled-select" id="piano-waveform" onchange="setPianoWaveform(this.value)">
          <option value="triangle">Triangle Wave</option>
          <option value="sine">Sine Wave</option>
          <option value="square">Square Wave</option>
          <option value="sawtooth">Sawtooth Wave</option>
        </select>
        <div class="btn-row">
          <button class="btn-action" id="btn-sustain" onclick="toggleSustain()">🎵 Sustain: OFF</button>
        </div>

        <div class="section-title">Note History</div>
        <div class="note-history" id="note-history"></div>
      </div>`,
    init: () => initPiano(),
    teardown: () => teardownPiano()
  },

  // ── Module 4: Theremin ─────────────────────────────────────────────────────
  theremin: {
    icon: '🎵', title: 'Theremin Instrument',
    buildHTML: () => `
      <div class="modal-camera-side">
        <div class="camera-container">
          <canvas id="video-canvas"></canvas>
          <canvas id="skeleton-canvas"></canvas>
          <div class="camera-placeholder"><div class="cam-icon">📷</div><span>Starting camera...</span></div>
          <div class="camera-label">LIVE — HAND TRACKING</div>
        </div>
        <div class="gesture-display">
          <span class="gesture-label">Gesture</span>
          <span class="gesture-value" id="gesture-value">NONE</span>
        </div>
        <button class="btn-cam-toggle" id="btn-cam-toggle">📷 Camera Active</button>
      </div>
      <div class="modal-controls-side">
        <div class="section-title">Theremin Field</div>
        <div class="theremin-grid" id="theremin-grid">
          <canvas id="theremin-canvas"></canvas>
        </div>

        <div class="section-title">Frequency</div>
        <div class="freq-display">
          <span class="freq-value" id="freq-val">440</span>
          <span class="freq-unit">Hz</span>
        </div>

        <div class="section-title">Waveform</div>
        <canvas id="waveform-canvas" class="waveform-canvas"></canvas>

        <div class="section-title">Settings</div>
        <select class="styled-select" id="theremin-waveform" onchange="setThereminWaveform(this.value)">
          <option value="sine">Sine Wave</option>
          <option value="triangle">Triangle Wave</option>
          <option value="square">Square Wave</option>
          <option value="sawtooth">Sawtooth Wave</option>
        </select>
        <div class="range-group">
          <span class="range-label">Min Pitch</span>
          <input type="range" class="range-input" min="80" max="500" value="200"
            oninput="state.theremin.pitchMin=+this.value">
          <span class="range-value">200Hz</span>
        </div>
        <div class="range-group">
          <span class="range-label">Max Pitch</span>
          <input type="range" class="range-input" min="500" max="3000" value="1200"
            oninput="state.theremin.pitchMax=+this.value">
          <span class="range-value">1200Hz</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-dim);margin-top:8px;line-height:1.8;">
          ← → Hand X = Pitch &nbsp; | &nbsp; ↑ ↓ Hand Y = Volume<br>
          🖐 <b>Open palm</b> = Sound ON &nbsp; | &nbsp; ✊ <b>Fist</b> = Sound OFF
        </div>
      </div>`,
    init: () => initTheremin(),
    teardown: () => stopThereminAudio()
  },

  // ── Module 5: Spatial 3D ───────────────────────────────────────────────────
  spatial: {
    icon: '🎲', title: 'Spatial 3D Control',
    buildHTML: () => `
      <div class="modal-camera-side">
        <div class="camera-container">
          <canvas id="video-canvas"></canvas>
          <canvas id="skeleton-canvas"></canvas>
          <div class="camera-placeholder"><div class="cam-icon">📷</div><span>Starting camera...</span></div>
          <div class="camera-label">LIVE — HAND TRACKING</div>
        </div>
        <div class="gesture-display">
          <span class="gesture-label">Gesture</span>
          <span class="gesture-value" id="gesture-value">NONE</span>
        </div>
        <button class="btn-cam-toggle" id="btn-cam-toggle">📷 Camera Active</button>
      </div>
      <div class="modal-controls-side">
        <div class="section-title">3D Object</div>
        <canvas id="canvas3d" class="canvas-3d" width="380" height="320"></canvas>

        <div class="section-title">Rotation</div>
        <div class="rotation-display">
          <div class="rot-box"><div class="rot-axis">X°</div><div class="rot-val" id="rot-x">0</div></div>
          <div class="rot-box"><div class="rot-axis">Y°</div><div class="rot-val" id="rot-y">0</div></div>
          <div class="rot-box"><div class="rot-axis">Zoom</div><div class="rot-val" id="rot-zoom">1.0x</div></div>
        </div>

        <div class="section-title">Settings</div>
        <div class="range-group">
          <span class="range-label">Speed</span>
          <input type="range" class="range-input" min="1" max="5" value="1" step="0.5"
            oninput="state.cube3d.speed=+this.value">
          <span class="range-value">1x</span>
        </div>
        <select class="styled-select" id="shape-select" onchange="state.cube3d.shape=this.value;draw3DObject()">
          <option value="cube">Cube</option>
          <option value="pyramid">Pyramid</option>
          <option value="octahedron">Octahedron</option>
        </select>
        <div class="btn-row">
          <button class="btn-action" onclick="resetRotation()">↺ Reset</button>
          <button class="btn-action" id="btn-auto-rotate" onclick="toggleAutoRotate()">▶ Auto-Rotate</button>
        </div>
        <div style="font-size:0.75rem;color:var(--text-dim);margin-top:8px;line-height:1.8;">
          🖐 <b>Open palm</b> = Rotate mode<br>
          ← → Hand X = Y-axis &nbsp; | &nbsp; ↑ ↓ Hand Y = X-axis<br>
          🤏 <b>Pinch</b> = Zoom
        </div>
      </div>`,
    init: () => init3D(),
    teardown: () => { state.cube3d.autoRotate = false; }
  },

  // ── Module 6: Voice Control ────────────────────────────────────────────────
  voice: {
    icon: '🎙️', title: 'Voice Control',
    buildHTML: () => `
      <div class="modal-camera-side">
        <div class="camera-container">
          <canvas id="video-canvas"></canvas>
          <canvas id="skeleton-canvas"></canvas>
          <div class="camera-placeholder"><div class="cam-icon">📷</div><span>Starting camera...</span></div>
          <div class="camera-label">LIVE — HAND TRACKING</div>
        </div>
        <div class="gesture-display">
          <span class="gesture-label">Gesture</span>
          <span class="gesture-value" id="gesture-value">NONE</span>
        </div>
        <button class="btn-cam-toggle" id="btn-cam-toggle">📷 Camera Active</button>
      </div>
      <div class="modal-controls-side">
        <div class="section-title">Microphone</div>
        <div class="mic-ring-wrap">
          <div class="mic-ring inactive" id="mic-ring">
            <div class="mic-ring-pulse"></div>
            <div class="mic-ring-pulse"></div>
            <div class="mic-ring-pulse"></div>
            <div class="mic-icon-inner">🎙️</div>
          </div>
        </div>
        <button class="btn-voice-toggle" id="btn-voice-main" onclick="toggleVoice()">
          🎙️ Start Listening
        </button>

        <div class="section-title">Live Transcript</div>
        <div class="transcript-box" id="transcript-box">
          <span class="text-dim">Waiting for speech...</span>
        </div>

        <div class="section-title">Voice Commands</div>
        <div class="command-chips-grid" id="command-chips">
          ${['volume up','volume down','mute','brightness up','brightness down','clear','selfie'].map(cmd =>
            `<div class="command-chip" data-cmd="${cmd}">${cmd}</div>`
          ).join('')}
        </div>

        <div class="section-title">Command Log</div>
        <div class="command-log" id="command-log">
          <div class="log-entry"><span class="text-dim">No commands yet</span></div>
        </div>
      </div>`,
    init: () => {}
  }
};

// ─── Module Card Click Handlers ───────────────────────────────────────────────
document.querySelectorAll('.module-card').forEach(card => {
  card.addEventListener('click', () => {
    const moduleId = card.dataset.module;
    if (moduleId) openModal(moduleId);
  });
});

// ─── Camera Toggle Button ─────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.id === 'btn-cam-toggle') {
    if (state.cameraActive) {
      stopCamera();
      e.target.textContent = '📷 Start Camera';
      e.target.classList.remove('active');
    } else {
      startCamera();
      e.target.textContent = '⏹ Stop Camera';
      e.target.classList.add('active');
    }
  }
});

// ─── MODULE 1: Drawing Functions ──────────────────────────────────────────────
function initDrawingCanvas() {
  const canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  state.drawing.strokes = 0;

  // Mouse drawing
  let mouseDown = false;
  canvas.addEventListener('mousedown', e => { mouseDown = true; state.drawing.strokes++; });
  canvas.addEventListener('mouseup', () => { mouseDown = false; state.drawing.lastX = null; });
  canvas.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    drawOnCanvas(ctx, x, y);
  });
  console.log('[Drawing] Canvas initialized');
}

function drawOnCanvas(ctx, x, y) {
  if (!ctx) return;
  if (state.drawing.lastX === null) {
    state.drawing.lastX = x;
    state.drawing.lastY = y;
    return;
  }
  ctx.beginPath();
  ctx.moveTo(state.drawing.lastX, state.drawing.lastY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = state.drawing.isErasing ? '#000000' : state.drawing.color;
  ctx.lineWidth = state.drawing.isErasing ? state.drawing.brushSize * 3 : state.drawing.brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = state.drawing.isErasing ? 'transparent' : state.drawing.color;
  ctx.shadowBlur = state.drawing.isErasing ? 0 : 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  state.drawing.lastX = x;
  state.drawing.lastY = y;
  updateDrawingStats();
}

function handleDrawingGesture(data) {
  const canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { gesture, index_tip } = data;
  const x = index_tip.x * canvas.width;
  const y = index_tip.y * canvas.height;

  if (gesture === 'point') {
    if (state.drawing.lastX === null) state.drawing.strokes++;
    drawOnCanvas(ctx, x, y);
    state.drawing.active = true;
  } else if (gesture === 'peace' || gesture === 'fist') {
    state.drawing.lastX = null;
    state.drawing.lastY = null;
    state.drawing.active = false;
  } else {
    state.drawing.lastX = null;
    state.drawing.lastY = null;
  }
}

function updateDrawingStats() {
  const canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;
  document.getElementById('stroke-count').textContent = state.drawing.strokes;
  // Estimate fill
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let nonBlack = 0;
  for (let i = 0; i < imgData.data.length; i += 16) {
    if (imgData.data[i] > 10 || imgData.data[i+1] > 10 || imgData.data[i+2] > 10) nonBlack++;
  }
  const total = imgData.data.length / 64;
  const fill = Math.min(100, Math.round(nonBlack / total * 100));
  document.getElementById('canvas-fill').textContent = fill + '%';
  document.getElementById('current-color').textContent = state.drawing.color;
  document.getElementById('current-size').textContent = state.drawing.brushSize + 'px';
}

window.setDrawColor = (color, el) => {
  state.drawing.color = color;
  state.drawing.isErasing = false;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  const colorEl = document.getElementById('current-color');
  if (colorEl) { colorEl.textContent = color; colorEl.style.color = color; }
};

window.setBrushSize = (val) => {
  state.drawing.brushSize = +val;
  const el = document.getElementById('brush-val');
  if (el) el.textContent = val;
};

window.toggleEraser = () => {
  state.drawing.isErasing = !state.drawing.isErasing;
  const btn = document.getElementById('btn-eraser');
  if (btn) btn.textContent = state.drawing.isErasing ? '🎨 Draw' : '🧹 Eraser';
};

window.clearDrawingCanvas = () => {
  const canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  state.drawing.strokes = 0;
  state.drawing.lastX = null;
  state.drawing.lastY = null;
  updateDrawingStats();
  showToast('Canvas cleared', '🗑️');
};

window.saveDrawing = () => {
  const canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `gesture-drawing-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('Drawing saved!', '💾');
};

// ─── MODULE 2: Volume/Brightness Functions ────────────────────────────────────
window.setVolumeManual = (val) => {
  state.volume = +val;
  socket.emit('set_volume', { level: +val });
  updateVolumeUI(+val);
  const v = document.getElementById('vol-slider-2');
  if (v) v.textContent = val;
};

window.setBrightnessManual = (val) => {
  state.brightness = +val;
  socket.emit('set_brightness', { level: +val });
  updateBrightnessUI(+val);
  const v = document.getElementById('bright-val');
  if (v) v.textContent = val;
};

window.toggleMute = () => {
  socket.emit('toggle_mute');
  state.muted = !state.muted;
  const btn = document.getElementById('btn-mute');
  if (btn) { btn.textContent = state.muted ? '🔊 Unmute' : '🔇 Toggle Mute'; btn.classList.toggle('muted', state.muted); }
  showToast(state.muted ? 'Muted' : 'Unmuted', state.muted ? '🔇' : '🔊');
};

// ─── MODULE 3: Piano Functions ────────────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const WHITE_KEYS = [0,2,4,5,7,9,11,12,14,16,17,19,21,23]; // 2 octaves of white keys
const BLACK_KEYS = [1,3,6,8,10,13,15,18,20,22];

function noteToFreq(semitone) {
  // A4 = 440Hz = MIDI 69
  return 440 * Math.pow(2, (semitone - 69) / 12);
}

function initPiano() {
  const keyboard = document.getElementById('piano-keyboard');
  if (!keyboard) return;
  const totalWhite = 14;
  const keyWidth = keyboard.offsetWidth / totalWhite;

  // Create white keys
  WHITE_KEYS.forEach((semitone, i) => {
    const el = document.createElement('div');
    el.className = 'piano-key white';
    el.style.left = (i * keyWidth) + 'px';
    el.style.width = (keyWidth - 2) + 'px';
    el.style.height = '100%';
    el.dataset.semitone = semitone;
    const midiNote = (state.piano.baseOctave + 3) * 12 + semitone;
    el.addEventListener('mousedown', () => playPianoNote(midiNote, el));
    el.addEventListener('mouseup', () => releasePianoNote(midiNote, el));
    keyboard.appendChild(el);
  });

  // Create black keys
  const blackPositions = [0.6, 1.6, 3.6, 4.6, 5.6, 7.6, 8.6, 10.6, 11.6, 12.6];
  BLACK_KEYS.forEach((semitone, i) => {
    const el = document.createElement('div');
    el.className = 'piano-key black';
    el.style.left = (blackPositions[i] * keyWidth) + 'px';
    el.style.width = (keyWidth * 0.6) + 'px';
    el.style.height = '60%';
    el.dataset.semitone = semitone;
    const midiNote = (state.piano.baseOctave + 3) * 12 + semitone;
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); playPianoNote(midiNote, el); });
    el.addEventListener('mouseup', () => releasePianoNote(midiNote, el));
    keyboard.appendChild(el);
  });

  console.log('[Piano] Keyboard initialized');
}

function playPianoNote(midiNote, keyEl) {
  const freq = noteToFreq(midiNote);
  const noteName = NOTE_NAMES[midiNote % 12] + Math.floor(midiNote / 12 - 1);
  console.log(`[Piano] Note: ${noteName} (${freq.toFixed(1)}Hz)`);

  // Use Tone.js if available
  if (typeof Tone !== 'undefined') {
    if (!state.piano.synth) {
      state.piano.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: state.piano.waveform },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 1 }
      }).toDestination();
      state.piano.synth.volume.value = Tone.gainToDb(state.piano.volume);
    }
    Tone.start();
    state.piano.synth.triggerAttack(freq);
    state.piano.activeKeys.add(midiNote);
  }

  if (keyEl) keyEl.classList.add('active');
  addNoteHistory(noteName);
}

function releasePianoNote(midiNote, keyEl) {
  if (!state.piano.sustain && typeof Tone !== 'undefined' && state.piano.synth) {
    const freq = noteToFreq(midiNote);
    state.piano.synth.triggerRelease(freq);
  }
  state.piano.activeKeys.delete(midiNote);
  if (keyEl) keyEl.classList.remove('active');
}

function handlePianoGesture(data) {
  if (!data.hands?.length) return;
  const lm = data.hands[0].landmarks;
  const fingerTips = [4, 8, 12, 16, 20];
  const keyboard = document.getElementById('piano-keyboard');
  if (!keyboard) return;
  const totalWhite = 14;
  const keyWidth = 1.0 / totalWhite;

  fingerTips.forEach(tipIdx => {
    const tip = lm[tipIdx];
    const whiteIdx = Math.floor(tip.x / keyWidth);
    if (whiteIdx >= 0 && whiteIdx < WHITE_KEYS.length) {
      const semitone = WHITE_KEYS[whiteIdx];
      const midiNote = (state.piano.baseOctave + 3) * 12 + semitone;
      const keyEl = keyboard.children[whiteIdx];
      if (tip.y > 0.6) {
        playPianoNote(midiNote, keyEl);
        setTimeout(() => releasePianoNote(midiNote, keyEl), 200);
      }
    }
  });
}

function addNoteHistory(noteName) {
  state.piano.noteHistory.unshift(noteName);
  if (state.piano.noteHistory.length > 10) state.piano.noteHistory.pop();
  const histEl = document.getElementById('note-history');
  if (histEl) {
    histEl.innerHTML = state.piano.noteHistory.map(n => `<div class="note-chip">${n}</div>`).join('');
  }
}

window.pianoOctaveUp = () => {
  state.piano.baseOctave = Math.min(6, state.piano.baseOctave + 1);
  const el = document.getElementById('piano-octave');
  if (el) el.textContent = state.piano.baseOctave;
  if (state.piano.synth) { state.piano.synth.dispose(); state.piano.synth = null; }
  document.getElementById('piano-keyboard').innerHTML = '';
  initPiano();
};

window.pianoOctaveDown = () => {
  state.piano.baseOctave = Math.max(1, state.piano.baseOctave - 1);
  const el = document.getElementById('piano-octave');
  if (el) el.textContent = state.piano.baseOctave;
  if (state.piano.synth) { state.piano.synth.dispose(); state.piano.synth = null; }
  document.getElementById('piano-keyboard').innerHTML = '';
  initPiano();
};

window.setPianoVolume = (val) => {
  state.piano.volume = val;
  if (state.piano.synth && typeof Tone !== 'undefined') {
    state.piano.synth.volume.value = Tone.gainToDb(val);
  }
  const el = document.getElementById('piano-vol-val');
  if (el) el.textContent = Math.round(val * 100);
};

window.setPianoWaveform = (wf) => {
  state.piano.waveform = wf;
  if (state.piano.synth) { state.piano.synth.dispose(); state.piano.synth = null; }
};

window.toggleSustain = () => {
  state.piano.sustain = !state.piano.sustain;
  const btn = document.getElementById('btn-sustain');
  if (btn) btn.textContent = `🎵 Sustain: ${state.piano.sustain ? 'ON' : 'OFF'}`;
};

function teardownPiano() {
  if (state.piano.synth && typeof Tone !== 'undefined') {
    state.piano.synth.releaseAll();
    state.piano.synth.dispose();
    state.piano.synth = null;
  }
  state.piano.activeKeys.clear();
}

// ─── MODULE 4: Theremin Functions ─────────────────────────────────────────────
let thereminOscillator = null, thereminGain = null, audioCtx = null;
let waveformAnimId = null;

function initTheremin() {
  const canvas = document.getElementById('theremin-canvas');
  if (!canvas) return;
  drawThereminGrid(canvas, 0.5, 0.5);
  animateThereminWaveform();
  console.log('[Theremin] Initialized');
}

function startThereminAudio() {
  if (typeof Tone === 'undefined') return;
  try {
    Tone.start();
    if (!thereminOscillator) {
      thereminOscillator = new Tone.Oscillator({ frequency: 440, type: state.theremin.waveform }).toDestination();
      thereminGain = new Tone.Volume(0).toDestination();
      thereminOscillator.connect(thereminGain);
      thereminOscillator.start();
    }
    state.theremin.active = true;
  } catch (e) { console.error('[Theremin] Audio start error:', e); }
}

function stopThereminAudio() {
  if (thereminOscillator) {
    try { thereminOscillator.stop(); thereminOscillator.dispose(); } catch(e) {}
    thereminOscillator = null;
  }
  state.theremin.active = false;
  if (waveformAnimId) { cancelAnimationFrame(waveformAnimId); waveformAnimId = null; }
}

function handleThereminPosition(handPos) {
  const canvas = document.getElementById('theremin-canvas');
  if (canvas) drawThereminGrid(canvas, handPos.x, handPos.y);

  const gesture = state.currentGesture;
  if (gesture === 'palm') {
    if (!state.theremin.active) startThereminAudio();
  } else if (gesture === 'fist') {
    if (state.theremin.active && thereminGain) {
      thereminGain.volume.value = -60;
    }
    return;
  }

  const freq = mapRange(handPos.x, 0, 1, state.theremin.pitchMin, state.theremin.pitchMax);
  const vol = mapRange(1 - handPos.y, 0, 1, -40, 0);
  state.theremin.freq = freq;

  if (typeof Tone !== 'undefined' && thereminOscillator) {
    thereminOscillator.frequency.rampTo(freq, 0.05);
    if (thereminGain) thereminGain.volume.rampTo(vol, 0.05);
  }

  const freqEl = document.getElementById('freq-val');
  if (freqEl) freqEl.textContent = Math.round(freq);
}

function drawThereminGrid(canvas, hx, hy) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth;
  const h = canvas.height = canvas.offsetHeight;
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(191,0,255,0.15)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  // Hand position
  const px = hx * w, py = hy * h;
  ctx.beginPath();
  ctx.arc(px, py, 16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(191,0,255,0.3)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#BF00FF';
  ctx.shadowColor = '#BF00FF'; ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '11px Poppins, sans-serif';
  ctx.fillText('← Lower Pitch', 8, h - 8);
  ctx.fillText('Higher Pitch →', w - 110, h - 8);
  ctx.fillText('▲ Louder', w - 70, 18);
  ctx.fillText('▼ Quieter', w - 70, h - 20);
}

function animateThereminWaveform() {
  const canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth;
  const h = canvas.height = 60;
  let t = 0;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = '#BF00FF';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x++) {
      const freq = state.theremin.freq / 440;
      const y = h / 2 + Math.sin(x * 0.05 * freq + t) * (h / 3) * (state.theremin.active ? 1 : 0.1);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    t += 0.1;
    waveformAnimId = requestAnimationFrame(draw);
  }
  draw();
}

window.setThereminWaveform = (wf) => {
  state.theremin.waveform = wf;
  if (thereminOscillator) { try { thereminOscillator.type = wf; } catch(e) {} }
};

function mapRange(value, inMin, inMax, outMin, outMax) {
  return Math.max(outMin, Math.min(outMax, (value - inMin) / (inMax - inMin) * (outMax - outMin) + outMin));
}

// ─── MODULE 5: 3D Spatial Functions ───────────────────────────────────────────
let canvas3dEl = null, ctx3d = null, animFrame3d = null;

const CUBE_VERTICES = [
  [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
  [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]
];
const CUBE_EDGES = [
  [0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]
];
const PYRAMID_VERTICES = [[0,1,0],[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]];
const PYRAMID_EDGES = [[0,1],[0,2],[0,3],[0,4],[1,2],[2,3],[3,4],[4,1]];
const OCT_VERTICES = [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
const OCT_EDGES = [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[4,3],[3,5],[5,2]];

function getShapeData() {
  switch(state.cube3d.shape) {
    case 'pyramid':    return { verts: PYRAMID_VERTICES, edges: PYRAMID_EDGES };
    case 'octahedron': return { verts: OCT_VERTICES, edges: OCT_EDGES };
    default:           return { verts: CUBE_VERTICES, edges: CUBE_EDGES };
  }
}

function project3D(v, cx, cy, fov, zoom) {
  const z = v[2] + 3;
  const scale = fov * zoom / (z || 0.001);
  return [cx + v[0] * scale, cy + v[1] * scale];
}

function rotate3D(v, rx, ry) {
  const [x, y, z] = v;
  const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
  const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
  const y2 = y * cosRx - z * sinRx, z2 = y * sinRx + z * cosRx;
  const x3 = x * cosRy + z2 * sinRy, z3 = -x * sinRy + z2 * cosRy;
  return [x3, y2, z3];
}

function draw3DObject() {
  if (!ctx3d || !canvas3dEl) return;
  const w = canvas3dEl.width, h = canvas3dEl.height;
  ctx3d.clearRect(0, 0, w, h);

  const { verts, edges } = getShapeData();
  const cx = w / 2, cy = h / 2;
  const fov = Math.min(w, h) * 0.35;
  const rx = state.cube3d.rotX * Math.PI / 180;
  const ry = state.cube3d.rotY * Math.PI / 180;
  const zoom = state.cube3d.zoom;

  const projected = verts.map(v => project3D(rotate3D(v, rx, ry), cx, cy, fov, zoom));

  edges.forEach(([a, b]) => {
    ctx3d.beginPath();
    ctx3d.moveTo(projected[a][0], projected[a][1]);
    ctx3d.lineTo(projected[b][0], projected[b][1]);
    ctx3d.strokeStyle = `rgba(255, 107, 0, 0.8)`;
    ctx3d.lineWidth = 2;
    ctx3d.shadowColor = '#FF6B00';
    ctx3d.shadowBlur = 8;
    ctx3d.stroke();
    ctx3d.shadowBlur = 0;
  });

  projected.forEach(([px, py]) => {
    ctx3d.beginPath();
    ctx3d.arc(px, py, 4, 0, Math.PI * 2);
    ctx3d.fillStyle = '#FF6B00';
    ctx3d.fill();
  });

  // Update rotation UI
  const rx2 = document.getElementById('rot-x');
  const ry2 = document.getElementById('rot-y');
  const rz2 = document.getElementById('rot-zoom');
  if (rx2) rx2.textContent = Math.round(state.cube3d.rotX) % 360 + '°';
  if (ry2) ry2.textContent = Math.round(state.cube3d.rotY) % 360 + '°';
  if (rz2) rz2.textContent = state.cube3d.zoom.toFixed(1) + 'x';
}

function init3D() {
  canvas3dEl = document.getElementById('canvas3d');
  if (!canvas3dEl) return;
  ctx3d = canvas3dEl.getContext('2d');

  // Mouse drag rotation
  canvas3dEl.addEventListener('mousedown', e => { state.cube3d.dragging = true; state.cube3d.lastX = e.clientX; state.cube3d.lastY = e.clientY; });
  window.addEventListener('mouseup', () => { state.cube3d.dragging = false; });
  canvas3dEl.addEventListener('mousemove', e => {
    if (!state.cube3d.dragging) return;
    const dx = e.clientX - state.cube3d.lastX;
    const dy = e.clientY - state.cube3d.lastY;
    state.cube3d.rotY += dx * 0.5;
    state.cube3d.rotX += dy * 0.5;
    state.cube3d.lastX = e.clientX;
    state.cube3d.lastY = e.clientY;
    draw3DObject();
  });
  canvas3dEl.addEventListener('wheel', e => {
    state.cube3d.zoom = Math.max(0.3, Math.min(3, state.cube3d.zoom - e.deltaY * 0.001));
    draw3DObject();
  });

  draw3DObject();
  animate3D();
  console.log('[3D] Initialized');
}

function animate3D() {
  if (state.currentModule !== 'spatial') return;
  if (state.cube3d.autoRotate) {
    state.cube3d.rotY += 0.5 * state.cube3d.speed;
    state.cube3d.rotX += 0.2 * state.cube3d.speed;
    draw3DObject();
  }
  animFrame3d = requestAnimationFrame(animate3D);
}

function handleSpatialGesture(data) {
  const { gesture, hand_position, pinch_distance } = data;
  if (gesture === 'palm' && hand_position) {
    const dx = (hand_position.x - 0.5) * 2;
    const dy = (hand_position.y - 0.5) * 2;
    state.cube3d.rotY += dx * state.cube3d.speed;
    state.cube3d.rotX += dy * state.cube3d.speed;
    draw3DObject();
  }
  if (gesture === 'pinch' && pinch_distance >= 0) {
    state.cube3d.zoom = mapRange(1 - pinch_distance, 0, 1, 0.4, 2.5);
    draw3DObject();
  }
}

window.resetRotation = () => {
  state.cube3d.rotX = 0; state.cube3d.rotY = 0; state.cube3d.zoom = 1;
  draw3DObject();
  showToast('Rotation reset', '↺');
};

window.toggleAutoRotate = () => {
  state.cube3d.autoRotate = !state.cube3d.autoRotate;
  const btn = document.getElementById('btn-auto-rotate');
  if (btn) btn.textContent = state.cube3d.autoRotate ? '⏸ Stop Rotate' : '▶ Auto-Rotate';
};

// ─── MODULE 6: Voice Functions ────────────────────────────────────────────────
window.toggleVoice = () => {
  if (state.voiceActive) {
    socket.emit('stop_voice');
    state.voiceActive = false;
    const btn = document.getElementById('btn-voice-main');
    if (btn) { btn.textContent = '🎙️ Start Listening'; btn.classList.remove('active'); }
    const ring = document.getElementById('mic-ring');
    if (ring) { ring.classList.remove('listening'); ring.classList.add('inactive'); }
    showToast('Voice recognition stopped', '🔇');
  } else {
    socket.emit('start_voice');
    state.voiceActive = true;
    const btn = document.getElementById('btn-voice-main');
    if (btn) { btn.textContent = '⏹ Stop Listening'; btn.classList.add('active'); }
    const ring = document.getElementById('mic-ring');
    if (ring) { ring.classList.add('listening'); ring.classList.remove('inactive'); }
    showToast('Voice recognition active!', '🎙️');
  }
  updateStatusBar();
};

function updateVoiceUI(data) {
  const box = document.getElementById('transcript-box');
  if (box) box.innerHTML = `<span class="transcript-text">"${data.text}"</span>`;
}

function highlightCommandChip(command) {
  document.querySelectorAll('.command-chip').forEach(chip => {
    chip.classList.remove('triggered');
    if (chip.dataset.cmd === command) {
      chip.classList.add('triggered');
      setTimeout(() => chip.classList.remove('triggered'), 1500);
    }
  });
}

function addCommandLog(command, text) {
  const log = document.getElementById('command-log');
  if (!log) return;
  const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-command">${command}</span><span class="log-time">${now}</span>`;

  // Remove "no commands" placeholder
  if (log.querySelector('.text-dim')) log.innerHTML = '';
  log.insertBefore(entry, log.firstChild);

  // Keep max 10
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ─── Selfie / Screenshot Feature ─────────────────────────────────────────────
function takeSelfie() {
  const flash = document.getElementById('flash-overlay');
  if (flash) { flash.classList.add('flash'); setTimeout(() => flash.classList.remove('flash'), 500); }

  // BUG 1 FIX: capture from the server-streamed video canvas instead of the
  // old (now-removed) <video id="modal-video"> element.
  const combined = document.createElement('canvas');
  combined.width = 640; combined.height = 480;
  const ctx = combined.getContext('2d');

  if (videoCanvas) ctx.drawImage(videoCanvas, 0, 0, 640, 480);
  const skeleton = document.getElementById('skeleton-canvas');
  if (skeleton) ctx.drawImage(skeleton, 0, 0, 640, 480);

  const link = document.createElement('a');
  link.download = `gesture-selfie-${Date.now()}.png`;
  link.href = combined.toDataURL('image/png');
  link.click();
  showToast('Selfie captured!', '📸');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
updateStatusBar();
console.log('[GestureOS] Frontend initialized ✓');
showToast('GestureOS v2.0 loaded', '👋');

/*
 * CSS NOTE (action required):
 * Your stylesheet previously targeted `#modal-video` for the camera
 * background layer (position:absolute, full size, object-fit:cover,
 * z-index below #skeleton-canvas). That selector no longer matches
 * anything since the <video> element was replaced with
 * <canvas id="video-canvas">. Update your CSS rule's selector from
 * `#modal-video` to `#video-canvas` (or add it alongside), keeping the
 * same absolute positioning and a z-index lower than #skeleton-canvas.
 * If you share static/css/*.css I can patch it directly.
 */