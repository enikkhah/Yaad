// Web Audio API synthesizer for category ring tunes, phone alarm sounds, and TTS voice announcements
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Category, PhoneAlarmSound } from '../types';

let audioCtx: AudioContext | null = null;
let alarmIntervalId: number | null = null;
let activeAlarmAudio: HTMLAudioElement | null = null;
let previewAudio: HTMLAudioElement | null = null;
let isAlarmLooping: boolean = false;
let globalAlarmVolume: number = 0.85; // 0.0 to 1.0
let globalVibrationEnabled: boolean = true;

export const setGlobalVolume = (vol: number) => {
  globalAlarmVolume = Math.max(0, Math.min(1, vol));
  if (activeAlarmAudio) {
    try {
      activeAlarmAudio.volume = globalAlarmVolume;
    } catch {
      // ignore
    }
  }
};

export const setGlobalVibration = (enabled: boolean) => {
  globalVibrationEnabled = enabled;
  if (!enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      // ignore
    }
  }
};

export const getGlobalVibration = (): boolean => {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('fa_settings_app_data_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.vibrationEnabled === 'boolean') {
          return parsed.vibrationEnabled;
        }
      }
    } catch {
      // ignore
    }
  }
  return globalVibrationEnabled;
};

const getAudioContext = (): AudioContext => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

let hasUnlockedSpeechSynthesis = false;
let hasUnlockedHtmlAudio = false;

/**
 * Unlocks Web Audio API, shared HTMLAudioElement (once), and SpeechSynthesis on user touch/click
 * without interrupting or pausing active TTS playback.
 */
export const unlockAudio = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Ignore
  }

  try {
    if (!hasUnlockedHtmlAudio) {
      hasUnlockedHtmlAudio = true;
      const unlockEl = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      );
      unlockEl.volume = 0.01;
      const p = unlockEl.play();
      if (p) {
        p.then(() => {
          unlockEl.pause();
        }).catch(() => {});
      }
    }
  } catch {
    // Ignore
  }

  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      if (!hasUnlockedSpeechSynthesis) {
        hasUnlockedSpeechSynthesis = true;
        window.speechSynthesis.getVoices();
      }
    }
  } catch {
    // Ignore
  }
};

export const SOUND_FILE_MAP: Record<string, string> = {
  'digital_beep': 'digital_beep.wav',
  'digital-beep': 'digital_beep.wav',
  'radar': 'radar.wav',
  'marimba': 'marimba.wav',
  'morning_chime': 'morning_chime.wav',
  'morning-chime': 'morning_chime.wav',
  'urgent_bell': 'urgent_bell.wav',
  'urgent-bell': 'urgent_bell.wav',
  'beep': 'beep.wav',
  'zen-bowl': 'zen_bowl.wav',
  'zen_bowl': 'zen_bowl.wav',
  'soft-harp': 'soft_harp.wav',
  'soft_harp': 'soft_harp.wav',
  'ocean-drop': 'ocean_drop.wav',
  'ocean_drop': 'ocean_drop.wav',
  'wind-chimes': 'wind_chimes.wav',
  'wind_chimes': 'wind_chimes.wav',
  'warm-pad': 'warm_pad.wav',
  'warm_pad': 'warm_pad.wav',
  'calm-piano': 'calm_piano.wav',
  'calm_piano': 'calm_piano.wav',
};

