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

export const getGlobalVolume = (): number => {
  return globalAlarmVolume;
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

let sharedTtsAudio: HTMLAudioElement | null = null;
let hasUnlockedSpeechSynthesis = false;
let hasUnlockedHtmlAudio = false;

export const getSharedTtsAudioElement = (): HTMLAudioElement | null => {
  if (typeof window === 'undefined') return null;
  if (!sharedTtsAudio) {
    try {
      sharedTtsAudio = new Audio();
      sharedTtsAudio.preload = 'auto';
      sharedTtsAudio.setAttribute('referrerpolicy', 'no-referrer');
    } catch {
      return null;
    }
  }
  return sharedTtsAudio;
};

/**
 * بی‌صدا کردن صدای اعلان سیستم اندروید (بوق روشن/خاموش شدن SpeechRecognizer) در طول نوبت شنیدن صدای کاربر
 * و بازگردانی فوری صدا پیش از شروع صحبت دستیار یا پخش آلارم.
 */
export const setNativeSpeechRecognizerMuteGate = (muted: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    const win = window as any;
    if (win.YaadNativeAudioBridge && typeof win.YaadNativeAudioBridge.setMicListeningMute === 'function') {
      win.YaadNativeAudioBridge.setMicListeningMute(Boolean(muted));
    }
  } catch {
    // ignore
  }
  try {
    if (Capacitor.isNativePlatform()) {
      (LocalNotifications as any).setMicListeningMute?.({ muted: Boolean(muted) })?.catch?.(() => {});
    }
  } catch {
    // ignore
  }
};

/**
 * Plays a gentle two-note voice-assistant prompt chime via Web Audio API
 */
export const playSoftPromptChime = () => {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    playSoftTone(ctx, 523.25, now, 0.02, 0.16, 'sine', 0.14, 0.8);
    playSoftTone(ctx, 659.25, now + 0.09, 0.02, 0.22, 'sine', 0.16, 0.8);
  } catch {
    // Ignore
  }
};

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

const playSynthesizedSound = (sound: PhoneAlarmSound, vol: number) => {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  if (sound === 'digital_beep' || sound === 'digital-beep') {
    // Classic digital watch/phone double-beep-beep: 4 rapid 880Hz pulses
    const pulses = [0, 0.14, 0.28, 0.42];
    pulses.forEach((offset) => {
      playTone(ctx, 987.77, now + offset, 0.09, 'square', 0.16, vol); // B5
    });
  } else if (sound === 'beep') {
    // Clean single standard beep
    playTone(ctx, 880, now, 0.15, 'sine', 0.25, vol);
  } else if (sound === 'radar') {
    // iOS Radar-like rising chime pulse
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      playTone(ctx, freq, now + i * 0.12, 0.2, 'triangle', 0.28, vol);
    });
  } else if (sound === 'marimba') {
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
  } else if (sound === 'morning_chime' || sound === 'morning-chime') {
    // Gentle calming harmonic chord progression
    const notes = [
      { freq: 440.0, time: 0.0, dur: 0.5 },   // A4
      { freq: 554.37, time: 0.2, dur: 0.5 },  // C#5
      { freq: 659.25, time: 0.4, dur: 0.6 },  // E5
      { freq: 880.0, time: 0.65, dur: 0.8 },  // A5
    ];
    notes.forEach((n) => {
      playTone(ctx, n.freq, now + n.time, n.dur, 'sine', 0.24, vol);
    });
  } else if (sound === 'zen-bowl') {
    // Tibetan Singing Bowl: deep warm fundamental + harmonic overtones with slow gentle decay
    playSoftTone(ctx, 256.0, now, 0.12, 2.2, 'sine', 0.24, vol);
    playSoftTone(ctx, 512.0, now + 0.02, 0.15, 1.8, 'sine', 0.11, vol);
    playSoftTone(ctx, 768.0, now + 0.05, 0.18, 1.4, 'sine', 0.06, vol);
  } else if (sound === 'soft-harp') {
    // Soft Angelic Harp Arpeggio (Fmaj7: F4, A4, C5, E5, A5)
    const harpNotes = [349.23, 440.0, 523.25, 659.25, 880.0];
    harpNotes.forEach((freq, idx) => {
      playSoftTone(ctx, freq, now + idx * 0.15, 0.04, 1.2, 'sine', 0.18, vol);
    });
  } else if (sound === 'ocean-drop') {
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
      gain.gain.linearRampToValueAtTime(Math.max(0.0005, 0.22 * vol), now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.38);
    });
  } else if (sound === 'wind-chimes') {
    // Delicate Pentatonic Wind Chimes
    const chimes = [
      { freq: 1046.5, time: 0.0, dur: 1.1 },  // C6
      { freq: 1174.66, time: 0.2, dur: 1.0 }, // D6
      { freq: 1318.51, time: 0.42, dur: 1.1 },// E6
      { freq: 1567.98, time: 0.65, dur: 1.2 },// G6
      { freq: 1318.51, time: 0.95, dur: 1.2 },// E6
    ];
    chimes.forEach((c) => {
      playSoftTone(ctx, c.freq, now + c.time, 0.03, c.dur, 'sine', 0.14, vol);
    });
  } else if (sound === 'warm-pad') {
    // Soothing Ambient Warm Pad Chord (C4, E4, G4, B4) with slow swell
    const chord = [261.63, 329.63, 392.0, 493.88];
    chord.forEach((freq) => {
      playSoftTone(ctx, freq, now, 0.6, 2.2, 'sine', 0.10, vol);
    });
  } else if (sound === 'calm-piano') {
    // Calm Evening Piano Notes (D4, A4, D5, C5)
    const piano = [
      { freq: 293.66, time: 0.0, dur: 1.3 },
      { freq: 440.0, time: 0.25, dur: 1.2 },
      { freq: 587.33, time: 0.5, dur: 1.1 },
      { freq: 523.25, time: 0.8, dur: 1.3 },
    ];
    piano.forEach((p) => {
      playSoftTone(ctx, p.freq, now + p.time, 0.03, p.dur, 'sine', 0.20, vol);
      playSoftTone(ctx, p.freq * 2, now + p.time, 0.02, p.dur * 0.4, 'triangle', 0.04, vol);
    });
  } else if (sound === 'urgent_bell' || sound === 'urgent-bell') {
    // Urgent dual-frequency bell ring
    for (let i = 0; i < 6; i++) {
      const freq = i % 2 === 0 ? 880 : 1174.66; // A5 / D6
      playTone(ctx, freq, now + i * 0.11, 0.1, 'sawtooth', 0.18, vol);
    }
  }
};

