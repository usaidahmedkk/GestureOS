"""
GestureOS - Main Application Server
Flask + SocketIO backend for AI Hand Gesture Control System.
"""

import os
import time
import threading
import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from utils.helpers import timestamp
from modules.hand_tracker import HandTracker
from modules.voice_control import VoiceController
from modules.volume_control import VolumeController
from modules.brightness import BrightnessController

# ─── Flask App Setup ─────────────────────────────────────────────────────────
app = Flask(__name__)
app.config['SECRET_KEY'] = 'gesture_os_secret_2024'
CORS(app, resources={r"/*": {"origins": "*"}})

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='eventlet',
    logger=False,
    engineio_logger=False
)

# ─── Module Instances ─────────────────────────────────────────────────────────
hand_tracker = HandTracker()
voice_controller = VoiceController()
volume_controller = VolumeController()
brightness_controller = BrightnessController()

# ─── State ────────────────────────────────────────────────────────────────────
camera_running = False
camera_thread = None
connected_clients = set()
camera_lock = threading.Lock()

# BUG 2 FIX: track which module the frontend currently has open.
# _handle_gesture_controls() checks this before touching volume/brightness,
# so pinch gestures in Piano / Drawing / Theremin / etc. no longer leak
# into brightness control. Only the 'volume' module (Volume & Brightness)
# is allowed to trigger it.
active_module = None

# ─── Camera Broadcast Loop ────────────────────────────────────────────────────
def camera_broadcast_loop():
    """
    Background thread: continuously capture frames, stream video, and emit
    hand data to all clients. Targets ~30 FPS.
    """
    global camera_running
    fps_target = int(os.getenv("CAMERA_FPS", 30))
    frame_delay = 1.0 / fps_target
    frame_count = 0

    print(f"[{timestamp()}] Camera broadcast loop started")

    while camera_running:
        try:
            if not connected_clients:
                eventlet.sleep(0.1)
                continue

            # ─── BUG 1 FIX ────────────────────────────────────────────────
            # Stream the actual JPEG video frame to the browser. Previously
            # only landmark data was emitted, and the frontend tried to grab
            # its own webcam feed via getUserMedia() — which silently failed
            # because OpenCV already held the camera exclusively on the
            # backend (Windows can't share the device between two clients).
            # get_frame() already existed in hand_tracker.py, it just was
            # never called anywhere. Now it is.
            frame_b64 = hand_tracker.get_frame()
            if frame_b64:
                socketio.emit('video_frame', {'frame': frame_b64})
            # ──────────────────────────────────────────────────────────────

            # Get landmarks
            landmarks_data = hand_tracker.get_landmarks()
            gesture = hand_tracker.detect_gesture()
            pinch_dist = hand_tracker.get_pinch_distance()
            hand_pos = hand_tracker.get_hand_position()
            index_tip = hand_tracker.get_index_finger_tip()

            # Emit hand landmarks to all clients
            if landmarks_data:
                socketio.emit('hand_landmarks', {
                    'hands': landmarks_data,
                    'gesture': gesture,
                    'gesture_confidence': hand_tracker.gesture_confidence,
                    'pinch_distance': pinch_dist,
                    'hand_position': {'x': hand_pos[0], 'y': hand_pos[1]},
                    'index_tip': {'x': index_tip[0], 'y': index_tip[1]} if index_tip else None,
                    'timestamp': time.time()
                })

                # Handle gesture-based volume/brightness control
                # (now scoped to the active module — see _handle_gesture_controls)
                _handle_gesture_controls(gesture, pinch_dist, landmarks_data)

            else:
                # No hand detected
                socketio.emit('hand_landmarks', {
                    'hands': [],
                    'gesture': 'none',
                    'gesture_confidence': 0.0,
                    'pinch_distance': -1.0,
                    'hand_position': None,
                    'index_tip': None,
                    'timestamp': time.time()
                })

            frame_count += 1
            if frame_count % 90 == 0:
                print(f"[{timestamp()}] Camera loop: {frame_count} frames emitted")

            eventlet.sleep(frame_delay)

        except Exception as e:
            print(f"[{timestamp()}] Error in camera loop: {e}")
            eventlet.sleep(0.1)

    print(f"[{timestamp()}] Camera broadcast loop stopped")