export const PHONE_ALARM_SOUNDS: { id: PhoneAlarmSound; label: string; labelEn: string; desc: string; descEn: string }[] = [
  { id: 'digital_beep', label: 'زنگ دیجیتال کلاسیک', labelEn: 'Classic Digital Beep', desc: 'بوق استاندارد ساعت‌های دیجیتال (پیشنهادی)', descEn: 'Standard digital clock beep (Recommended)' },
  { id: 'radar', label: 'آلارم پالس رادار', labelEn: 'Radar Pulse Alarm', desc: 'صدای موجی و ملایم مشابه هشدار گوشی‌های هوشمند', descEn: 'Smooth wave pulse similar to smartphone alerts' },
  { id: 'marimba', label: 'ملودی ماریمبا و چوب', labelEn: 'Warm Marimba Melody', desc: 'ریتم گرم و دلنشین چوبی با گام بالارونده', descEn: 'Pleasant wooden rhythm with ascending scale' },
  { id: 'morning_chime', label: 'زنگ ملایم صبحگاهی', labelEn: 'Gentle Morning Chime', desc: 'زنگ آرام و شفاف برای یادآوری بدون استرس', descEn: 'Clear, stress-free morning chime' },
  { id: 'urgent_bell', label: 'زنگ فوری و هشدار', labelEn: 'Urgent Bell Alert', desc: 'صدای زنگ پرانرژی و متناوب برای یادآوری‌های حساس', descEn: 'High-energy alternating bell for urgent reminders' },
  { id: 'beep', label: 'بوق ساده', labelEn: 'Simple Beep', desc: 'تک بوق تمیز و کوتاه برای اعلان‌های سریع', descEn: 'Clean short beep for quick alerts' },
  { id: 'zen-bowl', label: 'کاسه تبتی آرامش‌بخش', labelEn: 'Soothing Zen Bowl', desc: 'طنین عمیق، ملایم و آرامش‌بخش مدیتیشن', descEn: 'Deep, calming meditation bowl resonance' },
  { id: 'soft-harp', label: 'آرپژ چنگ ملایم', labelEn: 'Soft Harp Arpeggio', desc: 'نوازشگر، لطیف و رویایی با نت‌های نرم چنگ', descEn: 'Dreamy, delicate harp notes' },
  { id: 'ocean-drop', label: 'قطرات آرام آب', labelEn: 'Calm Water Drops', desc: 'صدای لطیف و طبیعی چکه آب در سکوت آرام', descEn: 'Natural, gentle water droplets in calm silence' },
  { id: 'wind-chimes', label: 'نسیم و زنگوله بادی', labelEn: 'Breeze & Wind Chimes', desc: 'طنین زنگوله‌های بادی کریستالی و بسیار ملایم', descEn: 'Soft crystalline wind chimes in the breeze' },
  { id: 'warm-pad', label: 'موج گرم و آرامش‌بخش', labelEn: 'Warm Ambient Pad', desc: 'پد صوتی نرم و تدریجی بدون هیچ‌گونه شوک صوتی', descEn: 'Gradual, soft ambient pad without sudden shock' },
  { id: 'calm-piano', label: 'پیانوی آرام شبانه', labelEn: 'Calm Evening Piano', desc: 'آکوردهای ملایم و دلنشین پیانو برای آرامش ذهن', descEn: 'Gentle piano chords for peace of mind' },
];

const VALID_ALARM_SOUND_IDS = new Set<string>(PHONE_ALARM_SOUNDS.map((s) => s.id));

/**
 * Resolves the effective PhoneAlarmSound from a reminder's ringTune or global settings.
 * Priority:
 * 1. Valid PhoneAlarmSound stored in reminder.ringTune (with underscore/hyphen normalization)
 * 2. Valid PhoneAlarmSound in fallbackAlarmSound (settings.alarmSound)
 * 3. Default 'digital_beep'
 */
export const resolveAlarmSound = (
  ringTune?: string,
  fallbackAlarmSound?: PhoneAlarmSound
): PhoneAlarmSound => {
  const normalize = (val?: string): PhoneAlarmSound | undefined => {
    if (!val) return undefined;
    if (val === 'digital-beep') return 'digital_beep';
    if (val === 'morning-chime') return 'morning_chime';
    if (val === 'urgent-bell') return 'urgent_bell';
    const hyphenated = val.replace(/_/g, '-');
    if (VALID_ALARM_SOUND_IDS.has(val)) return val as PhoneAlarmSound;
    if (VALID_ALARM_SOUND_IDS.has(hyphenated)) return hyphenated as PhoneAlarmSound;
    return undefined;
  };

  const resolvedRingTune = normalize(ringTune);
  if (resolvedRingTune) return resolvedRingTune;

  const resolvedFallback = normalize(fallbackAlarmSound);
  if (resolvedFallback) return resolvedFallback;

  return 'digital_beep';
};

