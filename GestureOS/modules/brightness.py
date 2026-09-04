"""
GestureOS - Brightness Control Module
Uses screen-brightness-control to manage display brightness.

NOTE: No changes needed for either bug fix. This module already only
does exactly what it's told (get_brightness/set_brightness); the leak
in Bug 2 was in *when* app.py called set_brightness(), not in this
file. Included here unchanged for completeness.
"""

from utils.helpers import timestamp, clamp

BRIGHTNESS_AVAILABLE = False
try:
    import screen_brightness_control as sbc
    BRIGHTNESS_AVAILABLE = True
    print(f"[{timestamp()}] screen-brightness-control loaded")
except ImportError as e:
    print(f"[{timestamp()}] WARNING: screen-brightness-control not available — {e}")
    print(f"[{timestamp()}] Brightness control disabled")


class BrightnessController:
    """
    Screen brightness controller using screen-brightness-control library.
    Falls back to simulated mode if library is unavailable.
    """

    def __init__(self):
        self._current_brightness = 70
        self._available = False

        if BRIGHTNESS_AVAILABLE:
            try:
                current = sbc.get_brightness()
                if isinstance(current, list):
                    self._current_brightness = current[0]
                else:
                    self._current_brightness = current
                self._available = True
                print(f"[{timestamp()}] BrightnessController ready (current: {self._current_brightness}%)")
            except Exception as e:
                print(f"[{timestamp()}] Error reading brightness: {e}")

    def get_brightness(self):
        """
        Get current screen brightness level.

        Returns:
            int: Brightness level 0-100
        """
        try:
            if self._available:
                val = sbc.get_brightness()
                if isinstance(val, list):
                    self._current_brightness = val[0]
                else:
                    self._current_brightness = val
            return int(self._current_brightness)
        except Exception as e:
            print(f"[{timestamp()}] Error getting brightness: {e}")
            return int(self._current_brightness)

    def set_brightness(self, level):
        """
        Set screen brightness to specified level.

        Args:
            level (int/float): Brightness level 0-100

        Returns:
            int: Actual brightness level set
        """
        try:
            level = int(clamp(float(level), 0, 100))
            self._current_brightness = level

            if self._available:
                sbc.set_brightness(level)
                print(f"[{timestamp()}] Brightness set to {level}%")
            else:
                print(f"[{timestamp()}] Brightness (simulated): {level}%")

            return level
        except Exception as e:
            print(f"[{timestamp()}] Error setting brightness: {e}")
            return int(self._current_brightness)

    def brightness_up(self, step=15):
        """Increase brightness by step amount."""
        current = self.get_brightness()
        return self.set_brightness(min(100, current + step))

    def brightness_down(self, step=15):
        """Decrease brightness by step amount."""
        current = self.get_brightness()
        return self.set_brightness(max(0, current - step))

    @property
    def is_available(self):
        """Check if brightness control is available."""
        return self._available or True  # Always available in simulation modes