def _handle_gesture_controls(gesture, pinch_dist, hands_data):
    """
    Handle automatic gesture-based volume/brightness control.

    BUG 2 FIX: this used to run unconditionally for every client on every
    frame, regardless of which module the frontend had open — so a pinch
    gesture in Piano, Air Drawing, Theremin, etc. would silently change
    system brightness/volume in the background. It is now gated on
    `active_module`, which the frontend updates via the 'set_active_module'
    socket event whenever a module modal opens or closes.
    """
    global active_module

    if active_module != 'volume':
        return

    try:
        if not hands_data:
            return

        hand = hands_data[0]
        handedness = hand.get('handedness', 'Right')

        if gesture == 'pinch' and pinch_dist >= 0:
            # Map pinch distance to 0-100
            from utils.helpers import map_range
            level = int(map_range(pinch_dist, 0.02, 0.25, 0, 100))

            if handedness == 'Right':
                new_vol = volume_controller.set_volume(level)
                socketio.emit('volume_changed', {'level': new_vol})
            else:
                new_brightness = brightness_controller.set_brightness(level)
                socketio.emit('brightness_changed', {'level': new_brightness})

    except Exception as e:
        print(f"[{timestamp()}] Error handling gesture controls: {e}")


# ─── Voice Command Callback ────────────────────────────────────────────────────
def on_voice_command(command, text):
    """Callback executed when a voice command is recognized."""
    try:
        print(f"[{timestamp()}] Voice command received: '{command}' (text: '{text}')")
        result = None

        if command == "volume up":
            new_vol = volume_controller.volume_up(15)
            result = f"Volume: {new_vol}%"
            socketio.emit('volume_changed', {'level': new_vol})

        elif command == "volume down":
            new_vol = volume_controller.volume_down(15)
            result = f"Volume: {new_vol}%"
            socketio.emit('volume_changed', {'level': new_vol})

        elif command == "mute":
            volume_controller.mute()
            result = "Muted"
            socketio.emit('volume_changed', {'level': 0, 'muted': True})

        elif command == "unmute":
            volume_controller.unmute()
            result = "Unmuted"
            socketio.emit('volume_changed', {'level': volume_controller.get_volume(), 'muted': False})

        elif command == "brightness up":
            new_b = brightness_controller.brightness_up(15)
            result = f"Brightness: {new_b}%"
            socketio.emit('brightness_changed', {'level': new_b})

        elif command == "brightness down":
            new_b = brightness_controller.brightness_down(15)
            result = f"Brightness: {new_b}%"
            socketio.emit('brightness_changed', {'level': new_b})

        elif command == "clear":
            result = "Canvas cleared"
            socketio.emit('voice_action', {'action': 'clear_canvas'})

        elif command == "selfie":
            result = "Taking selfie..."
            socketio.emit('voice_action', {'action': 'selfie'})

        # Emit voice result to all clients
        socketio.emit('voice_result', {
            'command': command,
            'text': text,
            'result': result or command,
            'timestamp': time.time()
        })

    except Exception as e:
        print(f"[{timestamp()}] Error handling voice command: {e}")


# Register voice callback
voice_controller.on_command(on_voice_command)


# ─── HTTP Routes ──────────────────────────────────────────────────────────────
@app.route('/')
def index():
    """Serve the main GestureOS interface."""
    return render_template('index.html')


@app.route('/health')
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'camera': hand_tracker.is_running,
        'voice': voice_controller.is_listening,
        'volume_available': volume_controller.is_available,
        'brightness_available': brightness_controller.is_available,
        'clients': len(connected_clients),
        'active_module': active_module,
        'timestamp': time.time()
    })


# ─── SocketIO Event Handlers ──────────────────────────────────────────────────
@socketio.on('connect')
def handle_connect():
    """Handle new client connection."""
    from flask import request
    client_id = request.sid
    connected_clients.add(client_id)
    print(f"[{timestamp()}] Client connected: {client_id} (total: {len(connected_clients)})")

    # Send initial status
    emit('system_status', {
        'camera': hand_tracker.is_running,
        'voice': voice_controller.is_listening,
        'volume': volume_controller.get_volume(),
        'brightness': brightness_controller.get_brightness(),
        'volume_available': volume_controller.is_available,
        'brightness_available': brightness_controller.is_available,
        'voice_available': voice_controller.is_available
    })


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    from flask import request
    client_id = request.sid
    connected_clients.discard(client_id)
    print(f"[{timestamp()}] Client disconnected: {client_id} (total: {len(connected_clients)})")

    # Stop camera if no clients remain
    if not connected_clients:
        global camera_running, active_module
        if camera_running:
            print(f"[{timestamp()}] No clients — stopping camera")
            camera_running = False
            hand_tracker.stop()
        active_module = None


@socketio.on('start_camera')
def handle_start_camera():
    """Start the camera and hand tracking."""
    global camera_running, camera_thread

    with camera_lock:
        if camera_running:
            emit('camera_status', {'active': True, 'message': 'Already running'})
            return

        try:
            success = hand_tracker.start()
            if success:
                camera_running = True
                camera_thread = eventlet.spawn(camera_broadcast_loop)
                emit('camera_status', {'active': True, 'message': 'Camera started'})
                socketio.emit('camera_status', {'active': True})
                print(f"[{timestamp()}] Camera started for client")
            else:
                emit('camera_status', {'active': False, 'message': 'Failed to open camera'})
                emit('error', {'message': 'Could not open camera. Check camera connection.'})
        except Exception as e:
            print(f"[{timestamp()}] Error starting camera: {e}")
            emit('error', {'message': f'Camera error: {str(e)}'})