/**
 * Plays a single tone note with envelope and volume scaling
 */
const playTone = (
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain = 0.25,
  volumeMultiplier = 1.0
) => {
  const effectiveGain = Math.max(0.0005, peakGain * volumeMultiplier);
  if (volumeMultiplier <= 0.001) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(effectiveGain, startTime + Math.min(0.03, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
};

/**
 * Plays a soft tone with gentle slow attack for ambient/relaxing sounds
 */
const playSoftTone = (
  ctx: AudioContext,
  freq: number,
  startTime: number,
  attackTime: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain = 0.18,
  volumeMultiplier = 1.0
) => {
  const effectiveGain = Math.max(0.0005, peakGain * volumeMultiplier);
  if (volumeMultiplier <= 0.001) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(effectiveGain, startTime + attackTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
};

const scheduleSynthesizedTones = (ctx: AudioContext, sound: PhoneAlarmSound, vol: number) => {
  const norm = sound.replace(/_/g, '-');
  const now = ctx.currentTime + 0.015;

  if (norm === 'digital-beep') {
    // Classic digital watch/phone double-beep-beep: 4 rapid pulses
    const pulses = [0, 0.14, 0.28, 0.42];
    pulses.forEach((offset) => {
      playTone(ctx, 987.77, now + offset, 0.09, 'square', 0.18, vol); // B5
    });
  } else if (norm === 'beep') {
    // Clean single standard beep
    playTone(ctx, 880, now, 0.16, 'sine', 0.28, vol);
  } else if (norm === 'radar') {
    // iOS Radar-like rising chime pulse
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      playTone(ctx, freq, now + i * 0.12, 0.2, 'triangle', 0.28, vol);
    });
  } else if (norm === 'marimba') {
    // Warm wooden rhythmic arpeggio
    const pattern = [
      { freq: 392.0, time: 0.0, dur: 0.18 },   // G4
      { freq: 493.88, time: 0.14, dur: 0.18 }, // B4
      { freq: 587.33, time: 0.28, dur: 0.18 }, // D5
      { freq: 783.99, time: 0.42, dur: 0.25 }, // G5
      { freq: 587.33, time: 0.60, dur: 0.18 }, // D5
      { freq: 783.99, time: 0.75, dur: 0.35 }, // G5
    ];
    pattern.forEach((n) => {
      playTone(ctx, n.freq, now + n.time, n.dur, 'sine', 0.32, vol);
    });
  } else if (norm === 'morning-chime') {
    // Gentle calming harmonic chord progression
    const notes = [
      { freq: 440.0, time: 0.0, dur: 0.5 },   // A4
      { freq: 554.37, time: 0.2, dur: 0.5 },  // C#5
      { freq: 659.25, time: 0.4, dur: 0.6 },  // E5
      { freq: 880.0, time: 0.65, dur: 0.8 },  // A5
    ];
    notes.forEach((n) => {
      playTone(ctx, n.freq, now + n.time, n.dur, 'sine', 0.25, vol);
    });
  } else if (norm === 'zen-bowl') {
    // Tibetan Singing Bowl: deep warm fundamental + harmonic overtones with slow gentle decay
    playSoftTone(ctx, 256.0, now, 0.12, 2.2, 'sine', 0.26, vol);
    playSoftTone(ctx, 512.0, now + 0.02, 0.15, 1.8, 'sine', 0.13, vol);
    playSoftTone(ctx, 768.0, now + 0.05, 0.18, 1.4, 'sine', 0.08, vol);
  } else if (norm === 'soft-harp') {
    // Soft Angelic Harp Arpeggio (Fmaj7: F4, A4, C5, E5, A5)
    const harpNotes = [349.23, 440.0, 523.25, 659.25, 880.0];
    harpNotes.forEach((freq, idx) => {
      playSoftTone(ctx, freq, now + idx * 0.15, 0.04, 1.2, 'sine', 0.20, vol);
    });
  } else if (norm === 'ocean-drop') {
    // Gentle Water Droplets: smooth upward pitch-gliding sine drops
    const drops = [
      { start: 0.0, f1: 520, f2: 1040 },
      { start: 0.42, f1: 620, f2: 1240 },
      { start: 0.92, f1: 480, f2: 960 },
    ];
    drops.forEach(({ start, f1, f2 }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f1, now + start);
      osc.frequency.exponentialRampToValueAtTime(f2, now + start + 0.11);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.linearRampToValueAtTime(Math.max(0.0005, 0.24 * vol), now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.38);
    });
  } else if (norm === 'wind-chimes') {
    // Delicate Pentatonic Wind Chimes
    const chimes = [
      { freq: 1046.5, time: 0.0, dur: 1.1 },  // C6
      { freq: 1174.66, time: 0.2, dur: 1.0 }, // D6
      { freq: 1318.51, time: 0.42, dur: 1.1 },// E6
      { freq: 1567.98, time: 0.65, dur: 1.2 },// G6
      { freq: 1318.51, time: 0.95, dur: 1.2 },// E6
    ];
    chimes.forEach((c) => {
      playSoftTone(ctx, c.freq, now + c.time, 0.03, c.dur, 'sine', 0.16, vol);
    });
  } else if (norm === 'warm-pad') {
    // Soothing Ambient Warm Pad Chord (C4, E4, G4, B4) with slow swell
    const chord = [261.63, 329.63, 392.0, 493.88];
    chord.forEach((freq) => {
      playSoftTone(ctx, freq, now, 0.5, 2.2, 'sine', 0.13, vol);
    });
  } else if (norm === 'calm-piano') {
    // Calm Evening Piano Notes (D4, A4, D5, C5)
    const piano = [
      { freq: 293.66, time: 0.0, dur: 1.3 },
      { freq: 440.0, time: 0.25, dur: 1.2 },
      { freq: 587.33, time: 0.5, dur: 1.1 },
      { freq: 523.25, time: 0.8, dur: 1.3 },
    ];
    piano.forEach((p) => {
      playSoftTone(ctx, p.freq, now + p.time, 0.03, p.dur, 'sine', 0.22, vol);
      playSoftTone(ctx, p.freq * 2, now + p.time, 0.02, p.dur * 0.4, 'triangle', 0.05, vol);
    });
  } else if (norm === 'urgent-bell') {
    // Urgent dual-frequency bell ring
    for (let i = 0; i < 6; i++) {
      const freq = i % 2 === 0 ? 880 : 1174.66; // A5 / D6
      playTone(ctx, freq, now + i * 0.11, 0.1, 'sawtooth', 0.20, vol);
    }
  } else {
    // Default fallback digital beep
    const pulses = [0, 0.14, 0.28, 0.42];
    pulses.forEach((offset) => {
      playTone(ctx, 987.77, now + offset, 0.09, 'square', 0.18, vol);
    });
  }
};

