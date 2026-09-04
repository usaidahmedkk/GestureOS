# GestureOS — AI Hand Gesture Control System 🖐

A full-stack web application that lets you control your computer using hand gestures and voice commands, powered by MediaPipe, OpenCV, Flask, and Tone.js.

---

## 🚀 Quick Start

### Step 1: Install dependencies
```bash
pip install -r requirements.txt
```

### Step 2: Run the server
```bash
python app.py
```

### Step 3: Open in browser
```
http://localhost:5000
```

### Step 4: Allow permissions
- Click **Allow** for camera access
- Click **Allow** for microphone access (Voice Control module)

### Step 5: Launch a module
- Click any module card to open it
- Your camera feed will start automatically

---

## 🎮 Modules

| Module | Gesture | Action |
|--------|---------|--------|
| **Air Drawing** | 1 finger | Draw on canvas |
| **Air Drawing** | 2 fingers | Pause drawing |
| **Air Drawing** | Fist | Stop drawing |
| **Volume** | Right hand pinch | Adjust volume |
| **Brightness** | Left hand pinch | Adjust brightness |
| **Theremin** | Open palm + move | Play music |
| **Theremin** | Fist | Mute sound |
| **3D Spatial** | Open palm + move | Rotate object |
| **3D Spatial** | Pinch | Zoom in/out |

## 🎙️ Voice Commands

| Command | Action |
|---------|--------|
| "volume up" | +15% volume |
| "volume down" | -15% volume |
| "mute" | Toggle mute |
| "brightness up" | +15% brightness |
| "brightness down" | -15% brightness |
| "clear" | Clear drawing canvas |
| "selfie" / "capture" | Take screenshot |

---

## 🛠 Tech Stack

- **Backend**: Python, Flask, Flask-SocketIO, EventLet
- **Computer Vision**: OpenCV, MediaPipe
- **Voice Recognition**: SpeechRecognition, PyAudio
- **System Control**: pycaw (Windows volume), screen-brightness-control
- **Frontend**: Vanilla JS, Socket.IO, Tone.js
- **Fonts**: Orbitron, Poppins

---

## ⚙️ Configuration (.env)

```
CAMERA_INDEX=0          # Camera device index
CAMERA_WIDTH=640        # Frame width
CAMERA_HEIGHT=480       # Frame height
CAMERA_FPS=30           # Target frame rate
MIN_DETECTION_CONFIDENCE=0.7
MIN_TRACKING_CONFIDENCE=0.5
MAX_HANDS=1             # Max hands to track
FLASK_PORT=5000
```

---

## 📋 Requirements

- Python 3.8+
- Windows (for pycaw volume control; other features work cross-platform)
- Webcam
- Microphone (for voice control)

---

## 👥 Team

- **Usaid Ahmed** — Lead Developer
- **Ayma Nadeem** — UI/UX Designer  
- **Aliza Waseem** — AI Integration

---

## 🐛 Troubleshooting

**Camera not found**: Check `CAMERA_INDEX` in `.env` (try 0, 1, 2...)

**PyAudio error on install**: 
- Windows: `pip install pipwin && pipwin install pyaudio`
- Mac: `brew install portaudio && pip install pyaudio`
- Linux: `sudo apt-get install portaudio19-dev && pip install pyaudio`

**pycaw not working**: Only on Windows. Volume shows as simulated on other platforms.

**MediaPipe error**: `pip install mediapipe --upgrade`