/**
 * Play selected phone alarm sound pattern (single preview play)
 */
export const playPhoneAlarmSound = (sound: PhoneAlarmSound, volumeOverride?: number) => {
  try {
    setNativeSpeechRecognizerMuteGate(false);
    const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
    if (vol <= 0.001) return;

    const soundFile = SOUND_FILE_MAP[sound] || SOUND_FILE_MAP[sound.replace(/-/g, '_')];
    if (Capacitor.isNativePlatform() && soundFile) {
      try {
        (LocalNotifications as any).playNotificationSound({ sound: soundFile, loop: false }).catch(() => {});
        return;
      } catch {
        // Fallback if plugin method unavailable
      }
    }

    if (typeof window !== 'undefined' && soundFile) {
      try {
        if (previewAudio) {
          previewAudio.pause();
          previewAudio.currentTime = 0;
        }
        const audio = new Audio(`/${soundFile}`);
        previewAudio = audio;
        audio.volume = Math.max(0, Math.min(1, vol));
        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch(() => {
            playSynthesizedSound(sound, vol);
          });
        }
        return;
      } catch {
        // Fallback to Web Audio synthesis
      }
    }

    playSynthesizedSound(sound, vol);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
};

export const playRingTune = (category: Category | string, volumeOverride?: number) => {
  try {
    setNativeSpeechRecognizerMuteGate(false);
    const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
    if (vol <= 0.001) return;

    // Check if it's one of the phone alarm sounds first
    if (VALID_ALARM_SOUND_IDS.has(category)) {
      playPhoneAlarmSound(category as PhoneAlarmSound, vol);
      return;
    }

    const ctx = getAudioContext();
    const now = ctx.currentTime;

    if (category === 'work') {
      // Crisp, professional double-chime (C5 -> E5 -> G5)
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        playTone(ctx, freq, now + idx * 0.14, 0.35, 'triangle', 0.25, vol);
      });
    } else if (category === 'family') {
      // Warm, melodic marimba-like chord (F4 -> A4 -> C5 -> F5)
      const notes = [349.23, 440.0, 523.25, 698.46, 523.25, 698.46];
      notes.forEach((freq, idx) => {
        playTone(ctx, freq, now + idx * 0.18, 0.45, 'sine', 0.3, vol);
      });
    } else {
      // Alert / General bell chime
      const notes = [587.33, 880.0, 587.33, 880.0];
      notes.forEach((freq, idx) => {
        playTone(ctx, freq, now + idx * 0.2, 0.3, 'sine', 0.25, vol);
      });
    }
  } catch (e) {
    console.warn('Audio playback not allowed or failed:', e);
  }
};

let alarmAutoStopTimeoutId: number | null = null;

/**
 * Starts continuous, persistent phone alarm ringing & vibration loop for 1 minute (60 seconds)
 * or until stopAlarmRinging() is explicitly called by user action (Done / Snooze / Edit / Dismiss).
 */
export const startAlarmRinging = (
  category: Category,
  alarmSound: PhoneAlarmSound = 'digital_beep',
  volumeOverride?: number,
  vibrationOverride?: boolean
) => {
  setNativeSpeechRecognizerMuteGate(false);
  stopAlarmRinging();
  isAlarmLooping = true;

  const effectiveSound = resolveAlarmSound(alarmSound, 'digital_beep');
  const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
  const vibEnabled = vibrationOverride !== undefined ? vibrationOverride : getGlobalVibration();
  const clampedVol = Math.max(0, Math.min(1, vol));
  const soundFile = SOUND_FILE_MAP[effectiveSound] || SOUND_FILE_MAP[effectiveSound.replace(/-/g, '_')] || 'digital_beep.wav';

  const isNative = Capacitor.isNativePlatform();

  // 1. On Native Android, play via Notification stream (USAGE_NOTIFICATION) instead of WebView Media stream (STREAM_MUSIC)
  if (isNative) {
    if (clampedVol > 0.001) {
      try {
        (LocalNotifications as any).playNotificationSound({ sound: soundFile, loop: true }).catch(() => {});
      } catch {
        // Ignore
      }
    }
  } else if (typeof window !== 'undefined' && clampedVol > 0.001) {
    try {
      const audio = new Audio(`/${soundFile}`);
      audio.loop = true;
      audio.volume = clampedVol;
      // Fallback loop handler in case browser/WebView ignores .loop
      audio.addEventListener('ended', () => {
        if (isAlarmLooping && activeAlarmAudio === audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        }
      });
      activeAlarmAudio = audio;
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          if (isAlarmLooping) {
            playSynthesizedSound(effectiveSound, clampedVol);
          }
        });
      }
    } catch {
      playSynthesizedSound(effectiveSound, clampedVol);
    }
  }

  // 2. Continuous vibration + audio watchdog loop every 1.6s for up to 1 minute
  const triggerVibrationAndWatchdog = () => {
    if (!isAlarmLooping) return;

    if (vibEnabled && 'vibrate' in navigator) {
      try {
        navigator.vibrate([500, 200, 500, 200, 500]);
      } catch {
        // Ignore vibration errors on unsupported browsers
      }
    }

    if (!isNative && clampedVol > 0.001) {
      if (activeAlarmAudio) {
        if (activeAlarmAudio.paused || activeAlarmAudio.ended) {
          activeAlarmAudio.currentTime = 0;
          activeAlarmAudio.play().catch(() => {
            playSynthesizedSound(effectiveSound, clampedVol);
          });
        }
      } else {
        playSynthesizedSound(effectiveSound, clampedVol);
      }
    }
  };

  triggerVibrationAndWatchdog();
  alarmIntervalId = window.setInterval(triggerVibrationAndWatchdog, 1600);

  // Stop ringing automatically after 1 minute (60,000 ms) while keeping the notification/modal open
  alarmAutoStopTimeoutId = window.setTimeout(() => {
    stopAlarmRinging();
  }, 60000);
};