const playSynthesizedSound = (sound: PhoneAlarmSound, vol: number) => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume()
        .then(() => {
          scheduleSynthesizedTones(ctx, sound, vol);
        })
        .catch(() => {
          scheduleSynthesizedTones(ctx, sound, vol);
        });
    } else {
      scheduleSynthesizedTones(ctx, sound, vol);
    }
  } catch (e) {
    console.warn('Synthesized sound error:', e);
  }
};

const playHtmlOrSynthesizedPreview = (sound: PhoneAlarmSound, soundFile: string | undefined, clampedVol: number) => {
  if (typeof window !== 'undefined' && soundFile) {
    try {
      if (previewAudio) {
        try {
          previewAudio.pause();
          previewAudio.currentTime = 0;
        } catch {
          // ignore
        }
      }
      const audio = new Audio(`/${soundFile}`);
      previewAudio = audio;
      audio.volume = clampedVol;
      let fallbackDone = false;
      const runFallback = () => {
        if (!fallbackDone) {
          fallbackDone = true;
          playSynthesizedSound(sound, clampedVol);
        }
      };
      audio.onerror = runFallback;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(runFallback);
      }
      return;
    } catch {
      // Fallback to Web Audio synthesis
    }
  }
  playSynthesizedSound(sound, clampedVol);
};

