// Web Audio API synthesizer for category ring tunes, phone alarm sounds, and TTS voice announcements
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Category, PhoneAlarmSound } from '../types';

export type SonarScenarioMode = 'enter' | 'exit' | 'both_enter' | 'both_exit';

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
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
  digital_beep: 'digital_beep.wav',
  'digital-beep': 'digital_beep.wav',
  radar: 'radar.wav',
  marimba: 'marimba.wav',
  morning_chime: 'morning_chime.wav',
  'morning-chime': 'morning_chime.wav',
  urgent_bell: 'urgent_bell.wav',
  'urgent-bell': 'urgent_bell.wav',
  beep: 'beep.wav',
  'zen-bowl': 'zen_bowl.wav',
  zen_bowl: 'zen_bowl.wav',
  'soft-harp': 'soft_harp.wav',
  soft_harp: 'soft_harp.wav',
  'ocean-drop': 'ocean_drop.wav',
  ocean_drop: 'ocean_drop.wav',
  'wind-chimes': 'wind_chimes.wav',
  wind_chimes: 'wind_chimes.wav',
  'warm-pad': 'warm_pad.wav',
  warm_pad: 'warm_pad.wav',
  'calm-piano': 'calm_piano.wav',
  calm_piano: 'calm_piano.wav',
};

export const PHONE_ALARM_SOUNDS: {
  id: PhoneAlarmSound;
  label: string;
  labelEn: string;
  desc: string;
  descEn: string;
}[] = [
  {
    id: 'digital_beep',
    label: 'زنگ دیجیتال کلاسیک',
    labelEn: 'Classic Digital Beep',
    desc: 'بوق استاندارد ساعت‌های دیجیتال (پیشنهادی)',
    descEn: 'Standard digital clock beep (Recommended)',
  },
  {
    id: 'radar',
    label: 'آلارم پالس رادار',
    labelEn: 'Radar Pulse Alarm',
    desc: 'صدای موجی و ملایم مشابه هشدار گوشی‌های هوشمند',
    descEn: 'Smooth wave pulse similar to smartphone alerts',
  },
  {
    id: 'marimba',
    label: 'ملودی ماریمبا و چوب',
    labelEn: 'Warm Marimba Melody',
    desc: 'ریتم گرم و دلنشین چوبی با گام بالارونده',
    descEn: 'Pleasant wooden rhythm with ascending scale',
  },
  {
    id: 'morning_chime',
    label: 'زنگ ملایم صبحگاهی',
    labelEn: 'Gentle Morning Chime',
    desc: 'زنگ آرام و شفاف برای یادآوری بدون استرس',
    descEn: 'Clear, stress-free morning chime',
  },
  {
    id: 'urgent_bell',
    label: 'زنگ فوری و هشدار',
    labelEn: 'Urgent Bell Alert',
    desc: 'صدای زنگ پرانرژی و متناوب برای یادآوری‌های حساس',
    descEn: 'High-energy alternating bell for urgent reminders',
  },
  {
    id: 'beep',
    label: 'بوق ساده',
    labelEn: 'Simple Beep',
    desc: 'تک بوق تمیز و کوتاه برای اعلان‌های سریع',
    descEn: 'Clean short beep for quick alerts',
  },
  {
    id: 'zen-bowl',
    label: 'کاسه تبتی آرامش‌بخش',
    labelEn: 'Soothing Zen Bowl',
    desc: 'طنین عمیق، ملایم و آرامش‌بخش مدیتیشن',
    descEn: 'Deep, calming meditation bowl resonance',
  },
  {
    id: 'soft-harp',
    label: 'آرپژ چنگ ملایم',
    labelEn: 'Soft Harp Arpeggio',
    desc: 'نوازشگر، لطیف و رویایی با نت‌های نرم چنگ',
    descEn: 'Dreamy, delicate harp notes',
  },
  {
    id: 'ocean-drop',
    label: 'قطرات آرام آب',
    labelEn: 'Calm Water Drops',
    desc: 'صدای لطیف و طبیعی چکه آب در سکوت آرام',
    descEn: 'Natural, gentle water droplets in calm silence',
  },
  {
    id: 'wind-chimes',
    label: 'نسیم و زنگوله بادی',
    labelEn: 'Breeze & Wind Chimes',
    desc: 'طنین زنگوله‌های بادی کریستالی و بسیار ملایم',
    descEn: 'Soft crystalline wind chimes in the breeze',
  },
  {
    id: 'warm-pad',
    label: 'موج گرم و آرامش‌بخش',
    labelEn: 'Warm Ambient Pad',
    desc: 'پد صوتی نرم و تدریجی بدون هیچ‌گونه شوک صوتی',
    descEn: 'Gradual, soft ambient pad without sudden shock',
  },
  {
    id: 'calm-piano',
    label: 'پیانوی آرام شبانه',
    labelEn: 'Calm Evening Piano',
    desc: 'آکوردهای ملایم و دلنشین پیانو برای آرامش ذهن',
    descEn: 'Gentle piano chords for peace of mind',
  },
];

