"""
GestureOS - Hand Tracker Module
Compatible with MediaPipe 0.10.30+ (Tasks API)

NOTE: No changes needed for either bug fix. get_frame() below already
existed and base64-encodes JPEG frames from the capture loop — it just
wasn't being called anywhere before. app.py's camera_broadcast_loop()
now calls it every iteration and emits the result as a 'video_frame'
SocketIO event, which the frontend draws onto #video-canvas (Bug 1 fix).
"""

import cv2
import numpy as np
import base64
import threading
import time
import os
import urllib.request
from utils.helpers import calculate_distance, timestamp

MEDIAPIPE_AVAILABLE = False
mp = None

try:
    import mediapipe as mp_module
    mp = mp_module
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions
    MEDIAPIPE_AVAILABLE = True
    print(f"[{timestamp()}] MediaPipe Tasks API loaded (v{mp_module.__version__})")
except Exception as e:
    print(f"[{timestamp()}] WARNING: MediaPipe not available — {e}")

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hand_landmarker.task')


def ensure_model():
    """Download hand landmarker model if not present."""
    if os.path.exists(MODEL_PATH):
        return True
    try:
        url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
        print(f"[{timestamp()}] Downloading hand landmarker model (~25MB)...")
        urllib.request.urlretrieve(url, MODEL_PATH)
        print(f"[{timestamp()}] Model downloaded!")
        return True
    except Exception as e:
        print(f"[{timestamp()}] Model download failed: {e}")
        return False