export const stopPreviewSound = () => {
  if (previewAudio) {
    try {
      previewAudio.pause();
      previewAudio.currentTime = 0;
    } catch {
      // Ignore
    }
    previewAudio = null;
  }
  if (!isAlarmLooping && Capacitor.isNativePlatform()) {
    try {
      (LocalNotifications as any).stopNotificationSound().catch(() => {});
    } catch {
      // Ignore
    }
  }
};

/**
 * Play selected phone alarm sound pattern (single preview play)
 */
export const playPhoneAlarmSound = (sound: PhoneAlarmSound, volumeOverride?: number) => {
  try {
    const effectiveSound = resolveAlarmSound(sound, 'digital_beep');
    const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
    const clampedVol = Math.max(0, Math.min(1, vol));
    if (clampedVol <= 0.001) return;

    const soundFile =
      SOUND_FILE_MAP[effectiveSound] ||
      SOUND_FILE_MAP[effectiveSound.replace(/-/g, '_')] ||
      SOUND_FILE_MAP[sound] ||
      'digital_beep.wav';

    if (Capacitor.isNativePlatform() && soundFile) {
      try {
        const res = (LocalNotifications as any).playNotificationSound({
          sound: soundFile,
          loop: false,
          volume: clampedVol,
        });
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            playHtmlOrSynthesizedPreview(effectiveSound, soundFile, clampedVol);
          });
          return;
        }
      } catch {
        // Fallback if plugin method unavailable
      }
    }

    playHtmlOrSynthesizedPreview(effectiveSound, soundFile, clampedVol);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
};

let alarmAutoStopTimeoutId: number | null = null;

export const stopAlarmRinging = () => {
  const wasLooping =
    isAlarmLooping ||
    activeAlarmAudio !== null ||
    alarmIntervalId !== null ||
    alarmAutoStopTimeoutId !== null;

  isAlarmLooping = false;

  if (alarmAutoStopTimeoutId !== null) {
    clearTimeout(alarmAutoStopTimeoutId);
    alarmAutoStopTimeoutId = null;
  }
  if (alarmIntervalId !== null) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  if (activeAlarmAudio) {
    try {
      activeAlarmAudio.loop = false;
      activeAlarmAudio.pause();
      activeAlarmAudio.currentTime = 0;
    } catch {
      // Ignore
    }
    activeAlarmAudio = null;
  }
  stopSubmarineSonarLoop();

  if (!wasLooping) {
    return;
  }

  if (Capacitor.isNativePlatform()) {
    try {
      (LocalNotifications as any).stopNotificationSound().catch(() => {});
    } catch {
      // Ignore
    }
  }
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      // Ignore
    }
  }
};

// ============================================================================
// SUBMARINE SONAR RADAR AUDIO (DISTANCE-ADAPTIVE RHYTHM: 1/min at 100% -> 5Hz at <=10%)
// ============================================================================
let sonarLoopTimeoutId: number | null = null;
let isSonarActive = false;
let currentSonarDistance = 150;
let currentSonarRadius = 200;
let currentSonarVolumeOverride: number | undefined = undefined;
let lastSonarPingTime = 0;

