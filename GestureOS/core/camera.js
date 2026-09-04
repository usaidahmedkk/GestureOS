/**
 * @file core/camera.js
 * Owns the webcam: permission, MediaStream lifecycle, and the <video> element
 * that MediaPipe reads frames from. Nothing else in the app calls
 * `getUserMedia`, so there is exactly one place a stream can be left running.
 */

/** Human-readable explanations for the DOMException names getUserMedia throws. */
const ERROR_HELP = {
  NotAllowedError:
    'Camera access was blocked. Click the camera icon in Chrome’s address bar, choose "Always allow", then reload.',
  PermissionDeniedError:
    'Camera access was blocked. Allow it from the camera icon in Chrome’s address bar, then reload.',
  NotFoundError:
    'No camera found. Connect a webcam and reload.',
  DevicesNotFoundError:
    'No camera found. Connect a webcam and reload.',
  NotReadableError:
    'The camera is in use by another app. Close Zoom, Teams, or any other app holding the webcam and reload.',
  TrackStartError:
    'The camera could not start. Close any other app using the webcam and reload.',
  OverconstrainedError:
    'This camera cannot provide the requested resolution. GestureOS will retry at a lower one.',
  SecurityError:
    'Chrome only grants camera access on a secure origin. Serve the folder over http://localhost instead of opening the file directly.',
  AbortError:
    'The camera stopped unexpectedly. Reload to try again.',
};

/**
 * Turn a getUserMedia rejection into a sentence worth showing a person.
 * @param {unknown} err
 * @returns {string}
 */
export function describeCameraError(err) {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
  if (ERROR_HELP[name]) return ERROR_HELP[name];
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  return `Camera failed to start: ${message}`;
}

/**
 * Webcam wrapper. Deliberately does not pump frames — the app's single
 * requestAnimationFrame loop pulls from `video` so there is only one clock.
 */
export class Camera {
  /**
   * @param {HTMLVideoElement} video The element to attach the stream to.
   */
  constructor(video) {
    /** @type {HTMLVideoElement} */
    this.video = video;
    /** @type {MediaStream|null} */
    this.stream = null;
    /** @type {boolean} */
    this.running = false;
  }

  /**
   * True when the browser can grant camera access at all. `file://` pages fail
   * this in Chrome, which is the most common first-run problem.
   * @returns {boolean}
   */
  static isSupported() {
    return Boolean(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  /**
   * Request the camera and start playback.
   * @param {Object} [options]
   * @param {number} [options.width=1280] Ideal capture width.
   * @param {number} [options.height=720] Ideal capture height.
   * @param {number} [options.fps=30] Ideal capture frame rate.
   * @param {string} [options.facingMode='user'] Front camera by default.
   * @returns {Promise<{width: number, height: number, label: string}>} Actual settings.
   * @throws {Error} With a message from {@link describeCameraError}.
   */
  async start({ width = 1280, height = 720, fps = 30, facingMode = 'user' } = {}) {
    if (!Camera.isSupported()) {
      throw new Error(ERROR_HELP.SecurityError);
    }
    if (this.running) return this.settings();

    const attempts = [
      { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps }, facingMode },
      // 720p is not universally available on laptop webcams; 640x480 always is.
      { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: fps } },
      true,
    ];

    let lastError = null;
    for (const videoConstraint of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraint,
          audio: false,
        });
        break;
      } catch (err) {
        lastError = err;
        // Permission failures will not be fixed by relaxing constraints.
        const name = err && typeof err === 'object' ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
          throw new Error(describeCameraError(err));
        }
      }
    }

    if (!this.stream) throw new Error(describeCameraError(lastError));

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;

    await this.#waitForMetadata();

    try {
      await this.video.play();
    } catch (err) {
      throw new Error(describeCameraError(err));
    }

    this.running = true;
    return this.settings();
  }

  /**
   * Resolve once intrinsic dimensions are known — they are needed to align the
   * overlay, and are 0 immediately after the stream attaches.
   * @returns {Promise<void>}
   */
  #waitForMetadata() {
    if (this.video.readyState >= 1 && this.video.videoWidth) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('The camera did not deliver any video. Try unplugging and reconnecting it, then reload.'));
      }, 10000);

      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('The video stream failed. Reload to try again.'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.video.removeEventListener('loadedmetadata', onReady);
        this.video.removeEventListener('error', onError);
      };

      this.video.addEventListener('loadedmetadata', onReady, { once: true });
      this.video.addEventListener('error', onError, { once: true });
    });
  }

  /**
   * Actual negotiated capture settings.
   * @returns {{width: number, height: number, label: string}}
   */
  settings() {
    const track = this.stream?.getVideoTracks?.()[0];
    const s = track?.getSettings?.() ?? {};
    return {
      width: s.width || this.video.videoWidth || 0,
      height: s.height || this.video.videoHeight || 0,
      label: track?.label || 'camera',
    };
  }

  /**
   * True when a fresh frame is available to hand to the model.
   * @returns {boolean}
   */
  isReadyForFrame() {
    return (
      this.running &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      !this.video.paused
    );
  }

  /**
   * Stop every track and detach the stream. The webcam LED goes out here —
   * if it stays on after this, something else kept a reference.
   * @returns {void}
   */
  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video.srcObject) this.video.srcObject = null;
    this.running = false;
  }

  /**
   * Full teardown. Same as {@link stop} today, kept for lifecycle symmetry with
   * the rest of the app.
   * @returns {void}
   */
  destroy() {
    this.stop();
  }
}