export const stopAlarmRinging = () => {
  isAlarmLooping = false;
  if (Capacitor.isNativePlatform()) {
    try {
      (LocalNotifications as any).stopNotificationSound().catch(() => {});
    } catch {
      // Ignore
    }
  }
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
  if (previewAudio) {
    try {
      previewAudio.pause();
      previewAudio.currentTime = 0;
    } catch {
      // Ignore
    }
    previewAudio = null;
  }
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      // Ignore
    }
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

export interface AiVoicePersonaMeta {
  id: 'zephyr_warm' | 'kore_calm' | 'puck_energetic' | 'fenrir_deep' | 'charon_formal';
  label: string;
  labelEn: string;
  desc: string;
  descEn: string;
  pitch: number;
  rate: number;
  detuneCents: number;
  filterType: BiquadFilterType;
  filterFreq: number;
  filterGainDb: number;
}

export const AI_VOICE_PERSONAS: AiVoicePersonaMeta[] = [
  {
    id: 'zephyr_warm',
    label: 'صمیمی و گرم (پیشنهادی)',
    labelEn: 'Warm & Friendly (Default)',
    desc: 'لحن دلنشین و طبیعی مناسب دستیار هوشمند',
    descEn: 'Natural, welcoming conversational tone',
    pitch: 1.0,
    rate: 1.0,
    detuneCents: 0,
    filterType: 'lowshelf',
    filterFreq: 230,
    filterGainDb: 3,
  },
  {
    id: 'kore_calm',
    label: 'آرام و ملایم',
    labelEn: 'Calm & Gentle',
    desc: 'صدای نرم و آرامش‌بخش با سرعت متعادل',
    descEn: 'Soft, soothing voice at a relaxed pace',
    pitch: 1.18,
    rate: 0.93,
    detuneCents: 210,
    filterType: 'peaking',
    filterFreq: 1850,
    filterGainDb: 3.5,
  },
  {
    id: 'puck_energetic',
    label: 'پرانرژی و شفاف',
    labelEn: 'Clear & Energetic',
    desc: 'بیان شفاف و پرانرژی برای ثبت سریع',
    descEn: 'Crisp, lively delivery for quick capture',
    pitch: 1.12,
    rate: 1.09,
    detuneCents: 135,
    filterType: 'highshelf',
    filterFreq: 2500,
    filterGainDb: 4.5,
  },
  {
    id: 'fenrir_deep',
    label: 'رسا و بم',
    labelEn: 'Deep & Resonant',
    desc: 'صدای بم، عمیق و بسیار واضح',
    descEn: 'Deep, authoritative and clear voice',
    pitch: 0.78,
    rate: 0.95,
    detuneCents: -310,
    filterType: 'lowshelf',
    filterFreq: 170,
    filterGainDb: 6,
  },
  {
    id: 'charon_formal',
    label: 'رسمی و شمرده',
    labelEn: 'Formal & Articulate',
    desc: 'بیان شمرده، دقیق و محترمانه',
    descEn: 'Measured, articulate and polite tone',
    pitch: 0.86,
    rate: 0.89,
    detuneCents: -165,
    filterType: 'peaking',
    filterFreq: 950,
    filterGainDb: 3.5,
  },
];

const ttsRawBytesCache = new Map<
  string,
  { bytes: Uint8Array; mimeType: string; alreadyPersonaTransformed: boolean }
>();
let activeAssistantTimer: ReturnType<typeof setTimeout> | null = null;
let activeAssistantAbort: AbortController | null = null;
let activeWebAudioSource: AudioBufferSourceNode | null = null;
let activeObjectUrl: string | null = null;

function revokeActiveObjectUrl() {
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch {
      // ignore
    }
    activeObjectUrl = null;
  }
}

export const stopAiAssistantPrompt = () => {
  if (activeAssistantTimer) {
    clearTimeout(activeAssistantTimer);
    activeAssistantTimer = null;
  }
  if (activeAssistantAbort) {
    try {
      activeAssistantAbort.abort();
    } catch {
      // ignore
    }
    activeAssistantAbort = null;
  }
  if (activeWebAudioSource) {
    try {
      activeWebAudioSource.onended = null;
      activeWebAudioSource.stop();
      activeWebAudioSource.disconnect();
    } catch {
      // ignore
    }
    activeWebAudioSource = null;
  }
  if (sharedTtsAudio) {
    try {
      sharedTtsAudio.onended = null;
      sharedTtsAudio.onerror = null;
      sharedTtsAudio.pause();
    } catch {
      // ignore
    }
  }
  revokeActiveObjectUrl();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
};

