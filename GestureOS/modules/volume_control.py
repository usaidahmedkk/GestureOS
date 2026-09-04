"""
GestureOS - Volume Control Module
Uses pycaw on Windows to control system audio volume.
Falls back gracefully on non-Windows systems.
"""

import sys
from utils.helpers import timestamp, clamp

VOLUME_AVAILABLE = False

if sys.platform == "win32":
    try:
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        import math
        VOLUME_AVAILABLE = True
        print(f"[{timestamp()}] pycaw volume control loaded")
    except ImportError as e:
        print(f"[{timestamp()}] WARNING: pycaw not available — {e}")
        print(f"[{timestamp()}] Volume control disabled (Windows only)")
else:
    print(f"[{timestamp()}] WARNING: Volume control only available on Windows (current: {sys.platform})")


class VolumeController:
    """
    System volume control via pycaw (Windows).
    Gracefully degrades on non-Windows platforms.
    """

    def __init__(self):
        self.volume_interface = None
        self._current_volume = 50
        self._is_muted = False
        self._available = False

        if VOLUME_AVAILABLE:
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                self.volume_interface = cast(interface, POINTER(IAudioEndpointVolume))
                self._available = True

                # Read initial volume
                vol_scalar = self.volume_interface.GetMasterVolumeLevelScalar()
                self._current_volume = int(vol_scalar * 100)
                self._is_muted = bool(self.volume_interface.GetMute())
                print(f"[{timestamp()}] VolumeController ready (current: {self._current_volume}%, muted: {self._is_muted})")
            except Exception as e:
                print(f"[{timestamp()}] Error initializing volume control: {e}")
                self._available = False

    def get_volume(self):
        """
        Get current system volume level.
        
        Returns:
            int: Volume level 0-100
        """
        try:
            if self._available and self.volume_interface:
                scalar = self.volume_interface.GetMasterVolumeLevelScalar()
                self._current_volume = int(scalar * 100)
            return self._current_volume
        except Exception as e:
            print(f"[{timestamp()}] Error getting volume: {e}")
            return self._current_volume

    def set_volume(self, level):
        """
        Set system volume to specified level.
        
        Args:
            level (int/float): Volume level 0-100
        
        Returns:
            int: Actual volume level set
        """
        try:
            level = int(clamp(float(level), 0, 100))
            self._current_volume = level

            if self._available and self.volume_interface:
                scalar = level / 100.0
                self.volume_interface.SetMasterVolumeLevelScalar(scalar, None)
                print(f"[{timestamp()}] Volume set to {level}%")
            else:
                print(f"[{timestamp()}] Volume (simulated): {level}%")

            return level
        except Exception as e:
            print(f"[{timestamp()}] Error setting volume: {e}")
            return self._current_volume

    def mute(self):
        """Mute system audio."""
        try:
            self._is_muted = True
            if self._available and self.volume_interface:
                self.volume_interface.SetMute(1, None)
            print(f"[{timestamp()}] System muted")
        except Exception as e:
            print(f"[{timestamp()}] Error muting: {e}")

    def unmute(self):
        """Unmute system audio."""
        try:
            self._is_muted = False
            if self._available and self.volume_interface:
                self.volume_interface.SetMute(0, None)
            print(f"[{timestamp()}] System unmuted")
        except Exception as e:
            print(f"[{timestamp()}] Error unmuting: {e}")

    def toggle_mute(self):
        """
        Toggle system mute state.
        
        Returns:
            bool: New mute state (True = muted)
        """
        try:
            if self._is_muted:
                self.unmute()
            else:
                self.mute()
            return self._is_muted
        except Exception as e:
            print(f"[{timestamp()}] Error toggling mute: {e}")
            return self._is_muted

    def volume_up(self, step=15):
        """Increase volume by step amount."""
        current = self.get_volume()
        return self.set_volume(min(100, current + step))

    def volume_down(self, step=15):
        """Decrease volume by step amount."""
        current = self.get_volume()
        return self.set_volume(max(0, current - step))

    @property
    def is_available(self):
        """Check if volume control is available."""
        return self._available or True  # Always available in simulation mode

    @property
    def is_muted(self):
        """Check if system is currently muted."""
        try:
            if self._available and self.volume_interface:
                self._is_muted = bool(self.volume_interface.GetMute())
        except:
            pass
        return self._is_muted