@socketio.on('stop_camera')
def handle_stop_camera():
    """Stop the camera and hand tracking."""
    global camera_running

    try:
        camera_running = False
        hand_tracker.stop()
        emit('camera_status', {'active': False, 'message': 'Camera stopped'})
        socketio.emit('camera_status', {'active': False})
        print(f"[{timestamp()}] Camera stopped by client")
    except Exception as e:
        print(f"[{timestamp()}] Error stopping camera: {e}")
        emit('error', {'message': f'Error stopping camera: {str(e)}'})


@socketio.on('set_active_module')
def handle_set_active_module(data):
    """
    BUG 2 FIX: Track which module the client currently has open, e.g.
    'volume', 'piano', 'drawing', 'theremin', 'spatial', 'voice', or None
    when no modal is open. _handle_gesture_controls() uses this to make
    sure brightness/volume gestures only ever fire while the user is
    actually inside the Volume & Brightness module.
    """
    global active_module
    module = data.get('module') if data else None
    active_module = module
    print(f"[{timestamp()}] Active module set to: {active_module}")


@socketio.on('start_voice')
def handle_start_voice():
    """Start voice recognition."""
    try:
        if not voice_controller.is_available:
            emit('error', {'message': 'Voice control not available. Install pyaudio and SpeechRecognition.'})
            return

        success = voice_controller.start_listening()
        if success:
            emit('voice_status', {'active': True, 'message': 'Listening...'})
            socketio.emit('voice_status', {'active': True})
        else:
            emit('error', {'message': 'Failed to start voice recognition. Check microphone.'})
    except Exception as e:
        print(f"[{timestamp()}] Error starting voice: {e}")
        emit('error', {'message': f'Voice error: {str(e)}'})


@socketio.on('stop_voice')
def handle_stop_voice():
    """Stop voice recognition."""
    try:
        voice_controller.stop_listening()
        emit('voice_status', {'active': False, 'message': 'Stopped'})
        socketio.emit('voice_status', {'active': False})
    except Exception as e:
        print(f"[{timestamp()}] Error stopping voice: {e}")
        emit('error', {'message': f'Error stopping voice: {str(e)}'})


@socketio.on('set_volume')
def handle_set_volume(data):
    """Set system volume from client request."""
    try:
        level = data.get('level', 50)
        new_vol = volume_controller.set_volume(level)
        socketio.emit('volume_changed', {'level': new_vol})
        print(f"[{timestamp()}] Volume set to {new_vol}% via client")
    except Exception as e:
        print(f"[{timestamp()}] Error setting volume: {e}")
        emit('error', {'message': f'Volume error: {str(e)}'})


@socketio.on('set_brightness')
def handle_set_brightness(data):
    """Set screen brightness from client request."""
    try:
        level = data.get('level', 70)
        new_brightness = brightness_controller.set_brightness(level)
        socketio.emit('brightness_changed', {'level': new_brightness})
        print(f"[{timestamp()}] Brightness set to {new_brightness}% via client")
    except Exception as e:
        print(f"[{timestamp()}] Error setting brightness: {e}")
        emit('error', {'message': f'Brightness error: {str(e)}'})


@socketio.on('toggle_mute')
def handle_toggle_mute():
    """Toggle system mute state."""
    try:
        muted = volume_controller.toggle_mute()
        vol = volume_controller.get_volume()
        socketio.emit('volume_changed', {'level': vol, 'muted': muted})
    except Exception as e:
        emit('error', {'message': f'Mute error: {str(e)}'})


@socketio.on('get_status')
def handle_get_status():
    """Return current system status."""
    emit('system_status', {
        'camera': hand_tracker.is_running,
        'voice': voice_controller.is_listening,
        'volume': volume_controller.get_volume(),
        'brightness': brightness_controller.get_brightness(),
        'muted': volume_controller.is_muted,
        'volume_available': volume_controller.is_available,
        'brightness_available': brightness_controller.is_available,
        'voice_available': voice_controller.is_available,
        'timestamp': time.time()
    })


# ─── Main Entry Point ─────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'

    print(f"""
╔══════════════════════════════════════════╗
║       GestureOS v2.0 — Starting Up       ║
╠══════════════════════════════════════════╣
║  Server:  http://localhost:{port}           ║
║  Debug:   {str(debug):<34}║
║  Camera:  Index {os.getenv('CAMERA_INDEX', '0'):<28}║
╚══════════════════════════════════════════╝
    """)

    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        debug=debug,
        use_reloader=False
    )