class HandTracker:
    def __init__(self):
        self.cap = None
        self.running = False
        self.lock = threading.Lock()
        self.current_frame = None
        self.detection_result = None
        self.frame_thread = None
        self.landmarker = None

        self.camera_index = int(os.getenv("CAMERA_INDEX", 0))
        self.width = int(os.getenv("CAMERA_WIDTH", 640))
        self.height = int(os.getenv("CAMERA_HEIGHT", 480))
        self.fps = int(os.getenv("CAMERA_FPS", 30))
        self.max_hands = int(os.getenv("MAX_HANDS", 1))
        self.min_detection_conf = float(os.getenv("MIN_DETECTION_CONFIDENCE", 0.7))
        self.min_tracking_conf = float(os.getenv("MIN_TRACKING_CONFIDENCE", 0.5))

        self.last_gesture = "none"
        self.gesture_confidence = 0.0

        if MEDIAPIPE_AVAILABLE:
            self._init_landmarker()

    def _init_landmarker(self):
        try:
            if not ensure_model():
                return
            options = HandLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
                running_mode=mp_vision.RunningMode.VIDEO,
                num_hands=self.max_hands,
                min_hand_detection_confidence=self.min_detection_conf,
                min_hand_presence_confidence=self.min_detection_conf,
                min_tracking_confidence=self.min_tracking_conf,
            )
            self.landmarker = HandLandmarker.create_from_options(options)
            print(f"[{timestamp()}] HandLandmarker ready")
        except Exception as e:
            print(f"[{timestamp()}] Landmarker init error: {e}")
            self.landmarker = None

    def start(self):
        try:
            self.cap = cv2.VideoCapture(self.camera_index)
            if not self.cap.isOpened():
                print(f"[{timestamp()}] ERROR: Cannot open camera {self.camera_index}")
                return False
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            self.cap.set(cv2.CAP_PROP_FPS, self.fps)
            self.running = True
            self.frame_thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.frame_thread.start()
            print(f"[{timestamp()}] Camera started")
            return True
        except Exception as e:
            print(f"[{timestamp()}] Camera start error: {e}")
            return False

    def stop(self):
        try:
            self.running = False
            if self.frame_thread:
                self.frame_thread.join(timeout=2.0)
            if self.cap:
                self.cap.release()
                self.cap = None
            print(f"[{timestamp()}] Camera stopped")
        except Exception as e:
            print(f"[{timestamp()}] Camera stop error: {e}")

    def _capture_loop(self):
        while self.running:
            try:
                if not self.cap or not self.cap.isOpened():
                    break
                ret, frame = self.cap.read()
                if not ret:
                    time.sleep(0.01)
                    continue

                frame = cv2.flip(frame, 1)
                result = None

                if self.landmarker:
                    try:
                        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                        ts_ms = int(time.time() * 1000)
                        result = self.landmarker.detect_for_video(mp_image, ts_ms)
                    except Exception as e:
                        pass

                with self.lock:
                    self.current_frame = frame.copy()
                    self.detection_result = result

                time.sleep(1.0 / self.fps)
            except Exception as e:
                print(f"[{timestamp()}] Capture error: {e}")
                time.sleep(0.1)

    def get_frame(self):
        try:
            with self.lock:
                if self.current_frame is None:
                    return None
                frame = self.current_frame.copy()
            _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return base64.b64encode(buf).decode('utf-8')
        except Exception as e:
            return None

    def get_landmarks(self):
        try:
            with self.lock:
                result = self.detection_result
            if not result or not result.hand_landmarks:
                return []
            hands = []
            for i, hand_lms in enumerate(result.hand_landmarks):
                handedness = "Right"
                if result.handedness and i < len(result.handedness):
                    handedness = result.handedness[i][0].category_name
                landmarks = [{"x": float(lm.x), "y": float(lm.y), "z": float(lm.z),
                              "px": int(lm.x * self.width), "py": int(lm.y * self.height)}
                             for lm in hand_lms]
                hands.append({"landmarks": landmarks, "handedness": handedness})
            return hands
        except Exception as e:
            print(f"[{timestamp()}] Landmarks error: {e}")
            return []

    def detect_gesture(self):
        try:
            with self.lock:
                result = self.detection_result
            if not result or not result.hand_landmarks:
                self.last_gesture = "none"
                self.gesture_confidence = 0.0
                return "none"

            lm = result.hand_landmarks[0]
            index_up  = lm[8].y  < lm[6].y
            middle_up = lm[12].y < lm[10].y
            ring_up   = lm[16].y < lm[14].y
            pinky_up  = lm[20].y < lm[18].y
            thumb_out = abs(lm[4].x - lm[2].x) > 0.04
            fingers_up = sum([index_up, middle_up, ring_up, pinky_up])

            pinch_dist = self.get_pinch_distance()
            if 0 <= pinch_dist < 0.08:
                self.last_gesture = "pinch"
                self.gesture_confidence = 1.0 - (pinch_dist / 0.08)
                return "pinch"
            if fingers_up == 0 and not thumb_out:
                self.last_gesture = "fist"
                self.gesture_confidence = 0.9
                return "fist"
            if index_up and not middle_up and not ring_up and not pinky_up:
                self.last_gesture = "point"
                self.gesture_confidence = 0.85
                return "point"
            if index_up and middle_up and not ring_up and not pinky_up:
                self.last_gesture = "peace"
                self.gesture_confidence = 0.85
                return "peace"
            if fingers_up >= 3:
                self.last_gesture = "palm"
                self.gesture_confidence = min(1.0, fingers_up / 4.0)
                return "palm"

            self.last_gesture = "none"
            self.gesture_confidence = 0.0
            return "none"
        except Exception as e:
            return "none"

    def get_pinch_distance(self):
        try:
            with self.lock:
                result = self.detection_result
            if not result or not result.hand_landmarks:
                return -1.0
            lm = result.hand_landmarks[0]
            return min(1.0, calculate_distance((lm[4].x, lm[4].y), (lm[8].x, lm[8].y)))
        except:
            return -1.0

    def get_hand_position(self):
        try:
            with self.lock:
                result = self.detection_result
            if not result or not result.hand_landmarks:
                return (0.5, 0.5)
            lm = result.hand_landmarks[0]
            return (float(lm[0].x), float(lm[0].y))
        except:
            return (0.5, 0.5)

    def get_index_finger_tip(self):
        try:
            with self.lock:
                result = self.detection_result
            if not result or not result.hand_landmarks:
                return None
            lm = result.hand_landmarks[0]
            return (float(lm[8].x), float(lm[8].y))
        except:
            return None

    def is_finger_up(self, finger_index):
        try:
            with self.lock:
                result = self.detection_result
            if not result or not result.hand_landmarks:
                return False
            lm = result.hand_landmarks[0]
            tips = [4, 8, 12, 16, 20]
            pips = [3, 6, 10, 14, 18]
            if finger_index == 0:
                return abs(lm[4].x - lm[2].x) > 0.04
            return lm[tips[finger_index]].y < lm[pips[finger_index]].y
        except:
            return False

    @property
    def is_running(self):
        return self.running and self.cap is not None and self.cap.isOpened()