/**
 * Calculates the delay (ms) between submarine sonar pings and pulse beats based on distance percentage of radius:
 * - At boundary (100% distance): 1 time per minute (60,000 ms)
 * - At 90% distance: 2 times per minute (30,000 ms)
 * - At 80% distance: 3 times per minute (20,000 ms)
 * - At 70% distance: 4 times per minute (15,000 ms)
 * - At 60% distance: 5 times per minute (12,000 ms)
 * - At 50% distance: 6 times per minute (10,000 ms)
 * - Below 50% down to >10%: +1 time per minute for every 5% closer (45%->7/min, 40%->8/min, ..., 15%->13/min)
 * - In the remaining 10% (<=10% of radius): 5 Hz frequency (5 times per second = 200 ms)
 */
export const computeSubmarineSonarIntervalMs = (
  distanceMeters: number,
  radiusMeters: number = 200
): number => {
  const safeRadius = Math.max(1, radiusMeters || 200);
  const clampedDist = Math.max(0, distanceMeters);
  const pct = Math.max(0, Math.min(100, (clampedDist / safeRadius) * 100));

  // Remaining 10% of distance: 5 Hz (5 times per second = 200 ms)
  if (pct <= 10) {
    return 200;
  }

  let pingsPerMinute: number;
  if (pct < 50) {
    // Below 50%: add 1 ping/min for each 5% reduction below 50%
    const stepsBelow50 = Math.max(1, Math.floor((50 - pct) / 5));
    pingsPerMinute = 6 + stepsBelow50;
  } else {
    // 100% down to 50%: 1/min at 100%, 2/min at 90%, 3/min at 80%, 4/min at 70%, 5/min at 60%, 6/min at 50%
    const stepsFrom100 = Math.max(0, Math.floor((100 - pct) / 10));
    pingsPerMinute = 1 + stepsFrom100;
  }

  return Math.round(60000 / pingsPerMinute);
};

/**
 * Plays a single Submarine Sonar Ping (resonant underwater metallic ping + harmonic echo tail).
 */
export const playSubmarineSonarPing = (
  distanceMeters: number = 100,
  radiusMeters: number = 200,
  volumeOverride?: number
) => {
  try {
    const intervalMs = computeSubmarineSonarIntervalMs(distanceMeters, radiusMeters);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('yaad:sonar-ping', {
          detail: {
            distanceMeters,
            radiusMeters,
            intervalMs,
            is5Hz: intervalMs <= 200,
          },
        })
      );
    }

    const vol = Math.max(0, Math.min(1, volumeOverride !== undefined ? volumeOverride : globalAlarmVolume));
    if (vol <= 0.001) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime + 0.008;

    // Slight pitch rise as user gets closer to target (1280 Hz at boundary -> 1560 Hz at <=10%)
    const safeRadius = Math.max(1, radiusMeters || 200);
    const closeness = 1 - Math.max(0, Math.min(1, distanceMeters / safeRadius));
    const pingFreq = 1280 + closeness * 280;

    if (intervalMs <= 200) {
      // 5 Hz rapid submarine sonar ping (200ms cycle): crisp attack & tight underwater decay
      playSoftTone(ctx, pingFreq, now, 0.004, 0.11, 'sine', 0.36, vol);
      playSoftTone(ctx, pingFreq * 1.5, now, 0.005, 0.06, 'sine', 0.12, vol);
      playSoftTone(ctx, pingFreq * 0.995, now + 0.055, 0.006, 0.09, 'sine', 0.15, vol);
    } else {
      // Standard Submarine Ping (sharp attack, resonant underwater decay + reverberant echo)
      playSoftTone(ctx, pingFreq, now, 0.006, 0.42, 'sine', 0.36, vol);
      playSoftTone(ctx, pingFreq * 1.5, now, 0.008, 0.18, 'sine', 0.12, vol);
      playSoftTone(ctx, pingFreq * 0.995, now + 0.13, 0.012, 0.48, 'sine', 0.15, vol);
    }
  } catch {
    // Ignore audio context errors
  }
};