function getPresetWavUrl(cleanText: string, language: 'fa' | 'en'): string | null {
  const norm = cleanText.replace(/\s+/g, ' ').trim();
  const lower = norm.toLowerCase();
  const baseUrl = ((import.meta as any).env?.BASE_URL || '/').replace(/\/?$/, '/');

  if (language !== 'en') {
    // Welcome variants (short & legacy)
    if (norm.includes('بفرمایید ثبت کنم')) return `${baseUrl}tts-cache/welcome_1_fa.wav`;
    if (norm.includes('بفرمایید، منتظرم') || norm.includes('بفرمایید منتظرم')) {
      return `${baseUrl}tts-cache/welcome_2_fa.wav`;
    }
    if (norm.includes('در خدمتم، بفرمایید') || norm.includes('در خدمتم بفرمایید')) {
      return `${baseUrl}tts-cache/welcome_3_fa.wav`;
    }
    if (
      norm.includes('چه یادآور، مناسبت، مکان یا ایده‌ای') ||
      norm.includes('لطفاً بفرمایید چه موردی را ثبت کنم')
    ) {
      return `${baseUrl}tts-cache/welcome_1_fa.wav`;
    }

    // Retry / Unclear speech variants
    if (norm.includes('متوجه نشدم') && norm.includes('یک بار دیگه')) {
      return `${baseUrl}tts-cache/retry_1_fa.wav`;
    }
    if (norm.includes('صداتون واضح نبود') || norm.includes('دوباره بگید')) {
      return `${baseUrl}tts-cache/retry_2_fa.wav`;
    }
    if (norm.includes('ببخشید') && norm.includes('تکرار کنید')) {
      return `${baseUrl}tts-cache/retry_3_fa.wav`;
    }
    if (norm.includes('در کادر پایین تایپ کنید') || norm.includes('تایپ کنید')) {
      return `${baseUrl}tts-cache/retry_type_fa.wav`;
    }

    // Edit prompt
    if (norm.includes('کدام بخش') && norm.includes('تغییر دهید')) {
      return `${baseUrl}tts-cache/ask_edit_fa.wav`;
    }

    // Occasion date prompt
    if (norm.includes('در چه روز و چه ماهی است')) {
      return `${baseUrl}tts-cache/ask_occasion_date_fa.wav`;
    }

    // Ask Day variants (short & legacy)
    if (norm.includes('برای چه روزی تنظیمش کنم')) return `${baseUrl}tts-cache/ask_day_1_fa.wav`;
    if (norm.includes('چه روزی بهتون یادآوری کنم')) return `${baseUrl}tts-cache/ask_day_2_fa.wav`;
    if (norm.includes('کدوم روز یادتون بندازم')) return `${baseUrl}tts-cache/ask_day_3_fa.wav`;
    if (norm.includes('در چه روزی به شما یادآوری شود')) return `${baseUrl}tts-cache/ask_day_1_fa.wav`;

    // Ask Time variants (short & legacy)
    if (norm.includes('ساعت چند زنگ بزنه')) return `${baseUrl}tts-cache/ask_time_1_fa.wav`;
    if (norm.includes('چه ساعتی خبرتون کنم')) return `${baseUrl}tts-cache/ask_time_2_fa.wav`;
    if (norm.includes('برای چه ساعتی تنظیم بشه')) return `${baseUrl}tts-cache/ask_time_3_fa.wav`;
    if (norm.includes('چه ساعتی برای آلارم')) return `${baseUrl}tts-cache/ask_time_fa.wav`;

    // Location & Idea details
    if (norm.includes('با موقعیت زنده GPS آماده است') || norm.includes('هشدار ورود فعال شود')) {
      return `${baseUrl}tts-cache/ask_location_details_fa.wav`;
    }
    if (norm.includes('توضیح تکمیلی برای این ایده دارید')) {
      return `${baseUrl}tts-cache/ask_idea_details_fa.wav`;
    }

    // Confirm variants (short & legacy)
    if (norm.includes('همه‌چی آماده است؛ ثبتش کنم') || norm.includes('ثبتش کنم؟')) {
      return `${baseUrl}tts-cache/ask_confirm_1_fa.wav`;
    }
    if (norm.includes('مورد تاییده تا ثبت بشه')) {
      return `${baseUrl}tts-cache/ask_confirm_2_fa.wav`;
    }
    if (norm.includes('اطلاعات کامل شد؛ ذخیره کنم') || norm.includes('ذخیره کنم؟')) {
      return `${baseUrl}tts-cache/ask_confirm_3_fa.wav`;
    }
    if (
      norm.includes('آیا مورد تایید است تا ثبت شود') ||
      norm.includes('آماده ذخیره است. آیا مورد تایید است')
    ) {
      return `${baseUrl}tts-cache/ask_confirm_1_fa.wav`;
    }

    // Ask Subject
    if (
      norm.includes('موضوع یادآور') ||
      norm.includes('عنوان این مناسبت') ||
      norm.includes('نام این مکان') ||
      norm.includes('موضوع ایده‌')
    ) {
      return `${baseUrl}tts-cache/ask_subject_fa.wav`;
    }
    return `${baseUrl}tts-cache/welcome_1_fa.wav`;
  }

  // English ('en') preset WAVs
  if (
    lower.includes("go ahead, i'm ready") ||
    lower.includes("please tell me, i'm listening") ||
    lower.includes('what can i save for you') ||
    lower.includes('what reminder, occasion, location, or idea') ||
    lower.includes('what would you like to save')
  ) {
    return `${baseUrl}tts-cache/welcome_en.wav`;
  }
  if (lower.includes('which part you would like to change')) {
    return `${baseUrl}tts-cache/ask_edit_en.wav`;
  }
  if (lower.includes('on what day and month is')) {
    return `${baseUrl}tts-cache/ask_occasion_date_en.wav`;
  }
  if (
    lower.includes('for which day should i set') ||
    lower.includes('what day should i remind you') ||
    lower.includes('which day works for') ||
    lower.includes('on which day or date would you like me to remind you')
  ) {
    return `${baseUrl}tts-cache/ask_day_en.wav`;
  }
  if (
    lower.includes('at what time') ||
    lower.includes('what time should the alarm ring') ||
    lower.includes('what time should i set')
  ) {
    return `${baseUrl}tts-cache/ask_time_en.wav`;
  }
  if (lower.includes('would you like to add a note')) {
    return `${baseUrl}tts-cache/ask_location_details_en.wav`;
  }
  if (lower.includes('if you have any additional details, please share them now')) {
    return `${baseUrl}tts-cache/ask_idea_details_en.wav`;
  }
  if (
    lower.includes('should i save it') ||
    lower.includes('do you confirm saving it') ||
    lower.includes('do you confirm?')
  ) {
    return `${baseUrl}tts-cache/ask_confirm_en.wav`;
  }
  if (
    lower.includes('subject of your reminder') ||
    lower.includes('title of this occasion') ||
    lower.includes('save this location under') ||
    lower.includes('subject of your idea')
  ) {
    return `${baseUrl}tts-cache/ask_subject_en.wav`;
  }
  return `${baseUrl}tts-cache/welcome_en.wav`;
}