const VALID_ALARM_SOUND_IDS = new Set<string>(PHONE_ALARM_SOUNDS.map((s) => s.id));

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
    const pulses = [0, 0.14, 0.28, 0.42];
    pulses.forEach((offset) => {
      playTone(ctx, 987.77, now + offset, 0.09, 'square', 0.18, vol);
    });
  } else if (norm === 'beep') {
    playTone(ctx, 880, now, 0.16, 'sine', 0.28, vol);
  } else if (norm === 'radar') {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      playTone(ctx, freq, now + i * 0.12, 0.2, 'triangle', 0.28, vol);
    });
  } else if (norm === 'marimba') {
    const pattern = [
      { freq: 392.0, time: 0.0, dur: 0.18 },
      { freq: 493.88, time: 0.14, dur: 0.18 },
      { freq: 587.33, time: 0.28, dur: 0.18 },
      { freq: 783.99, time: 0.42, dur: 0.25 },
      { freq: 587.33, time: 0.6, dur: 0.18 },
      { freq: 783.99, time: 0.75, dur: 0.35 },
    ];
    pattern.forEach((n) => {
      playTone(ctx, n.freq, now + n.time, n.dur, 'sine', 0.32, vol);
    });
  } else if (norm === 'morning-chime') {
    const notes = [
      { freq: 440.0, time: 0.0, dur: 0.5 },
      { freq: 554.37, time: 0.2, dur: 0.5 },
      { freq: 659.25, time: 0.4, dur: 0.6 },
      { freq: 880.0, time: 0.65, dur: 0.8 },
    ];
    notes.forEach((n) => {
      playTone(ctx, n.freq, now + n.time, n.dur, 'sine', 0.25, vol);
    });
  } else if (norm === 'zen-bowl') {
    playSoftTone(ctx, 256.0, now, 0.12, 2.2, 'sine', 0.26, vol);
    playSoftTone(ctx, 512.0, now + 0.02, 0.15, 1.8, 'sine', 0.13, vol);
    playSoftTone(ctx, 768.0, now + 0.05, 0.18, 1.4, 'sine', 0.08, vol);
  } else if (norm === 'soft-harp') {
    const harpNotes = [349.23, 440.0, 523.25, 659.25, 880.0];
    harpNotes.forEach((freq, idx) => {
      playSoftTone(ctx, freq, now + idx * 0.15, 0.04, 1.2, 'sine', 0.2, vol);
    });
  } else if (norm === 'ocean-drop') {
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
    const chimes = [
      { freq: 1046.5, time: 0.0, dur: 1.1 },
      { freq: 1174.66, time: 0.2, dur: 1.0 },
      { freq: 1318.51, time: 0.42, dur: 1.1 },
      { freq: 1567.98, time: 0.65, dur: 1.2 },
      { freq: 1318.51, time: 0.95, dur: 1.2 },
    ];
    chimes.forEach((c) => {
      playSoftTone(ctx, c.freq, now + c.time, 0.03, c.dur, 'sine', 0.16, vol);
    });
  } else if (norm === 'warm-pad') {
    const chord = [261.63, 329.63, 392.0, 493.88];
    chord.forEach((freq) => {
      playSoftTone(ctx, freq, now, 0.5, 2.2, 'sine', 0.13, vol);
    });
  } else if (norm === 'calm-piano') {
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
    for (let i = 0; i < 6; i++) {
      const freq = i % 2 === 0 ? 880 : 1174.66;
      playTone(ctx, freq, now + i * 0.11, 0.1, 'sawtooth', 0.2, vol);
    }
  } else {
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
      ctx
        .resume()
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

const playHtmlOrSynthesizedPreview = (
  sound: PhoneAlarmSound,
  soundFile: string | undefined,
  clampedVol: number
) => {
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
// SUBMARINE SONAR RADAR AUDIO (3 SCENARIOS: ENTER, EXIT, BOTH + 5Hz FINAL STAGE)
// ============================================================================
let sonarLoopTimeoutId: number | null = null;
let isSonarActive = false;
let currentSonarDistance = 150;
let currentSonarRadius = 200;
let currentSonarMode: SonarScenarioMode = 'enter';
let currentSonarVolumeOverride: number | undefined = undefined;
let lastSonarPingTime = 0;

/**
 * Helper: Computes interval (ms) for an effective Enter percentage (100% at start -> 0% at target):
 * - 100% down to 50%: 5/min at 100%, 10/min at 90%, 15/min at 80%, 20/min at 70%, 25/min at 60%, 30/min at 50%
 * - Below 50% down to >10%: +5/min for each 5% reduction (45%->35/min, ..., 15%->65/min)
 * - <= 10%: 5 Hz (200 ms)
 */
const computeEnterCurveIntervalMs = (pct: number): number => {
  const clampedPct = Math.max(0, Math.min(100, pct));
  if (clampedPct <= 10) {
    return 200; // 5 Hz (5 times per second = 200 ms)
  }
  let basePingsPerMinute: number;
  if (clampedPct < 50) {
    const stepsBelow50 = Math.max(1, Math.floor((50 - clampedPct) / 5));
    basePingsPerMinute = 6 + stepsBelow50;
  } else {
    const stepsFrom100 = Math.max(0, Math.floor((100 - clampedPct) / 10));
    basePingsPerMinute = 1 + stepsFrom100;
  }
  const pingsPerMinute = basePingsPerMinute * 5;
  return Math.round(60000 / pingsPerMinute);
};

/**
 * Helper: Computes interval (ms) for an effective Exit percentage (0% at center -> 100% at border):
 * - 0% to 10%: Central quiet zone (12,000 ms fallback if queried, muted by scenario evaluator)
 * - 10% to 50%: Starts at 5/min (10..20%), +5/min per 10% further out (20..30%->10/min, 30..40%->15/min, 40..50%->20/min, 50%->25/min)
 * - 50% to <90%: +5/min for each 5% further out (55%->30/min, 60%->35/min, ..., 85%->60/min, <90%->65/min)
 * - 90% to 100% (10% adjacent to border): 5 Hz (200 ms)
 */
const computeExitCurveIntervalMs = (pct: number): number => {
  const clampedPct = Math.max(0, Math.min(100, pct));
  if (clampedPct >= 90) {
    return 200; // 5 Hz (5 times per second = 200 ms) in the 10% adjacent to border
  }
  if (clampedPct <= 10) {
    return 12000;
  }
  let pingsPerMinute: number;
  if (clampedPct <= 50) {
    const stepsFrom10 = Math.max(0, Math.floor((clampedPct - 10) / 10));
    pingsPerMinute = (1 + stepsFrom10) * 5; // 5, 10, 15, 20, 25
  } else {
    const stepsAbove50 = Math.max(1, Math.floor((clampedPct - 50) / 5));
    pingsPerMinute = 25 + stepsAbove50 * 5; // 30, 35, 40, ..., 65
  }
  return Math.round(60000 / pingsPerMinute);
};

/**
 * Calculates the delay (ms) between submarine sonar pings and pulse beats across all 3 scenarios:
 * - 'enter': 100% R -> 0% R (<=10% R is 5 Hz = 200ms)
 * - 'exit': 10% R -> 100% R (90%..100% R is 5 Hz = 200ms)
 * - 'both_enter': 120% R -> 100% R outer 20% border band (102%..100% R is 5 Hz = 200ms)
 * - 'both_exit': 80% R -> 100% R inner 20% border band (98%..100% R is 5 Hz = 200ms)
 */
export const computeSubmarineSonarIntervalMs = (
  distanceMeters: number,
  radiusMeters: number = 200,
  mode: SonarScenarioMode = 'enter'
): number => {
  const safeRadius = Math.max(1, radiusMeters || 200);
  const clampedDist = Math.max(0, distanceMeters);

  if (mode === 'enter') {
    const pct = (clampedDist / safeRadius) * 100;
    return computeEnterCurveIntervalMs(pct);
  }

  if (mode === 'exit') {
    const pct = (clampedDist / safeRadius) * 100;
    return computeExitCurveIntervalMs(pct);
  }

  if (mode === 'both_enter') {
    // 20% band outside boundary: 1.20*R (100% of band) down to 1.00*R (0% of band)
    // 2% adjacent to border (1.02*R down to 1.00*R) is <= 10% of the 20% band -> 5 Hz (200 ms)
    const bandWidth = Math.max(1, safeRadius * 0.2);
    const distFromBorder = Math.max(0, clampedDist - safeRadius);
    const bandPct = Math.max(0, Math.min(100, (distFromBorder / bandWidth) * 100));
    return computeEnterCurveIntervalMs(bandPct);
  }

  // mode === 'both_exit'
  // 20% band inside boundary: 0.80*R (0% of band) up to 1.00*R (100% of band)
  // 2% adjacent to border (0.98*R up to 1.00*R) is >= 90% of the 20% band -> 5 Hz (200 ms)
  const bandWidth = Math.max(1, safeRadius * 0.2);
  const innerStart = safeRadius * 0.8;
  const distFromInnerStart = Math.max(0, clampedDist - innerStart);
  const bandPct = Math.max(0, Math.min(100, (distFromInnerStart / bandWidth) * 100));
  return computeExitCurveIntervalMs(bandPct);
};

/**
 * Plays a single Submarine Sonar Ping (resonant underwater metallic ping + harmonic echo tail).
 * On Android native platform, delegates to YaadGeofenceBridge.playSonarPing so the sound
 * plays on Android's Notification stream (STREAM_NOTIFICATION) and is controlled by phone notification volume.
 */
export const playSubmarineSonarPing = (
  distanceMeters: number = 100,
  radiusMeters: number = 200,
  volumeOverride?: number,
  mode: SonarScenarioMode = 'enter'
) => {
  try {
    const intervalMs = computeSubmarineSonarIntervalMs(distanceMeters, radiusMeters, mode);
    const is5Hz = intervalMs <= 200;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('yaad:sonar-ping', {
          detail: {
            distanceMeters,
            radiusMeters,
            intervalMs,
            is5Hz,
            mode,
          },
        })
      );

      // Route through Native Android Notification Stream (USAGE_NOTIFICATION / STREAM_NOTIFICATION)
      // when running inside the Android app so the phone's Notification volume slider controls sonar volume.
      const bridge = (window as any).YaadGeofenceBridge;
      if (bridge && typeof bridge.playSonarPing === 'function') {
        // Pass effective virtual distance/radius so native synthesizer matches 5Hz vs standard ping
        const effectiveDistForNative = is5Hz
          ? 0
          : Math.max(Math.round(radiusMeters * 0.25), Math.round(distanceMeters));
        bridge.playSonarPing(effectiveDistForNative, Math.round(radiusMeters));
        return;
      }
    }

    const vol = Math.max(
      0,
      Math.min(1, volumeOverride !== undefined ? volumeOverride : globalAlarmVolume)
    );
    if (vol <= 0.001) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime + 0.008;

    // Slight pitch rise as interval gets faster (1280 Hz at slow ping -> 1580 Hz at 5 Hz)
    const urgency = is5Hz ? 1 : Math.max(0, Math.min(1, 1 - intervalMs / 12000));
    const pingFreq = 1280 + urgency * 300;

    if (is5Hz) {
      // 5 Hz rapid submarine sonar ping (200ms cycle): crisp attack & tight underwater decay
      playSoftTone(ctx, pingFreq, now, 0.004, 0.11, 'sine', 0.36, vol);
      playSoftTone(ctx, pingFreq * 1.5, now, 0.004, 0.06, 'sine', 0.12, vol);
      playSoftTone(ctx, pingFreq * 0.995, now + 0.055, 0.005, 0.08, 'sine', 0.15, vol);
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
  playSubmarineSonarPing(
    currentSonarDistance,
    currentSonarRadius,
    currentSonarVolumeOverride,
    currentSonarMode
  );
  const nextInterval = computeSubmarineSonarIntervalMs(
    currentSonarDistance,
    currentSonarRadius,
    currentSonarMode
  );
  if (getGlobalVibration() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(nextInterval <= 200 ? 40 : 80);
    } catch {
      // ignore
    }
  }
  sonarLoopTimeoutId = window.setTimeout(runSonarTick, nextInterval);
};

/**
 * Starts a continuous Submarine Sonar loop whose rhythm dynamically adapts to the active priority scenario
 * and continues until the scenario transitions to visual-only or the user clicks "توقف عملیات".
 */
export const startSubmarineSonarLoop = (
  initialDistanceMeters: number,
  radiusMeters: number = 200,
  volumeOverride?: number,
  mode: SonarScenarioMode = 'enter'
) => {
  stopSubmarineSonarLoop();
  isSonarActive = true;
  currentSonarDistance = initialDistanceMeters;
  currentSonarRadius = radiusMeters || 200;
  currentSonarMode = mode;
  currentSonarVolumeOverride = volumeOverride;
  runSonarTick();
};

/**
 * Updates the live distance & scenario mode of the active submarine sonar loop so its rhythm immediately adapts.
 * If the loop is not active yet, starts it automatically.
 */
export const updateSubmarineSonarDistance = (
  distanceMeters: number,
  radiusMeters?: number,
  mode?: SonarScenarioMode
) => {
  currentSonarDistance = distanceMeters;
  if (radiusMeters && radiusMeters > 0) {
    currentSonarRadius = radiusMeters;
  }
  if (mode) {
    currentSonarMode = mode;
  }
  if (!isSonarActive) {
    startSubmarineSonarLoop(
      currentSonarDistance,
      currentSonarRadius,
      currentSonarVolumeOverride,
      currentSonarMode
    );
    return;
  }

  const newInterval = computeSubmarineSonarIntervalMs(
    currentSonarDistance,
    currentSonarRadius,
    currentSonarMode
  );
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
 * Stops the active submarine sonar loop immediately.
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
