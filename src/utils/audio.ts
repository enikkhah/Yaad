// Web Audio API synthesizer for category ring tunes, phone alarm sounds, and TTS voice announcements
import { Category, PhoneAlarmSound } from '../types';

let audioCtx: AudioContext | null = null;
let alarmIntervalId: number | null = null;
let activeAlarmAudio: HTMLAudioElement | null = null;
let previewAudio: HTMLAudioElement | null = null;
let isAlarmLooping: boolean = false;
let globalAlarmVolume: number = 0.85; // 0.0 to 1.0

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

/**
 * Unlocks Web Audio API on first user touch/click so background timers can play sound reliably.
 */
export const unlockAudio = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Play silent 1ms buffer to unlock iOS/Android WebView audio
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
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
    const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
    if (vol <= 0.001) return;

    const soundFile = SOUND_FILE_MAP[sound] || SOUND_FILE_MAP[sound.replace(/-/g, '_')];
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
  volumeOverride?: number
) => {
  stopAlarmRinging();
  isAlarmLooping = true;

  const effectiveSound = resolveAlarmSound(alarmSound, 'digital_beep');
  const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
  const clampedVol = Math.max(0, Math.min(1, vol));
  const soundFile = SOUND_FILE_MAP[effectiveSound] || SOUND_FILE_MAP[effectiveSound.replace(/-/g, '_')] || 'digital_beep.wav';

  // 1. Setup persistent looping HTMLAudioElement so the single MediaPlayer instance loops continuously
  if (typeof window !== 'undefined' && clampedVol > 0.001) {
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

    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([500, 200, 500, 200, 500]);
      } catch {
        // Ignore vibration errors on unsupported browsers
      }
    }

    if (clampedVol > 0.001) {
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