/**
 * پردازش مستقیم نمونه‌های 16-bit PCM در فایل WAV برای اعمال دقیق هر ۵ شخصیت صوتی
 * (مستقل از محدودیت‌های مرورگر، اندروید یا WebView)
 */
function applyPersonaToWavBytes(wavBytes: Uint8Array, voicePersona = 'zephyr_warm'): Uint8Array {
  if (
    wavBytes.byteLength <= 44 ||
    wavBytes[0] !== 0x52 || // 'R'
    wavBytes[1] !== 0x49 || // 'I'
    wavBytes[2] !== 0x46 || // 'F'
    wavBytes[3] !== 0x46 // 'F'
  ) {
    return wavBytes;
  }

  const personaConfig: Record<
    string,
    { step: number; filterMode: 'warm' | 'calm' | 'bright' | 'deep' | 'formal'; gain: number }
  > = {
    zephyr_warm: { step: 1.0, filterMode: 'warm', gain: 1.05 },
    kore_calm: { step: 0.9, filterMode: 'calm', gain: 1.04 },
    puck_energetic: { step: 1.13, filterMode: 'bright', gain: 1.08 },
    fenrir_deep: { step: 0.81, filterMode: 'deep', gain: 1.12 },
    charon_formal: { step: 0.93, filterMode: 'formal', gain: 1.08 },
  };

  const cfg = personaConfig[voicePersona] || personaConfig.zephyr_warm;
  const inView = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  const sampleRate = inView.getUint32(24, true) || 16000;
  const pcmOffset = 44;
  const inSamples = Math.floor((wavBytes.byteLength - pcmOffset) / 2);
  if (inSamples < 10) return wavBytes;

  const outSamples = Math.max(1, Math.floor(inSamples / cfg.step));
  const dataSize = outSamples * 2;
  const outBytes = new Uint8Array(44 + dataSize);
  const outView = new DataView(outBytes.buffer);

  // Copy 44-byte WAV header and update sizes
  outBytes.set(wavBytes.subarray(0, 44), 0);
  outView.setUint32(4, 36 + dataSize, true);
  outView.setUint32(24, sampleRate, true);
  outView.setUint32(28, sampleRate * 2, true);
  outView.setUint32(40, dataSize, true);

  let prevOut = 0;
  let prevIn = 0;

  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * cfg.step;
    const idx0 = Math.min(inSamples - 1, Math.floor(srcPos));
    const idx1 = Math.min(inSamples - 1, idx0 + 1);
    const frac = srcPos - idx0;
    const s0 = inView.getInt16(pcmOffset + idx0 * 2, true);
    const s1 = inView.getInt16(pcmOffset + idx1 * 2, true);
    const rawSample = s0 + (s1 - s0) * frac;

    let shaped = rawSample;
    if (cfg.filterMode === 'deep') {
      prevOut = 0.62 * rawSample + 0.38 * prevOut;
      shaped = prevOut * 0.75 + rawSample * 0.35;
    } else if (cfg.filterMode === 'calm') {
      prevOut = 0.74 * rawSample + 0.26 * prevOut;
      shaped = prevOut;
    } else if (cfg.filterMode === 'bright') {
      const high = rawSample - prevIn;
      shaped = rawSample + high * 0.38;
    } else if (cfg.filterMode === 'formal') {
      const high = rawSample - prevIn;
      prevOut = 0.82 * rawSample + 0.18 * prevOut;
      shaped = prevOut + high * 0.22;
    } else {
      prevOut = 0.88 * rawSample + 0.12 * prevOut;
      shaped = prevOut;
    }
    prevIn = rawSample;

    const clamped = Math.max(-32768, Math.min(32767, Math.round(shaped * cfg.gain)));
    outView.setInt16(44 + i * 2, clamped, true);
  }

  return outBytes;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function normalizePersianForArabicStream(text: string): string {
  return text
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/پ/g, 'ب')
    .replace(/ژ/g, 'ز')
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي')
    .replace(/هٔ/g, 'ه')
    .replace(/\u200c/g, ' ');
}

