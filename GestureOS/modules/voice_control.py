"""
GestureOS - Voice Control Module
Uses SpeechRecognition to listen for voice commands and execute them.
"""

import threading
import time
from utils.helpers import timestamp

VOICE_AVAILABLE = False
try:
    import speech_recognition as sr
    VOICE_AVAILABLE = True
    print(f"[{timestamp()}] SpeechRecognition loaded successfully")
except ImportError:
    print(f"[{timestamp()}] WARNING: SpeechRecognition not available — voice module disabled")


class VoiceController:
    """
    Voice command recognition using Google Speech Recognition API.
    Runs in a background thread and calls callbacks on command detection.
    """

    SUPPORTED_COMMANDS = [
        "volume up", "volume down", "mute", "unmute",
        "brightness up", "brightness down",
        "clear", "selfie", "capture",
        "stop", "help"
    ]

    def __init__(self):
        self.running = False
        self.listening = False
        self.recognizer = None
        self.microphone = None
        self.listen_thread = None
        self.last_command = ""
        self.last_text = ""
        self.command_callbacks = []
        self.lock = threading.Lock()

        if VOICE_AVAILABLE:
            try:
                self.recognizer = sr.Recognizer()
                self.recognizer.energy_threshold = 4000
                self.recognizer.dynamic_energy_threshold = True
                self.recognizer.pause_threshold = 0.8
                self.microphone = sr.Microphone()
                print(f"[{timestamp()}] VoiceController initialized")
            except Exception as e:
                print(f"[{timestamp()}] Error initializing microphone: {e}")
                self.recognizer = None
                self.microphone = None

    def start_listening(self):
        """Start background microphone listening thread."""
        if not VOICE_AVAILABLE or self.recognizer is None:
            print(f"[{timestamp()}] Voice not available — cannot start listening")
            return False

        if self.listening:
            print(f"[{timestamp()}] Already listening")
            return True

        try:
            self.running = True
            self.listening = True
            self.listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
            self.listen_thread.start()
            print(f"[{timestamp()}] Voice listening started")
            return True
        except Exception as e:
            print(f"[{timestamp()}] Error starting voice listener: {e}")
            self.listening = False
            return False

    def stop_listening(self):
        """Stop background microphone listening."""
        try:
            self.running = False
            self.listening = False
            if self.listen_thread:
                self.listen_thread.join(timeout=3.0)
            print(f"[{timestamp()}] Voice listening stopped")
        except Exception as e:
            print(f"[{timestamp()}] Error stopping voice listener: {e}")

    def _listen_loop(self):
        """Background thread: continuously listen for voice commands."""
        if not self.microphone or not self.recognizer:
            return

        # Calibrate for ambient noise once
        try:
            with self.microphone as source:
                print(f"[{timestamp()}] Calibrating for ambient noise...")
                self.recognizer.adjust_for_ambient_noise(source, duration=1.0)
                print(f"[{timestamp()}] Calibration complete, energy threshold: {self.recognizer.energy_threshold}")
        except Exception as e:
            print(f"[{timestamp()}] Calibration error: {e}")

        while self.running:
            try:
                with self.microphone as source:
                    audio = self.recognizer.listen(source, timeout=3.0, phrase_time_limit=5.0)

                # Recognize speech
                text = self.recognizer.recognize_google(audio).lower().strip()
                print(f"[{timestamp()}] Recognized: '{text}'")

                with self.lock:
                    self.last_text = text
                    command = self._parse_command(text)
                    self.last_command = command

                # Trigger callbacks
                for callback in self.command_callbacks:
                    try:
                        callback(command, text)
                    except Exception as e:
                        print(f"[{timestamp()}] Callback error: {e}")

            except sr.WaitTimeoutError:
                # No speech detected — continue loop
                pass
            except sr.UnknownValueError:
                print(f"[{timestamp()}] Could not understand audio")
            except sr.RequestError as e:
                print(f"[{timestamp()}] Speech recognition API error: {e}")
                time.sleep(2.0)
            except Exception as e:
                print(f"[{timestamp()}] Error in listen loop: {e}")
                time.sleep(0.5)

    def _parse_command(self, text):
        """
        Match recognized text to a supported command.
        
        Args:
            text (str): Recognized speech text
        
        Returns:
            str: Matched command or original text
        """
        text_lower = text.lower()

        command_map = {
            "volume up": "volume up",
            "volume down": "volume down",
            "volume lower": "volume down",
            "turn up": "volume up",
            "turn down": "volume down",
            "mute": "mute",
            "unmute": "unmute",
            "silence": "mute",
            "brightness up": "brightness up",
            "brightness down": "brightness down",
            "brighter": "brightness up",
            "darker": "brightness down",
            "clear": "clear",
            "erase": "clear",
            "selfie": "selfie",
            "capture": "selfie",
            "screenshot": "selfie",
            "photo": "selfie",
            "stop": "stop",
            "help": "help",
        }

        for phrase, command in command_map.items():
            if phrase in text_lower:
                print(f"[{timestamp()}] Command matched: '{phrase}' → '{command}'")
                return command

        return text  # Return original text if no command matched

    def get_last_command(self):
        """
        Get the most recently recognized command.
        
        Returns:
            tuple: (command, full_text)
        """
        with self.lock:
            return self.last_command, self.last_text

    def on_command(self, callback):
        """
        Register a callback function to be called when a command is detected.
        
        Args:
            callback (callable): Function(command: str, text: str) to call
        """
        if callable(callback):
            self.command_callbacks.append(callback)
            print(f"[{timestamp()}] Voice command callback registered")

    @property
    def is_available(self):
        """Check if voice control is available on this system."""
        return VOICE_AVAILABLE and self.recognizer is not None

    @property
    def is_listening(self):
        """Check if currently listening for commands."""
        return self.listening
