import { Category, PhoneAlarmSound } from '../types';

let audioCtx: AudioContext | null = null;
let activeAlarmInterval: number | null = null;
let globalVolume = 0.85;

export function setGlobalVolume(volume: number): void {
  globalVolume = Math.max(0.0, Math.min(1.0, volume));
}

export function getGlobalVolume(): number {
  return globalVolume;
}

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * High-performance dynamics compressor + standard audio output
 * Ensures clear sound on phone and speaker without distortion
 */
function getMasterOutput(ctx: AudioContext): AudioNode {
  const anyCtx = ctx as any;
  if (!anyCtx._masterBooster) {
    // Dynamic compressor ensures smooth headroom
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(6, ctx.currentTime);
    compressor.ratio.setValueAtTime(6, ctx.currentTime);
    compressor.attack.setValueAtTime(0.005, ctx.currentTime);
    compressor.release.setValueAtTime(0.2, ctx.currentTime);

    // Standard Clean Gain
    const outputGain = ctx.createGain();
    outputGain.gain.setValueAtTime(1.0, ctx.currentTime);

    compressor.connect(outputGain);
    outputGain.connect(ctx.destination);
    anyCtx._masterBooster = compressor;
  }
  return anyCtx._masterBooster;
}

export const PHONE_ALARM_SOUNDS: { id: PhoneAlarmSound; label: string; desc: string }[] = [
  { id: 'digital-beep', label: 'دیجیتال استاندارد گوشی', desc: 'بیپ هشدار دوگانه استاندارد با وضوح بالا' },
  { id: 'radar', label: 'رادار گوشی (Radar)', desc: 'آلارم پرطرفدار گوشی‌های هوشمند' },
  { id: 'marimba', label: 'ماریمبا (Marimba)', desc: 'صدای چوبین ریتمیک زنگ گوشی' },
  { id: 'morning-chime', label: 'چایم پرطنین صبحگاهی', desc: 'ملودی آکوستیک آرامش‌بخش و واضح' },
  { id: 'urgent-bell', label: 'زنگ پرانرژی (Urgent Bell)', desc: 'هشدار سریع با فرکانس بالا برای کارهای فوری' },
];

/**
 * Play authentic default phone alarm sounds (Standard Clean Volume)
 */
export function playPhoneAlarmSound(soundType: PhoneAlarmSound = 'digital-beep', customVol?: number): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const vol = customVol !== undefined ? customVol : globalVolume;
    if (vol <= 0.01) return;

    const masterDest = getMasterOutput(ctx);

    if (soundType === 'digital-beep') {
      // Classic electronic digital alarm: Standard clear BEEP-BEEP with balanced tone
      const beeps = [0, 0.12, 0.35, 0.47];
      beeps.forEach((startTime) => {
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(2048, now + startTime);
        osc1.frequency.setValueAtTime(2450, now + startTime + 0.04);

        gain1.gain.setValueAtTime(0.001, now + startTime);
        gain1.gain.linearRampToValueAtTime(0.45 * vol, now + startTime + 0.01);
        gain1.gain.setValueAtTime(0.45 * vol, now + startTime + 0.06);
        gain1.gain.linearRampToValueAtTime(0.0001, now + startTime + 0.085);

        osc1.connect(gain1);
        gain1.connect(masterDest);
        osc1.start(now + startTime);
        osc1.stop(now + startTime + 0.09);
      });
    } else if (soundType === 'radar') {
      // Radar alarm: Sharp high punch accent + rich resonant chime
      const radarHits = [
        { time: 0, freq: 1760, duration: 0.12 },
        { time: 0.14, freq: 880, duration: 0.25 },
        { time: 0.5, freq: 1760, duration: 0.12 },
        { time: 0.64, freq: 880, duration: 0.28 },
      ];
      radarHits.forEach(({ time, freq, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(0.95 * vol, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + time);
        osc.stop(now + time + duration + 0.05);
      });
    } else if (soundType === 'marimba') {
      // Marimba: rich amplified acoustic percussion
      const notes = [
        { time: 0, freq: 523.25 },     // C5
        { time: 0.12, freq: 659.25 },  // E5
        { time: 0.24, freq: 783.99 },  // G5
        { time: 0.36, freq: 1046.50 }, // C6
        { time: 0.48, freq: 783.99 },  // G5
      ];
      notes.forEach(({ time, freq }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.linearRampToValueAtTime(0.95 * vol, now + time + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + 0.28);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + time);
        osc.stop(now + time + 0.3);
      });
    } else if (soundType === 'morning-chime') {
      // Morning chime: rich warm high-output bells
      const notes = [
        { time: 0, freq: 440 },       // A4
        { time: 0.18, freq: 554.37 }, // C#5
        { time: 0.36, freq: 659.25 }, // E5
        { time: 0.54, freq: 880 },    // A5
      ];
      notes.forEach(({ time, freq }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(0.92 * vol, now + time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + 0.6);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + time);
        osc.stop(now + time + 0.65);
      });
    } else {
      // Urgent Bell: high-intensity alert pulse
      const rings = [0, 0.08, 0.16, 0.24, 0.4, 0.48, 0.56, 0.64];
      rings.forEach((time) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1400, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.linearRampToValueAtTime(0.85 * vol, now + time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + 0.065);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + time);
        osc.stop(now + time + 0.07);
      });
    }
  } catch (err) {
    console.warn('Audio playback error:', err);
  }
}