export const prewarmAiAssistantPrompt = (
  text: string,
  language: 'fa' | 'en' = 'fa',
  voicePersona = 'zephyr_warm'
) => {
  if (typeof window === 'undefined') return;
  const cleanText = text.replace(/\s+/g, ' ').trim();
  if (!cleanText) return;

  const baseUrl = ((import.meta as any).env?.BASE_URL || '/').replace(/\/?$/, '/');
  const stepFiles =
    language === 'en'
      ? [
          'welcome_en.wav',
          'ask_subject_en.wav',
          'ask_day_en.wav',
          'ask_time_en.wav',
          'ask_confirm_en.wav',
          'ask_occasion_date_en.wav',
          'ask_location_details_en.wav',
          'ask_idea_details_en.wav',
          'ask_edit_en.wav',
        ]
      : [
          'welcome_1_fa.wav',
          'welcome_2_fa.wav',
          'welcome_3_fa.wav',
          'ask_subject_fa.wav',
          'ask_day_1_fa.wav',
          'ask_day_2_fa.wav',
          'ask_day_3_fa.wav',
          'ask_time_1_fa.wav',
          'ask_time_2_fa.wav',
          'ask_time_3_fa.wav',
          'ask_time_fa.wav',
          'ask_confirm_1_fa.wav',
          'ask_confirm_2_fa.wav',
          'ask_confirm_3_fa.wav',
          'ask_occasion_date_fa.wav',
          'ask_location_details_fa.wav',
          'ask_idea_details_fa.wav',
          'ask_edit_fa.wav',
          'retry_1_fa.wav',
          'retry_2_fa.wav',
          'retry_3_fa.wav',
          'retry_type_fa.wav',
        ];

  for (const fileName of stepFiles) {
    const url = `${baseUrl}tts-cache/${fileName}`;
    const urlCacheKey = `preset_url:${url}`;
    if (ttsRawBytesCache.has(urlCacheKey)) continue;
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (buf && buf.byteLength > 100) {
          ttsRawBytesCache.set(urlCacheKey, {
            bytes: new Uint8Array(buf),
            mimeType: 'audio/wav',
            alreadyPersonaTransformed: false,
          });
        }
      })
      .catch(() => {});
  }
  void voicePersona;
};

/**
 * پخش تضمین‌شده، پایدار و بدون قطعی صدای گوینده هوش مصنوعی با پشتیبانی کامل از هر ۵ کاراکتر صوتی:
 * ۱. فایل‌های صوتی پیش‌ساخته (welcome_fa.wav / welcome_en.wav) با پردازش مستقیم PCM برای هر ۵ صدای گوینده (بدون نیاز به کوئوتا و بدون تاخیر)
 * ۲. سنتز سمت سرور (/api/smart-tts) با کش دیسک دائمی و پردازش موج WAV برای هر ۵ کاراکتر صوتی
 * ۳. پخش از طریق Blob URL روی المان صوتی آنلاک‌شده + پشتیبان Web Audio API با تایم‌اوت ضدقفل
 * ۴. استریم آنلاین و موتور بومی دستگاه برای محیط‌های آفلاین/استاتیک
 */
