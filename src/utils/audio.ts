// Web Audio API synthesizer for category ring tunes, phone alarm sounds, and TTS voice announcements
import { Category, PhoneAlarmSound } from '../types';

let audioCtx: AudioContext | null = null;
let alarmIntervalId: number | null = null;
let globalAlarmVolume: number = 0.85; // 0.0 to 1.0

export const setGlobalVolume = (vol: number) => {
  globalAlarmVolume = Math.max(0, Math.min(1, vol));
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

export const PHONE_ALARM_SOUNDS: { id: PhoneAlarmSound; label: string; desc: string }[] = [
  { id: 'digital-beep', label: 'زنگ دیجیتال کلاسیک', desc: 'بوق استاندارد ساعت‌های دیجیتال (پیشنهادی)' },
  { id: 'radar', label: 'آلارم پالس رادار', desc: 'صدای موجی و ملایم مشابه هشدار گوشی‌های هوشمند' },
  { id: 'marimba', label: 'ملودی ماریمبا و چوب', desc: 'ریتم گرم و دلنشین چوبی با گام بالارونده' },
  { id: 'morning-chime', label: 'زنگ ملایم صبحگاهی', desc: 'زنگ آرام و شفاف برای یادآوری بدون استرس' },
  { id: 'zen-bowl', label: 'کاسه تبتی آرامش‌بخش', desc: 'طنین عمیق، ملایم و آرامش‌بخش مدیتیشن' },
  { id: 'soft-harp', label: 'آرپژ چنگ ملایم', desc: 'نوازشگر، لطیف و رویایی با نت‌های نرم چنگ' },
  { id: 'ocean-drop', label: 'قطرات آرام آب', desc: 'صدای لطیف و طبیعی چکه آب در سکوت آرام' },
  { id: 'wind-chimes', label: 'نسیم و زنگوله بادی', desc: 'طنین زنگوله‌های بادی کریستالی و بسیار ملایم' },
  { id: 'warm-pad', label: 'موج گرم و آرامش‌بخش', desc: 'پد صوتی نرم و تدریجی بدون هیچ‌گونه شوک صوتی' },
  { id: 'calm-piano', label: 'پیانوی آرام شبانه', desc: 'آکوردهای ملایم و دلنشین پیانو برای آرامش ذهن' },
];

const VALID_ALARM_SOUND_IDS = new Set<string>(PHONE_ALARM_SOUNDS.map((s) => s.id));

/**
 * Resolves the effective PhoneAlarmSound from a reminder's ringTune or global settings.
 * Priority:
 * 1. Valid PhoneAlarmSound stored in reminder.ringTune
 * 2. Valid PhoneAlarmSound in fallbackAlarmSound (settings.alarmSound)
 * 3. Default 'digital-beep'
 */
export const resolveAlarmSound = (
  ringTune?: string,
  fallbackAlarmSound?: PhoneAlarmSound
): PhoneAlarmSound => {
  if (ringTune && VALID_ALARM_SOUND_IDS.has(ringTune)) {
    return ringTune as PhoneAlarmSound;
  }
  if (fallbackAlarmSound && VALID_ALARM_SOUND_IDS.has(fallbackAlarmSound)) {
    return fallbackAlarmSound;
  }
  return 'digital-beep';
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

/**
 * Play selected phone alarm sound pattern
 */
export const playPhoneAlarmSound = (sound: PhoneAlarmSound, volumeOverride?: number) => {
  try {
    const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;
    if (vol <= 0.001) return;

    const ctx = getAudioContext();
    const now = ctx.currentTime;

    if (sound === 'digital-beep') {
      // Classic digital watch/phone double-beep-beep: 4 rapid 880Hz pulses
      const pulses = [0, 0.14, 0.28, 0.42];
      pulses.forEach((offset) => {
        playTone(ctx, 987.77, now + offset, 0.09, 'square', 0.16, vol); // B5
      });
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
    } else if (sound === 'morning-chime') {
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
    } else if (sound === 'urgent-bell') {
      // Urgent dual-frequency bell ring
      for (let i = 0; i < 6; i++) {
        const freq = i % 2 === 0 ? 880 : 1174.66; // A5 / D6
        playTone(ctx, freq, now + i * 0.11, 0.1, 'sawtooth', 0.18, vol);
      }
    }
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

/**
 * Starts continuous phone alarm ringing (loops every 1.8s) + vibration if supported
 */
export const startAlarmRinging = (
  category: Category,
  alarmSound: PhoneAlarmSound = 'digital-beep',
  volumeOverride?: number
) => {
  stopAlarmRinging();

  const effectiveSound = resolveAlarmSound(alarmSound, 'digital-beep');
  const vol = volumeOverride !== undefined ? volumeOverride : globalAlarmVolume;

  const triggerCycle = () => {
    playPhoneAlarmSound(effectiveSound, vol);
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([300, 150, 300]);
      } catch {
        // Ignore vibration errors on unsupported browsers
      }
    }
  };

  triggerCycle();
  alarmIntervalId = window.setInterval(triggerCycle, 1800);
};

export const stopAlarmRinging = () => {
  if (alarmIntervalId !== null) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
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
  category: Category,
  rate = 1.0,
  lang: 'fa' | 'en' = 'fa'
) => {
  if (!('speechSynthesis' in window)) return;

  try {
    window.speechSynthesis.cancel();
    let text = '';
    if (lang === 'en') {
      const categoryLabel =
        category === 'work' ? 'Work' : category === 'family' ? 'Family' : 'General';
      text = `Reminder for ${categoryLabel}: ${title}`;
    } else {
      const categoryLabel =
        category === 'work' ? 'کاری' : category === 'family' ? 'خانوادگی' : 'عمومی';
      text = `یادآورِ ${categoryLabel}: ${title}`;
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