/**
 * Play category-specific chime or default sound
 */
export function playRingTune(category: Category = 'work', durationScale = 1, customVol?: number): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const vol = customVol !== undefined ? customVol : globalVolume;
    if (vol <= 0.01) return;

    const masterDest = getMasterOutput(ctx);

    if (category === 'work') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.15 * durationScale);

        gain.gain.setValueAtTime(0.001, now + idx * 0.15 * durationScale);
        gain.gain.exponentialRampToValueAtTime(0.9 * vol, now + idx * 0.15 * durationScale + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.15 * durationScale + 0.45);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + idx * 0.15 * durationScale);
        osc.stop(now + idx * 0.15 * durationScale + 0.5);
      });
    } else if (category === 'family') {
      const notes = [392.0, 493.88, 587.33, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.18 * durationScale);

        gain.gain.setValueAtTime(0.001, now + idx * 0.18 * durationScale);
        gain.gain.exponentialRampToValueAtTime(0.95 * vol, now + idx * 0.18 * durationScale + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.18 * durationScale + 0.7);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + idx * 0.18 * durationScale);
        osc.stop(now + idx * 0.18 * durationScale + 0.75);
      });
    } else {
      const notes = [440.0, 659.25, 880.0];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.22 * durationScale);

        gain.gain.setValueAtTime(0.001, now + idx * 0.22 * durationScale);
        gain.gain.exponentialRampToValueAtTime(0.88 * vol, now + idx * 0.22 * durationScale + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.22 * durationScale + 0.6);

        osc.connect(gain);
        gain.connect(masterDest);

        osc.start(now + idx * 0.22 * durationScale);
        osc.stop(now + idx * 0.22 * durationScale + 0.65);
      });
    }
  } catch (err) {
    console.warn('Audio playback not supported or blocked:', err);
  }
}

/**
 * Starts continuous repeating phone alarm sound
 */
export function startAlarmRinging(category?: Category, soundType: PhoneAlarmSound = 'digital-beep', volume?: number): void {
  stopAlarmRinging();
  const ring = () => {
    if (soundType) {
      playPhoneAlarmSound(soundType, volume);
    } else {
      playRingTune(category || 'work', 1, volume);
    }
  };

  ring();
  activeAlarmInterval = window.setInterval(ring, 1800);
}

/**
 * Stops continuous repeating alarm immediately and releases audio resources
 */
export function stopAlarmRinging(): void {
  if (activeAlarmInterval !== null) {
    clearInterval(activeAlarmInterval);
    activeAlarmInterval = null;
  }
  if (audioCtx) {
    try {
      audioCtx.close().catch(() => {});
    } catch {
      // ignore
    }
    audioCtx = null;
  }
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      // ignore
    }
  }
}

/**
 * Voice reading is disabled per user request (قرائت صوتی نیاز نیست)
 */
export function speakReminderText(_title: string, _categoryLabel?: string, _rate = 0.95): Promise<void> {
  return Promise.resolve();
}
