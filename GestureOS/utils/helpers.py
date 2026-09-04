"""
GestureOS - Helper Utilities
Common utility functions used across modules.
"""

import math
import time
from datetime import datetime


def normalize_landmark(x, y, w, h):
    """
    Convert pixel coordinates to normalized 0-1 range.
    
    Args:
        x (float): X pixel coordinate
        y (float): Y pixel coordinate
        w (int): Frame width
        h (int): Frame height
    
    Returns:
        tuple: (norm_x, norm_y) in range [0, 1]
    """
    try:
        norm_x = max(0.0, min(1.0, x / w))
        norm_y = max(0.0, min(1.0, y / h))
        return norm_x, norm_y
    except Exception as e:
        print(f"[{timestamp()}] Error normalizing landmark: {e}")
        return 0.0, 0.0


def landmarks_to_dict(results, frame_width=640, frame_height=480):
    """
    Convert MediaPipe hand detection results to a JSON-serializable dict.
    
    Args:
        results: MediaPipe Hands results object
        frame_width (int): Width of the video frame
        frame_height (int): Height of the video frame
    
    Returns:
        list: List of hand dicts with landmarks and handedness
    """
    try:
        hands = []
        if not results or not results.multi_hand_landmarks:
            return hands

        for i, hand_landmarks in enumerate(results.multi_hand_landmarks):
            handedness = "Right"
            if results.multi_handedness and i < len(results.multi_handedness):
                handedness = results.multi_handedness[i].classification[0].label

            landmarks = []
            for lm in hand_landmarks.landmark:
                x = lm.x * frame_width
                y = lm.y * frame_height
                norm_x, norm_y = normalize_landmark(x, y, frame_width, frame_height)
                landmarks.append({
                    "x": norm_x,
                    "y": norm_y,
                    "z": lm.z,
                    "px": int(x),
                    "py": int(y)
                })

            hands.append({
                "landmarks": landmarks,
                "handedness": handedness
            })

        return hands
    except Exception as e:
        print(f"[{timestamp()}] Error converting landmarks to dict: {e}")
        return []


def map_range(value, in_min, in_max, out_min, out_max):
    """
    Map a value from one range to another.
    
    Args:
        value (float): Input value
        in_min (float): Input range minimum
        in_max (float): Input range maximum
        out_min (float): Output range minimum
        out_max (float): Output range maximum
    
    Returns:
        float: Mapped value clamped to output range
    """
    try:
        if in_max == in_min:
            return out_min
        mapped = (value - in_min) / (in_max - in_min) * (out_max - out_min) + out_min
        return max(out_min, min(out_max, mapped))
    except Exception as e:
        print(f"[{timestamp()}] Error mapping range: {e}")
        return out_min


def calculate_distance(point1, point2):
    """
    Calculate Euclidean distance between two points.
    
    Args:
        point1 (tuple/dict): First point (x, y) or {'x': x, 'y': y}
        point2 (tuple/dict): Second point (x, y) or {'x': x, 'y': y}
    
    Returns:
        float: Euclidean distance
    """
    try:
        if isinstance(point1, dict):
            x1, y1 = point1.get('x', 0), point1.get('y', 0)
        else:
            x1, y1 = point1[0], point1[1]

        if isinstance(point2, dict):
            x2, y2 = point2.get('x', 0), point2.get('y', 0)
        else:
            x2, y2 = point2[0], point2[1]

        return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
    except Exception as e:
        print(f"[{timestamp()}] Error calculating distance: {e}")
        return 0.0


def timestamp():
    """Return formatted timestamp string."""
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def clamp(value, min_val, max_val):
    """Clamp value between min and max."""
    return max(min_val, min(max_val, value))


def smooth_value(current, target, factor=0.2):
    """
    Smoothly interpolate towards a target value.
    
    Args:
        current (float): Current value
        target (float): Target value
        factor (float): Smoothing factor (0=no change, 1=instant)
    
    Returns:
        float: Smoothed value
    """
    return current + (target - current) * factor