const runSonarTick = () => {
  if (!isSonarActive) return;
  lastSonarPingTime = Date.now();
  playSubmarineSonarPing(currentSonarDistance, currentSonarRadius, currentSonarVolumeOverride);
  const nextInterval = computeSubmarineSonarIntervalMs(currentSonarDistance, currentSonarRadius);
  if (getGlobalVibration() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(nextInterval <= 200 ? 45 : 80);
    } catch {
      // ignore
    }
  }
  sonarLoopTimeoutId = window.setTimeout(runSonarTick, nextInterval);
};

/**
 * Starts a continuous Submarine Sonar loop whose rhythm dynamically adapts to distance
 * and continues until the user clicks "Got It" (متوجه شدم) or exits the geofence.
 */
export const startSubmarineSonarLoop = (
  initialDistanceMeters: number,
  radiusMeters: number = 200,
  volumeOverride?: number
) => {
  stopSubmarineSonarLoop();
  isSonarActive = true;
  currentSonarDistance = initialDistanceMeters;
  currentSonarRadius = radiusMeters || 200;
  currentSonarVolumeOverride = volumeOverride;
  runSonarTick();
};

/**
 * Updates the live distance of the active submarine sonar loop so its rhythm immediately adapts.
 * If the new interval is shorter than the remaining timer wait, reschedules immediately.
 */
export const updateSubmarineSonarDistance = (distanceMeters: number, radiusMeters?: number) => {
  currentSonarDistance = distanceMeters;
  if (radiusMeters && radiusMeters > 0) {
    currentSonarRadius = radiusMeters;
  }
  if (!isSonarActive) return;

  const newInterval = computeSubmarineSonarIntervalMs(currentSonarDistance, currentSonarRadius);
  const elapsed = Date.now() - lastSonarPingTime;

  if (sonarLoopTimeoutId !== null) {
    clearTimeout(sonarLoopTimeoutId);
    sonarLoopTimeoutId = null;
  }

  if (elapsed >= newInterval) {
    runSonarTick();
  } else {
    sonarLoopTimeoutId = window.setTimeout(runSonarTick, Math.max(20, newInterval - elapsed));
  }
};

/**
 * Stops the active submarine sonar loop immediately (e.g. when user clicks "متوجه شدم").
 */
export const stopSubmarineSonarLoop = () => {
  isSonarActive = false;
  if (sonarLoopTimeoutId !== null) {
    clearTimeout(sonarLoopTimeoutId);
    sonarLoopTimeoutId = null;
  }
};

export const speakReminderText = (
  title: string,
  category?: Category,
  rate = 1.0,
  lang: 'fa' | 'en' = 'fa'
) => {
  if (!('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();
    let text = '';
    if (lang === 'en') {
      if (category) {
        const categoryLabel =
          category === 'work' ? 'Work' : category === 'family' ? 'Family' : 'General';
        text = `Reminder for ${categoryLabel}: ${title}`;
      } else {
        text = title;
      }
    } else {
      if (category) {
        const categoryLabel =
          category === 'work' ? 'کاری' : category === 'family' ? 'خانوادگی' : 'عمومی';
        text = `یادآورِ ${categoryLabel}: ${title}`;
      } else {
        text = title;
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'en' ? 'en-US' : 'fa-IR';
    utterance.rate = rate;
    utterance.pitch = 1.0;

    // Fallback voice selection if available
    const voices = window.speechSynthesis.getVoices();
    const targetVoice = voices.find((v) =>
      lang === 'en' ? v.lang.includes('en') : v.lang.includes('fa') || v.lang.includes('ar')
    );
    if (targetVoice) {
      utterance.voice = targetVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('Speech synthesis failed:', e);
  }
};
