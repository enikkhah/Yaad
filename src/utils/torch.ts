/**
 * Hardware Camera LED Flashlight controller using Web MediaStream API (Torch mode)
 * Controls the physical camera LED flash on the back of the phone.
 * Screen strobing is completely removed per user specification.
 */

let torchStream: MediaStream | null = null;
let torchTrack: MediaStreamTrack | null = null;
let strobeInterval: number | null = null;

export async function hasTorchSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/**
 * Request camera access permission for LED torch
 */
export async function requestCameraTorchPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
      },
    });
    // Stop tracks immediately after granting permission
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    console.warn('Camera permission for torch not granted:', err);
    return false;
  }
}

/**
 * Start pulsing the physical camera LED flash on the back of the phone
 */
export async function startFlashlightStrobe(): Promise<boolean> {
  stopFlashlightStrobe();

  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }

  try {
    // Request environment (back) camera where the physical flash LED is located
    torchStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
      },
    });

    const tracks = torchStream.getVideoTracks();
    if (tracks.length > 0) {
      torchTrack = tracks[0];
      const capabilities = torchTrack.getCapabilities?.() as { torch?: boolean } | undefined;

      if (capabilities?.torch) {
        let torchState = false;
        strobeInterval = window.setInterval(async () => {
          if (!torchTrack) return;
          torchState = !torchState;
          try {
            await (torchTrack as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
              advanced: [{ torch: torchState }],
            });
          } catch {
            // Ignore frame constraint errors
          }
        }, 250);
        return true;
      }
    }
  } catch (err) {
    console.warn('Hardware camera LED torch could not be accessed directly:', err);
  }

  return false;
}

/**
 * Stop pulsing physical camera LED flash and release hardware camera
 */
export function stopFlashlightStrobe(): void {
  if (strobeInterval !== null) {
    clearInterval(strobeInterval);
    strobeInterval = null;
  }

  if (torchTrack) {
    try {
      (torchTrack as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: false }],
      }).catch(() => {});
      torchTrack.stop();
    } catch {
      // Ignore
    }
    torchTrack = null;
  }

  if (torchStream) {
    try {
      torchStream.getTracks().forEach((t) => t.stop());
    } catch {
      // Ignore
    }
    torchStream = null;
  }
}