export const speakAiAssistantPrompt = (options: {
  text: string;
  language?: 'fa' | 'en';
  voicePersona?: string;
  volume?: number;
  onStart?: () => void;
  onDone?: () => void;
}) => {
  const {
    text,
    language = 'fa',
    voicePersona = 'zephyr_warm',
    volume = 1.0,
    onStart,
    onDone,
  } = options;

  const cleanText = (text || '').replace(/\s+/g, ' ').trim();
  const clampedVol = Math.max(0.1, Math.min(1, volume));

  if (!cleanText || typeof window === 'undefined') {
    onDone?.();
    return;
  }

  setNativeSpeechRecognizerMuteGate(false);
  stopAiAssistantPrompt();
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {
    // ignore
  }
  onStart?.();

  const personaMeta =
    AI_VOICE_PERSONAS.find((p) => p.id === voicePersona) || AI_VOICE_PERSONAS[0];
  const isEn = language === 'en';
  const wordsCount = cleanText.split(/\s+/).filter(Boolean).length;
  const minExpectedSpeechMs = Math.min(6200, Math.max(1900, wordsCount * 330));

  let finished = false;
  const finishAndReleaseAudioFocus = () => {
    if (finished) return;
    finished = true;
    if (sharedTtsAudio) {
      try {
        sharedTtsAudio.onended = null;
        sharedTtsAudio.onerror = null;
        sharedTtsAudio.onloadedmetadata = null;
        sharedTtsAudio.pause();
      } catch {
        // ignore
      }
    }
    revokeActiveObjectUrl();
    if (activeAssistantTimer) {
      clearTimeout(activeAssistantTimer);
      activeAssistantTimer = null;
    }
    activeAssistantTimer = setTimeout(() => {
      onDone?.();
    }, 25);
  };

  const playHtmlAudioUrl = (
    url: string,
    applyPlaybackRatePersona: boolean,
    onFail: () => void
  ) => {
    try {
      const audio = getSharedTtsAudioElement() || new Audio();
      audio.onended = null;
      audio.onerror = null;
      audio.onloadedmetadata = null;
      audio.pause();
      audio.volume = clampedVol;
      audio.src = url;

      const targetRate = applyPlaybackRatePersona
        ? Math.max(0.76, Math.min(1.28, personaMeta.rate * (personaMeta.pitch * 0.45 + 0.55)))
        : 1.0;

      let durationWatchdogId: ReturnType<typeof setTimeout> | null = null;
      const clearAudioTimers = () => {
        clearTimeout(safetyId);
        if (durationWatchdogId) {
          clearTimeout(durationWatchdogId);
          durationWatchdogId = null;
        }
      };

      const applyRateAndScheduleDurationWatchdog = () => {
        try {
          (audio as any).preservesPitch = !applyPlaybackRatePersona;
          (audio as any).mozPreservesPitch = !applyPlaybackRatePersona;
          (audio as any).webkitPreservesPitch = !applyPlaybackRatePersona;
          audio.defaultPlaybackRate = targetRate;
          audio.playbackRate = targetRate;

          if (
            !durationWatchdogId &&
            Number.isFinite(audio.duration) &&
            audio.duration > 0.15
          ) {
            const expectedMs = Math.min(
              13000,
              Math.ceil((audio.duration / Math.max(0.6, targetRate)) * 1000) + 420
            );
            durationWatchdogId = setTimeout(() => {
              finishAndReleaseAudioFocus();
            }, expectedMs);
          }
        } catch {
          // ignore
        }
      };

      applyRateAndScheduleDurationWatchdog();
      audio.onloadedmetadata = applyRateAndScheduleDurationWatchdog;

      const startedAt = Date.now();
      const safetyId = setTimeout(
        finishAndReleaseAudioFocus,
        Math.min(11500, minExpectedSpeechMs + 3200)
      );

      audio.onended = () => {
        clearAudioTimers();
        if (Date.now() - startedAt < 180) {
          onFail();
          return;
        }
        finishAndReleaseAudioFocus();
      };

      audio.onerror = () => {
        clearAudioTimers();
        onFail();
      };

      const p = audio.play();
      if (p) {
        p.then(() => {
          applyRateAndScheduleDurationWatchdog();
        }).catch(() => {
          clearAudioTimers();
          onFail();
        });
      }
    } catch {
      onFail();
    }
  };

  const playBytesViaWebAudioBackup = async (
    audioBytes: Uint8Array,
    applyWebAudioPersona: boolean,
    onFail: () => void
  ) => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await Promise.race([
          ctx.resume(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('resume timeout')), 350)),
        ]);
      }
      if (ctx.state !== 'running') {
        onFail();
        return;
      }

      const copyBuf = audioBytes.buffer.slice(
        audioBytes.byteOffset,
        audioBytes.byteOffset + audioBytes.byteLength
      ) as ArrayBuffer;
      const decodedBuffer = await ctx.decodeAudioData(copyBuf);
      if (finished) return;

      const source = ctx.createBufferSource();
      source.buffer = decodedBuffer;
      if (applyWebAudioPersona) {
        source.playbackRate.value = personaMeta.rate;
        if (source.detune) {
          source.detune.value = personaMeta.detuneCents;
        }
      }

      const gainNode = ctx.createGain();
      gainNode.gain.value = clampedVol;

      if (applyWebAudioPersona) {
        const filter = ctx.createBiquadFilter();
        filter.type = personaMeta.filterType;
        filter.frequency.value = personaMeta.filterFreq;
        filter.gain.value = personaMeta.filterGainDb;
        source.connect(filter);
        filter.connect(gainNode);
      } else {
        source.connect(gainNode);
      }
      gainNode.connect(ctx.destination);

      activeWebAudioSource = source;
      const safetyId = setTimeout(finishAndReleaseAudioFocus, 15000);

      source.onended = () => {
        clearTimeout(safetyId);
        if (activeWebAudioSource === source) {
          activeWebAudioSource = null;
        }
        finishAndReleaseAudioFocus();
      };

      source.start(0);
    } catch {
      onFail();
    }
  };

  /**
   * پخش بافر صوتی با اعمال دقیق کاراکتر صوتی انتخاب‌شده:
   * برای فایل‌های WAV، تغییر زیر و بمی و سرعت و فیلتر مستقیماً روی نمونه‌های 16-bit PCM اعمال می‌شود
   * و از طریق Blob URL روی المان صوتی پخش می‌گردد تا در همه مرورگرها و اندروید ۱۰۰٪ بدون قطعی کار کند.
   */
  const playAudioBytesWithPersona = (
    rawBytes: Uint8Array,
    mimeType: string,
    alreadyPersonaTransformed: boolean,
    onFail: () => void
  ) => {
    const isWav =
      mimeType.includes('wav') ||
      (rawBytes.byteLength > 44 &&
        rawBytes[0] === 0x52 &&
        rawBytes[1] === 0x49 &&
        rawBytes[2] === 0x46 &&
        rawBytes[3] === 0x46);

    const finalBytes =
      isWav && !alreadyPersonaTransformed
        ? applyPersonaToWavBytes(rawBytes, personaMeta.id)
        : rawBytes;
    const finalMime = isWav ? 'audio/wav' : mimeType || 'audio/mpeg';
    const needsRateShiftOnElement = !isWav && !alreadyPersonaTransformed;

    try {
      revokeActiveObjectUrl();
      const copyArrayBuffer = finalBytes.buffer.slice(
        finalBytes.byteOffset,
        finalBytes.byteOffset + finalBytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([copyArrayBuffer], { type: finalMime });
      const blobUrl = URL.createObjectURL(blob);
      activeObjectUrl = blobUrl;

      playHtmlAudioUrl(blobUrl, needsRateShiftOnElement, () => {
        playBytesViaWebAudioBackup(finalBytes, needsRateShiftOnElement, onFail);
      });
    } catch {
      playBytesViaWebAudioBackup(finalBytes, needsRateShiftOnElement, onFail);
    }
  };

  const playOnlineStreamFallback = (onFail: () => void) => {
    if (!isEn) {
      // Never use Arabic tl=ar stream for Persian so the accent never changes
      onFail();
      return;
    }
    const primaryUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(
      cleanText
    )}`;
    const secondaryUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=gtx&q=${encodeURIComponent(
      cleanText
    )}`;
    playHtmlAudioUrl(primaryUrl, true, () => {
      playHtmlAudioUrl(secondaryUrl, true, onFail);
    });
  };

  const playNativeSpeechWithVerification = () => {
    if (!('speechSynthesis' in window)) {
      playOnlineStreamFallback(finishAndReleaseAudioFocus);
      return;
    }

    try {
      const voices = window.speechSynthesis.getVoices() || [];
      const matchingVoices = voices.filter((v) => {
        const l = (v.lang || '').toLowerCase();
        const n = (v.name || '').toLowerCase();
        if (isEn) return l.startsWith('en');
        return l.startsWith('fa') || n.includes('persian') || n.includes('farsi');
      });

      const personaIndex = Math.max(
        0,
        AI_VOICE_PERSONAS.findIndex((p) => p.id === personaMeta.id)
      );
      const selectedVoice =
        matchingVoices.length > 0
          ? matchingVoices[personaIndex % matchingVoices.length]
          : undefined;

      if (!isEn && !selectedVoice) {
        finishAndReleaseAudioFocus();
        return;
      }

      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = isEn ? 'en-US' : 'fa-IR';
      utterance.volume = clampedVol;
      utterance.rate = personaMeta.rate;
      utterance.pitch = personaMeta.pitch;
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      const startAt = Date.now();
      let didActuallySpeak = false;
      const maxSafety = setTimeout(
        finishAndReleaseAudioFocus,
        Math.max(8500, minExpectedSpeechMs + 2800)
      );

      const watchdog = setTimeout(() => {
        if (!didActuallySpeak && !window.speechSynthesis.speaking && !finished) {
          clearTimeout(maxSafety);
          window.speechSynthesis.cancel();
          playOnlineStreamFallback(finishAndReleaseAudioFocus);
        }
      }, 650);

      utterance.onstart = () => {
        didActuallySpeak = true;
      };

      utterance.onend = () => {
        clearTimeout(watchdog);
        clearTimeout(maxSafety);
        const elapsed = Date.now() - startAt;
        if (elapsed < 180 && !didActuallySpeak) {
          playOnlineStreamFallback(finishAndReleaseAudioFocus);
          return;
        }
        finishAndReleaseAudioFocus();
      };

      utterance.onerror = () => {
        clearTimeout(watchdog);
        clearTimeout(maxSafety);
        playOnlineStreamFallback(finishAndReleaseAudioFocus);
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      playOnlineStreamFallback(finishAndReleaseAudioFocus);
    }
  };

  // ۱. بررسی کش حافظه (خام یا پردازش‌شده برای کاراکتر صوتی)
  const rawCacheKey = `${language}:raw:${cleanText}`;
  const personaCacheKey = `${language}:${voicePersona}:${cleanText}`;
  const cachedRaw = ttsRawBytesCache.get(rawCacheKey);
  if (cachedRaw) {
    playAudioBytesWithPersona(
      cachedRaw.bytes,
      cachedRaw.mimeType,
      cachedRaw.alreadyPersonaTransformed,
      playNativeSpeechWithVerification
    );
    return;
  }

  const cachedPersona = ttsRawBytesCache.get(personaCacheKey);
  if (cachedPersona) {
    playAudioBytesWithPersona(
      cachedPersona.bytes,
      cachedPersona.mimeType,
      cachedPersona.alreadyPersonaTransformed,
      playNativeSpeechWithVerification
    );
    return;
  }

  // ۲. استفاده مستقیم از فایل‌های WAV پیش‌ساخته در حافظه RAM یا باندل برای تمام مراحل
  const presetUrl = getPresetWavUrl(cleanText, language);
  if (presetUrl) {
    const presetMem = ttsRawBytesCache.get(`preset_url:${presetUrl}`);
    if (presetMem) {
      playAudioBytesWithPersona(
        presetMem.bytes,
        'audio/wav',
        false,
        playNativeSpeechWithVerification
      );
      return;
    }

    fetch(presetUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error('Preset fetch failed');
        const arrBuf = await res.arrayBuffer();
        if (!arrBuf || arrBuf.byteLength < 100) throw new Error('Empty preset');
        const rawBytes = new Uint8Array(arrBuf);
        const entry = {
          bytes: rawBytes,
          mimeType: 'audio/wav',
          alreadyPersonaTransformed: false,
        };
        ttsRawBytesCache.set(`preset_url:${presetUrl}`, entry);
        ttsRawBytesCache.set(rawCacheKey, entry);
        if (finished) return;
        playAudioBytesWithPersona(rawBytes, 'audio/wav', false, playNativeSpeechWithVerification);
      })
      .catch(() => {
        playNativeSpeechWithVerification();
      });
    return;
  }

  const isStaticOrNative =
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'file:' ||
    window.location.hostname.includes('github.io');

  if (isStaticOrNative) {
    playNativeSpeechWithVerification();
    return;
  }

  // ۳. درخواست به سرور (/api/smart-tts) برای جملات پویا در طول گفتگو
  const controller = new AbortController();
  activeAssistantAbort = controller;
  const fetchTimeout = setTimeout(() => controller.abort(), 7500);

  fetch('/api/smart-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: cleanText,
      language,
      voicePersona,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      clearTimeout(fetchTimeout);
      if (!res.ok) throw new Error('TTS HTTP error');
      const data = await res.json();
      if (!data?.ok || !data?.audioBase64) throw new Error('No audioBase64');
      const mimeType = data.mimeType || 'audio/wav';
      const isServerWav = mimeType.includes('wav');
      const bytes = base64ToUint8Array(data.audioBase64);
      ttsRawBytesCache.set(personaCacheKey, {
        bytes,
        mimeType,
        alreadyPersonaTransformed: isServerWav,
      });
      if (finished) return;
      playAudioBytesWithPersona(
        bytes,
        mimeType,
        isServerWav,
        playNativeSpeechWithVerification
      );
    })
    .catch(() => {
      clearTimeout(fetchTimeout);
      if (!finished) {
        playNativeSpeechWithVerification();
      }
    });
};


