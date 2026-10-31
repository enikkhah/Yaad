import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  Send,
  X,
  Bell,
  Cake,
  MapPin,
  Lightbulb,
  Sparkles,
  Check,
  Volume2,
  VolumeX,
  Navigation,
} from 'lucide-react';
import { AiVoicePersona, IdeaNote, Occasion, Reminder, SavedLocation } from '../types';
import {
  PERSIAN_MONTHS,
  formatJalaliFull,
  getJalaliComponents,
  toPersianDigits,
} from '../utils/jalali';
import {
  prewarmAiAssistantPrompt,
  speakAiAssistantPrompt,
  stopAiAssistantPrompt,
  unlockAudio,
} from '../utils/audio';
import { requestLocationPermission, markPermissionGranted } from '../utils/nativePermissions';
import { saveLastKnownPosition } from '../utils/geofenceManager';
import { appendWithoutDuplicate, safeAbortSpeechRecognition } from '../utils/speechDeduplication';
import {
  SmartCaptureDraft,
  SmartChatMessage,
  SmartIntentType,
  analyzeSmartCaptureTurn,
  computeReminderTimestampFromDraft,
  isConfirmationUtterance,
} from '../utils/smartCaptureAi';

interface SmartVoiceCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveReminder: (
    data: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'postponeCount'>,
    syncGoogle?: boolean,
    stayOnCurrentTab?: boolean
  ) => void;
  onSaveOccasion: (data: Omit<Occasion, 'id' | 'createdAt'>, alsoCreateReminder?: boolean) => void;
  onSaveLocation: (data: Omit<SavedLocation, 'id' | 'createdAt'>, alsoCreateReminder?: boolean) => void;
  onSaveIdea: (data: Omit<IdeaNote, 'id' | 'createdAt'>) => void;
  language?: 'fa' | 'en';
  aiVoicePersona?: AiVoicePersona;
  aiVoiceVolume?: number;
  ttsVoiceRate?: number;
  micSensitivity?: number;
  micBaseFrequencyHz?: number;
}

export const SmartVoiceCaptureModal: React.FC<SmartVoiceCaptureModalProps> = ({
  isOpen,
  onClose,
  onSaveReminder,
  onSaveOccasion,
  onSaveLocation,
  onSaveIdea,
  language = 'fa',
  aiVoicePersona = 'zephyr_warm',
  aiVoiceVolume = 1.0,
  ttsVoiceRate = 0.95,
  micSensitivity = 75,
  micBaseFrequencyHz = 165,
}) => {
  const isEn = language === 'en';

  const [messages, setMessages] = useState<SmartChatMessage[]>([]);
  const [draft, setDraft] = useState<SmartCaptureDraft>({ intentType: 'unknown' });
  const [isComplete, setIsComplete] = useState(false);
  const [inputText, setInputText] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [voiceFeedbackEnabled, setVoiceFeedbackEnabled] = useState(true);

  // Real live GPS state (strictly live hardware GPS with maximumAge: 0; never cached or mock coordinates)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'fetching' | 'ready' | 'error'>('idle');
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const sessionStartTimeRef = useRef<number>(0);
  const lastSpeechTimeRef = useRef<number>(0);
  const accumulatedFinalRef = useRef<string>('');
  const latestInterimRef = useRef<string>('');
  const lastFinalChunkRef = useRef<string>('');
  const processedFinalIndicesRef = useRef<Set<number>>(new Set());

  // Silent Web Audio VAD refs (keeps microphone active without Android system beeps)
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const handleUserUtteranceRef = useRef<(text: string) => void>(() => {});
  const isOpenRef = useRef(isOpen);
  const draftRef = useRef(draft);
  const isCompleteRef = useRef(isComplete);
  const voiceEnabledRef = useRef(voiceFeedbackEnabled);
  const gpsCoordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const micSensitivityRef = useRef<number>(micSensitivity);
  const micBaseFreqRef = useRef<number>(micBaseFrequencyHz);
  const aiVoicePersonaRef = useRef<AiVoicePersona>(aiVoicePersona);
  const aiVoiceVolumeRef = useRef<number>(aiVoiceVolume);
  const ttsVoiceRateRef = useRef<number>(ttsVoiceRate);

  const speechDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    isCompleteRef.current = isComplete;
  }, [isComplete]);

  useEffect(() => {
    voiceEnabledRef.current = voiceFeedbackEnabled;
  }, [voiceFeedbackEnabled]);

  useEffect(() => {
    gpsCoordsRef.current = gpsCoords;
  }, [gpsCoords]);

  useEffect(() => {
    micSensitivityRef.current = micSensitivity;
  }, [micSensitivity]);

  useEffect(() => {
    micBaseFreqRef.current = micBaseFrequencyHz;
  }, [micBaseFrequencyHz]);

  useEffect(() => {
    aiVoicePersonaRef.current = aiVoicePersona;
  }, [aiVoicePersona]);

  useEffect(() => {
    aiVoiceVolumeRef.current = aiVoiceVolume;
  }, [aiVoiceVolume]);

  useEffect(() => {
    ttsVoiceRateRef.current = ttsVoiceRate;
  }, [ttsVoiceRate]);

  const stopSilentVadMonitor = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (vadStreamRef.current) {
      try {
        vadStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      vadStreamRef.current = null;
    }
    if (vadAudioCtxRef.current) {
      try {
        vadAudioCtxRef.current.close().catch(() => {});
      } catch {
        // ignore
      }
      vadAudioCtxRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    setIsAssistantSpeaking(false);
    if (ttsWaitTimerRef.current) {
      clearTimeout(ttsWaitTimerRef.current);
      ttsWaitTimerRef.current = null;
    }
    stopAiAssistantPrompt();
  }, []);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    stopSilentVadMonitor();
    if (speechDoneTimerRef.current) {
      clearTimeout(speechDoneTimerRef.current);
      speechDoneTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        safeAbortSpeechRecognition(recognitionRef.current);
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsSpeechActive(false);
    setVoiceLevel(0);
  }, [stopSilentVadMonitor]);

  /**
   * دریافت موقعیت مکانی زنده و واقعی از سنسور GPS دستگاه (maximumAge: 0)
   * بدون استفاده از مختصات فرضی یا مختصات ذخیره‌شده قبلی در حافظه
   */
  const acquireLiveGpsCoordinates = useCallback((): Promise<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null> => {
    setGpsStatus('fetching');
    setGpsErrorMsg(null);

    return new Promise((resolve) => {
      requestLocationPermission()
        .then(() => {
          if (typeof navigator === 'undefined' || !navigator.geolocation) {
            const errText = isEn
              ? 'Live GPS is not supported on this device.'
              : 'سرویس موقعیت‌یاب GPS در این دستگاه در دسترس نیست.';
            setGpsStatus('error');
            setGpsErrorMsg(errText);
            resolve(null);
            return;
          }

          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const liveFix = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              };
              setGpsCoords(liveFix);
              gpsCoordsRef.current = liveFix;
              setGpsStatus('ready');
              setGpsErrorMsg(null);
              saveLastKnownPosition({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: Date.now(),
              });
              resolve(liveFix);
            },
            () => {
              navigator.geolocation.getCurrentPosition(
                (pos2) => {
                  const liveFix = {
                    lat: pos2.coords.latitude,
                    lng: pos2.coords.longitude,
                    accuracy: pos2.coords.accuracy,
                  };
                  setGpsCoords(liveFix);
                  gpsCoordsRef.current = liveFix;
                  setGpsStatus('ready');
                  setGpsErrorMsg(null);
                  saveLastKnownPosition({
                    latitude: pos2.coords.latitude,
                    longitude: pos2.coords.longitude,
                    accuracy: pos2.coords.accuracy,
                    timestamp: Date.now(),
                  });
                  resolve(liveFix);
                },
                () => {
                  const errText = isEn
                    ? 'Unable to receive live GPS signal. Please turn on your device location (GPS) and try again.'
                    : 'سیگنال زنده GPS دریافت نشد. لطفاً مکان‌یاب (GPS) گوشی خود را روشن کرده و دوباره تلاش کنید.';
                  setGpsStatus('error');
                  setGpsErrorMsg(errText);
                  resolve(null);
                },
                { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 }
              );
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
          );
        })
        .catch(() => {
          const errText = isEn
            ? 'Location permission was not granted. Please enable GPS permission.'
            : 'مجوز دسترسی به موقعیت مکانی (GPS) داده نشد.';
          setGpsStatus('error');
          setGpsErrorMsg(errText);
          resolve(null);
        });
    });
  }, [isEn]);

  // Pre-warm voices list and server TTS cache for the initial greeting
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const welcomeText = isEn
      ? 'Hello! Please tell me what reminder, occasion, location, or idea you would like to save?'
      : 'سلام، وقت بخیر. لطفاً بفرمایید چه یادآور، مناسبت، مکان یا ایده‌ای را می‌خواهید ثبت کنید؟';
    prewarmAiAssistantPrompt(welcomeText, isEn ? 'en' : 'fa', aiVoicePersona);
  }, [isEn, aiVoicePersona]);

  /**
   * بیان صوتی صمیمانه و محترمانه بدون هیچ افکت صوتی اضافی:
   * از موتور چندلایه speakAiAssistantPrompt استفاده می‌کند (WAV استاندارد + فال‌بک جریان آنلاین فارسی/انگلیسی + سنتز بومی)
   * و پس از اتمام کامل صحبت گوینده و آزاد شدن فوکوس صوتی اندروید، میکروفون فعال می‌شود.
   */
  const speakPromptWithCallback = useCallback(
    (rawText: string, onDone?: () => void) => {
      const cleanText = rawText.replace(/\s+/g, ' ').trim();
      if (!voiceEnabledRef.current || !cleanText || typeof window === 'undefined') {
        onDone?.();
        return;
      }

      stopListening();
      stopSpeaking();
      setIsAssistantSpeaking(true);

      speakAiAssistantPrompt({
        text: cleanText,
        language: isEn ? 'en' : 'fa',
        voicePersona: aiVoicePersonaRef.current,
        volume: aiVoiceVolumeRef.current,
        onDone: () => {
          if (!isOpenRef.current) {
            setIsAssistantSpeaking(false);
            return;
          }
          setIsAssistantSpeaking(false);
          // مکث کوتاه برای آزادسازی کامل کانال صوتی اندروید پیش از روشن شدن میکروفون
          ttsWaitTimerRef.current = setTimeout(() => {
            if (isOpenRef.current) {
              onDone?.();
            }
          }, 480);
        },
      });
    },
    [isEn, stopListening, stopSpeaking]
  );

  // Auto-scroll conversation
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveTranscript, isAnalyzing]);

  /**
   * میکروفون پایدار و بدون بوق مکرر:
   * ۱. پس از پایان صدای گوینده فعال می‌شود.
   * ۲. به‌جای فراخوانی مکرر rec.start() در حلقه onend (که در اندروید هر ۴ ثانیه صدای بوق سیستم ایجاد می‌کرد)،
   *    در صورت سکوت اولیه کاربر، به پایشگر کاملاً بی‌صدای فرکانس پایه (Web Audio AnalyserNode) سوئیچ می‌کند
   *    تا میکروفون بدون هیچ بوقی روشن و آماده شنیدن صدای کاربر بر اساس «فرکانس مبنا» و «حساسیت میکروفون» باقی بماند.
   */
  const startListening = useCallback(() => {
    if (!isOpenRef.current || typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsListening(false);
      return;
    }

    stopSpeaking();
    stopSilentVadMonitor();

    if (speechDoneTimerRef.current) {
      clearTimeout(speechDoneTimerRef.current);
      speechDoneTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        safeAbortSpeechRecognition(recognitionRef.current);
      }
      recognitionRef.current = null;
    }

    shouldKeepListeningRef.current = true;
    sessionStartTimeRef.current = Date.now();
    lastSpeechTimeRef.current = 0;
    accumulatedFinalRef.current = '';
    latestInterimRef.current = '';
    lastFinalChunkRef.current = '';
    processedFinalIndicesRef.current.clear();
    setLiveTranscript('');
    setIsListening(true);

    let hasCommitted = false;
    let initialFocusRetryDone = false;

    const commitCapturedSpeech = () => {
      if (hasCommitted) return;
      const combined = appendWithoutDuplicate(
        accumulatedFinalRef.current,
        latestInterimRef.current
      ).trim();

      if (!combined) return;
      hasCommitted = true;
      shouldKeepListeningRef.current = false;
      stopSilentVadMonitor();

      if (speechDoneTimerRef.current) {
        clearTimeout(speechDoneTimerRef.current);
        speechDoneTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onstart = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {
          safeAbortSpeechRecognition(recognitionRef.current);
        }
        recognitionRef.current = null;
      }

      setIsListening(false);
      setIsSpeechActive(false);
      setVoiceLevel(0);
      setLiveTranscript('');
      setInputText('');
      handleUserUtteranceRef.current(combined);
    };

    const schedulePostSpeechCommit = (baseDelayMs = 1950) => {
      if (speechDoneTimerRef.current) {
        clearTimeout(speechDoneTimerRef.current);
      }
      // حساسیت بالاتر میکروفون، فرصت مکث بین کلمات را کمی بیشتر می‌کند تا جمله کاربر کامل شنیده شود
      const sens = micSensitivityRef.current ?? 75;
      const sensitivityBonusMs = Math.round((sens - 50) * 6);
      const effectiveDelayMs = Math.max(1150, baseDelayMs + sensitivityBonusMs);

      speechDoneTimerRef.current = setTimeout(() => {
        commitCapturedSpeech();
      }, effectiveDelayMs);
    };

    /**
     * پایشگر کاملاً بی‌صدای فرکانس صدای کاربر (Web Audio API با کالیبراسیون تطبیقی نویز محیط):
     * بدون ایجاد هیچ بوق سیستمی در اندروید، میکروفون را تا ۶۰ ثانیه روشن و آماده نگه می‌دارد.
     * ابتدا سطح نویز پایه محیط (Noise Floor) را کالیبره می‌کند تا در سکوت هرگز به‌اشتباه فعال نشود
     * و فقط با شروع واقعی صحبت کاربر در محدوده «فرکانس مبنا» و «حساسیت میکروفون»، تشخیص گفتار را فعال می‌کند.
     */
    const startSilentFrequencyMonitor = () => {
      if (!shouldKeepListeningRef.current || !isOpenRef.current || hasCommitted) return;
      stopSilentVadMonitor();

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setIsListening(true);
        setIsSpeechActive(false);
        return;
      }

      setIsListening(true);
      setIsSpeechActive(false);

      navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        .then((stream) => {
          if (!shouldKeepListeningRef.current || !isOpenRef.current || hasCommitted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }

          vadStreamRef.current = stream;
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx: AudioContext = new AudioCtx();
          vadAudioCtxRef.current = audioCtx;

          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.minDecibels = -85;
          analyser.maxDecibels = -10;
          analyser.smoothingTimeConstant = 0.5;
          source.connect(analyser);

          const freqBins = new Uint8Array(analyser.frequencyBinCount);
          const timeData = new Uint8Array(analyser.fftSize);
          let consecutiveVoiceFrames = 0;
          let calibrationFrames = 0;
          let baselineBandEnergy = 0;
          let baselineRms = 0;

          vadIntervalRef.current = setInterval(() => {
            if (!shouldKeepListeningRef.current || !isOpenRef.current || hasCommitted) {
              stopSilentVadMonitor();
              return;
            }

            if (Date.now() - sessionStartTimeRef.current > 60000) {
              stopListening();
              return;
            }

            analyser.getByteFrequencyData(freqBins);
            analyser.getByteTimeDomainData(timeData);

            // ۱. محاسبه دامنه واقعی موج صوتی (Time-Domain RMS) برای تمایز قطعی سکوت از صدای واقعی
            let sumSq = 0;
            for (let i = 0; i < timeData.length; i++) {
              const centered = (timeData[i] - 128) / 128;
              sumSq += centered * centered;
            }
            const currentRms = Math.sqrt(sumSq / timeData.length) * 100;

            // ۲. محاسبه انرژی در باند فرکانس پایه و هارمونیک اول صدای انسان حول فرکانس مبنای انتخابی کاربر
            const sampleRate = audioCtx.sampleRate || 44100;
            const binHz = sampleRate / analyser.fftSize;
            const baseHz = Math.max(80, Math.min(350, micBaseFreqRef.current || 165));
            const sens = Math.max(10, Math.min(100, micSensitivityRef.current || 75));

            const minFreq = Math.max(75, baseHz * 0.75);
            const maxFreq = Math.min(950, baseHz * 2.8);
            const startBin = Math.max(1, Math.floor(minFreq / binHz));
            const endBin = Math.min(freqBins.length - 1, Math.ceil(maxFreq / binHz));

            let sumEnergy = 0;
            let peakEnergy = 0;
            let count = 0;
            for (let b = startBin; b <= endBin; b++) {
              const val = freqBins[b];
              sumEnergy += val;
              if (val > peakEnergy) peakEnergy = val;
              count++;
            }

            const avgBandEnergy = count > 0 ? sumEnergy / count : 0;
            const weightedBandEnergy = avgBandEnergy * 0.7 + peakEnergy * 0.3;

            // ۳. کالیبراسیون اولیه نویز محیط در ۸ فریم اول (~۶۴۰ میلی‌ثانیه) تا هیچ بوق یا نویز ثابتی باعث تحریک کاذب نشود
            if (calibrationFrames < 8) {
              calibrationFrames += 1;
              baselineBandEnergy =
                calibrationFrames === 1
                  ? weightedBandEnergy
                  : baselineBandEnergy * 0.75 + weightedBandEnergy * 0.25;
              baselineRms =
                calibrationFrames === 1 ? currentRms : baselineRms * 0.75 + currentRms * 0.25;
              setVoiceLevel(0);
              return;
            }

            const energyRise = Math.max(0, weightedBandEnergy - baselineBandEnergy);
            const rmsRise = Math.max(0, currentRms - baselineRms);

            // آستانه افزایش انرژی نسبت به نویز محیط بر اساس اسلایدر حساسیت میکروفون (۱۰٪ تا ۱۰۰٪)
            const requiredEnergyRise = Math.max(16, Math.round(48 - sens * 0.3));
            const requiredRmsRise = Math.max(2.0, (115 - sens) * 0.055);

            const normalizedLevel = Math.min(
              100,
              Math.round((energyRise / Math.max(16, requiredEnergyRise)) * 45)
            );
            setVoiceLevel(normalizedLevel > 8 ? normalizedLevel : 0);

            if (energyRise >= requiredEnergyRise && rmsRise >= requiredRmsRise) {
              consecutiveVoiceFrames += 1;
              if (consecutiveVoiceFrames >= 3) {
                // شروع واقعی صحبت کاربر تشخیص داده شد -> آزادسازی استریم پایش و شروع تشخیص گفتار
                stopSilentVadMonitor();
                setIsSpeechActive(true);
                setVoiceLevel(75);
                createAndRunRecognition();
              }
            } else {
              consecutiveVoiceFrames = Math.max(0, consecutiveVoiceFrames - 1);
              // به‌روزرسانی آرام سطح نویز پایه محیط در حالت سکوت
              baselineBandEnergy = baselineBandEnergy * 0.94 + weightedBandEnergy * 0.06;
              baselineRms = baselineRms * 0.94 + currentRms * 0.06;
            }
          }, 80);
        })
        .catch(() => {
          setIsListening(false);
          setIsSpeechActive(false);
        });
    };

    const createAndRunRecognition = () => {
      if (!shouldKeepListeningRef.current || !isOpenRef.current || hasCommitted) return;

      stopSilentVadMonitor();

      try {
        const rec = new SpeechRecognition();
        rec.lang = isEn ? 'en-US' : 'fa-IR';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        processedFinalIndicesRef.current.clear();

        const instanceStartAt = Date.now();
        let instanceHeardSpeech = false;

        rec.onstart = () => {
          if (!shouldKeepListeningRef.current) return;
          setIsListening(true);
          markPermissionGranted('microphone');
        };

        rec.onsoundstart = () => {
          setIsSpeechActive(true);
          setVoiceLevel(60);
        };

        rec.onspeechstart = () => {
          instanceHeardSpeech = true;
          setIsSpeechActive(true);
          setVoiceLevel(80);
        };

        rec.onresult = (event: any) => {
          if (hasCommitted) return;

          instanceHeardSpeech = true;
          setIsSpeechActive(true);
          setVoiceLevel(55 + Math.floor(Math.random() * 40));

          let interimText = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            const bestTranscript = (res[0]?.transcript || '').trim();
            if (!bestTranscript) continue;

            if (res.isFinal) {
              if (!processedFinalIndicesRef.current.has(i)) {
                processedFinalIndicesRef.current.add(i);
                if (bestTranscript !== lastFinalChunkRef.current) {
                  lastFinalChunkRef.current = bestTranscript;
                  lastSpeechTimeRef.current = Date.now();
                  accumulatedFinalRef.current = appendWithoutDuplicate(
                    accumulatedFinalRef.current,
                    bestTranscript
                  );
                }
              }
            } else {
              interimText += bestTranscript + ' ';
            }
          }

          const cleanInterim = interimText.trim();
          latestInterimRef.current = cleanInterim;
          if (cleanInterim) {
            lastSpeechTimeRef.current = Date.now();
          }

          const currentConvertedText = appendWithoutDuplicate(
            accumulatedFinalRef.current,
            cleanInterim
          ).trim();

          if (currentConvertedText) {
            setLiveTranscript(currentConvertedText);
            setInputText(currentConvertedText);
            const isShortConfirm = isConfirmationUtterance(currentConvertedText);
            schedulePostSpeechCommit(isShortConfirm ? 1050 : 1850);
          }
        };

        rec.onerror = (e: any) => {
          if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
            stopListening();
            return;
          }
        };

        rec.onend = () => {
          recognitionRef.current = null;
          if (hasCommitted) return;

          if (latestInterimRef.current.trim()) {
            accumulatedFinalRef.current = appendWithoutDuplicate(
              accumulatedFinalRef.current,
              latestInterimRef.current.trim()
            );
            latestInterimRef.current = '';
          }

          if (!shouldKeepListeningRef.current || !isOpenRef.current) {
            setIsListening(false);
            setIsSpeechActive(false);
            setVoiceLevel(0);
            return;
          }

          const hasSpokenAnything = Boolean(accumulatedFinalRef.current.trim());
          const now = Date.now();
          const instanceDuration = now - instanceStartAt;

          // اگر کاربر صحبتی کرده باشد، بلافاصله جمله او ثبت و پردازش شود
          if (hasSpokenAnything) {
            commitCapturedSpeech();
            return;
          }

          // اگر بلافاصله پس از آزادسازی کانال صوتی (< 350ms) بسته شد، فقط یک‌بار پس از ۶۰۰ میلی‌ثانیه باز شود
          if (!instanceHeardSpeech && instanceDuration < 350 && !initialFocusRetryDone) {
            initialFocusRetryDone = true;
            reconnectTimerRef.current = setTimeout(() => {
              if (shouldKeepListeningRef.current && isOpenRef.current && !hasCommitted) {
                createAndRunRecognition();
              }
            }, 600);
            return;
          }

          // جلوگیری کامل از حلقه بوق‌های مکرر اندروید:
          // در صورت سکوت کاربر، پایشگر بی‌صدای کالیبره‌شده فعال می‌شود و تا زمانی که کاربر واقعاً صحبت نکند rec.start() صدا زده نمی‌شود
          if (now - sessionStartTimeRef.current < 60000) {
            startSilentFrequencyMonitor();
          } else {
            stopListening();
          }
        };

        recognitionRef.current = rec;
        rec.start();
      } catch {
        startSilentFrequencyMonitor();
      }
    };

    createAndRunRecognition();
  }, [isEn, stopListening, stopSilentVadMonitor, stopSpeaking]);

  const executeFinalSave = useCallback(
    async (finalDraft: SmartCaptureDraft) => {
      stopListening();
      stopSpeaking();

      const targetIntent = finalDraft.intentType === 'unknown' ? 'reminder' : finalDraft.intentType;
      const cleanTitle = (finalDraft.title || '').trim();
      if (!cleanTitle) return;

      if (targetIntent === 'reminder') {
        const dueTimestamp = computeReminderTimestampFromDraft(finalDraft);
        onSaveReminder({
          title: cleanTitle,
          description: finalDraft.description || '',
          category: finalDraft.category || 'other',
          priority: finalDraft.priority || 'medium',
          dueTimestamp,
          ringTune: finalDraft.category || 'other',
          voiceReadAloud: false,
          sourceApp: 'voice',
          recurrence: finalDraft.recurrence || 'none',
        });
        onClose();
        return;
      }

      if (targetIntent === 'occasion') {
        const nowJalali = getJalaliComponents(Date.now());
        onSaveOccasion(
          {
            title: cleanTitle,
            personName: finalDraft.personName || '',
            type: finalDraft.occasionType || 'birthday',
            solarYear: finalDraft.solarYear || undefined,
            solarMonth: finalDraft.solarMonth || nowJalali.month,
            solarDay: finalDraft.solarDay || nowJalali.day,
            notifyDaysBefore: 1,
            notifyTime: '09:00',
            customNote: finalDraft.description || '',
          },
          true
        );
        onClose();
        return;
      }

      if (targetIntent === 'location') {
        // الزام استفاده از ورودی زنده و واقعی GPS (بدون مختصات فرضی یا کش‌شده قبلی)
        let livePosition = gpsCoordsRef.current;
        if (!livePosition) {
          livePosition = await acquireLiveGpsCoordinates();
        }

        if (!livePosition) {
          const gpsFailMsg = isEn
            ? 'Could not get live GPS coordinates. Please make sure your device GPS is turned on and confirm again.'
            : 'دریافت موقعیت زنده GPS امکان‌پذیر نشد. لطفاً از روشن بودن GPS گوشی مطمئن شوید و دوباره تایید بفرمایید.';
          setMessages((prev) => [
            ...prev,
            { id: 'gps_err_' + Date.now(), role: 'assistant', text: gpsFailMsg, timestamp: Date.now() },
          ]);
          speakPromptWithCallback(gpsFailMsg, () => {
            if (isOpenRef.current) startListening();
          });
          return;
        }

        onSaveLocation(
          {
            title: cleanTitle,
            description: finalDraft.description || '',
            address: finalDraft.locationAddress || '',
            latitude: livePosition.lat,
            longitude: livePosition.lng,
            googleMapsUrl: `https://www.google.com/maps?q=${livePosition.lat},${livePosition.lng}`,
            geofence: finalDraft.enableGeofence
              ? {
                  enabled: true,
                  radius: 200,
                  triggerOn: 'enter',
                  playAudio: true,
                }
              : undefined,
          },
          false
        );
        onClose();
        return;
      }

      onSaveIdea({
        title: cleanTitle,
        content: finalDraft.description || cleanTitle,
        category: finalDraft.category || 'other',
        tags: [isEn ? 'Smart Capture' : 'ثبت هوشمند'],
      });
      onClose();
    },
    [
      acquireLiveGpsCoordinates,
      isEn,
      onClose,
      onSaveIdea,
      onSaveLocation,
      onSaveOccasion,
      onSaveReminder,
      speakPromptWithCallback,
      startListening,
      stopListening,
      stopSpeaking,
    ]
  );

  // گام ۱: هنگام باز شدن مدال، سوال صمیمانه و محترمانه پرسیده شده و میکروفون بلافاصله حداقل ۳۰ ثانیه روشن می‌ماند
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      stopSpeaking();
      return;
    }

    unlockAudio();

    const initialQuestion = isEn
      ? 'Hello! Please tell me what reminder, occasion, location, or idea you would like to save?'
      : 'سلام، وقت بخیر. لطفاً بفرمایید چه یادآور، مناسبت، مکان یا ایده‌ای را می‌خواهید ثبت کنید؟';

    const initialGreeting: SmartChatMessage = {
      id: 'welcome_' + Date.now(),
      role: 'assistant',
      text: initialQuestion,
      timestamp: Date.now(),
    };

    setMessages([initialGreeting]);
    setDraft({ intentType: 'unknown', wizardStep: 'ask_subject' });
    setIsComplete(false);
    setInputText('');
    setLiveTranscript('');
    setGpsCoords(null);
    gpsCoordsRef.current = null;
    setGpsStatus('idle');
    setGpsErrorMsg(null);

    const timer = setTimeout(() => {
      speakPromptWithCallback(initialQuestion, () => {
        if (isOpenRef.current) {
          startListening();
        }
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      stopListening();
      stopSpeaking();
    };
  }, [isOpen, isEn, speakPromptWithCallback, startListening, stopListening, stopSpeaking]);

  // به محض تشخیص دسته‌ی «مکان»، دریافت زنده و واقعی GPS (با maximumAge: 0) آغاز شود
  useEffect(() => {
    if (!isOpen || draft.intentType !== 'location') return;
    if (gpsStatus === 'idle') {
      acquireLiveGpsCoordinates();
    }
  }, [acquireLiveGpsCoordinates, draft.intentType, gpsStatus, isOpen]);

  const handleUserUtterance = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      stopListening();
      setInputText('');
      setLiveTranscript('');

      const wasAlreadyComplete = isCompleteRef.current && Boolean(draftRef.current.title);

      // گام ۶: اگر در مرحله تایید نهایی هستیم و کاربر هر یک از کلمات تایید (اوکی، خوبه، بله، باشه، ثبت کن، ادامه بده و ...) را بگوید
      if (wasAlreadyComplete && isConfirmationUtterance(trimmed)) {
        await executeFinalSave(draftRef.current);
        return;
      }

      const userMsg: SmartChatMessage = {
        id: 'u_' + Date.now(),
        role: 'user',
        text: trimmed,
        timestamp: Date.now(),
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsAnalyzing(true);

      try {
        const analysis = await analyzeSmartCaptureTurn(updatedMessages, draft, language);

        setDraft(analysis.draft);
        setIsComplete(analysis.isComplete);

        // اگر کاربر در حین مرحله تکمیلی مکان یا ایده مستقیماً دستور ثبت داده باشد
        if (analysis.isComplete && analysis.shouldAutoSubmit && analysis.draft.title) {
          await executeFinalSave(analysis.draft);
          return;
        }

        const assistantMsg: SmartChatMessage = {
          id: 'a_' + Date.now(),
          role: 'assistant',
          text: analysis.clarifyingQuestion,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // در تمام مراحل (چه پرسیدن روز، چه پرسیدن ساعت، و چه بازخوانی نهایی و درخواست تایید در گام ۵)
        // گوینده جمله را کامل بیان کرده و بلافاصله میکروفون را روشن می‌کند تا پاسخ یا تایید کاربر را بشنود
        speakPromptWithCallback(analysis.clarifyingQuestion, () => {
          if (isOpenRef.current) {
            startListening();
          }
        });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      draft,
      executeFinalSave,
      language,
      messages,
      speakPromptWithCallback,
      startListening,
      stopListening,
    ]
  );

  useEffect(() => {
    handleUserUtteranceRef.current = handleUserUtterance;
  }, [handleUserUtterance]);

  if (!isOpen) return null;

  const sectionMeta: Record<
    SmartIntentType,
    { label: string; icon: React.ReactNode; badgeClass: string }
  > = {
    reminder: {
      label: isEn ? 'Reminder' : 'یادآور',
      icon: <Bell className="w-4 h-4" />,
      badgeClass: 'bg-[#FF8C00]/15 text-[#FF8C00] border-[#FF8C00]/40',
    },
    occasion: {
      label: isEn ? 'Occasion' : 'مناسبت',
      icon: <Cake className="w-4 h-4" />,
      badgeClass: 'bg-pink-500/15 text-pink-400 border-pink-500/40',
    },
    location: {
      label: isEn ? 'Location' : 'مکان',
      icon: <MapPin className="w-4 h-4" />,
      badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
    },
    idea: {
      label: isEn ? 'Idea' : 'ایده',
      icon: <Lightbulb className="w-4 h-4" />,
      badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
    },
    unknown: {
      label: isEn ? 'Smart Detection' : 'تشخیص هوشمند',
      icon: <Sparkles className="w-4 h-4" />,
      badgeClass: 'bg-stone-800 text-stone-300 border-stone-700',
    },
  };

  const currentSection = sectionMeta[draft.intentType || 'unknown'];

  // Step Progress Indicators per category
  const getWizardSteps = (): Array<{ label: string; done: boolean; active: boolean }> => {
    const hasTitle = Boolean(draft.title && draft.title.trim().length >= 2);
    if (draft.intentType === 'occasion') {
      const hasDate = Boolean(draft.solarDay && draft.solarMonth);
      return [
        {
          label: isEn ? '1. Title' : '۱. عنوان',
          done: hasTitle,
          active: !hasTitle,
        },
        {
          label: isEn ? '2. Date' : '۲. تاریخ',
          done: hasDate,
          active: hasTitle && !hasDate,
        },
        {
          label: isEn ? '3. Confirm' : '۳. تایید نهایی',
          done: false,
          active: hasTitle && hasDate,
        },
      ];
    }

    if (draft.intentType === 'location') {
      const hasLiveGps = gpsStatus === 'ready' && Boolean(gpsCoords);
      return [
        {
          label: isEn ? '1. Name' : '۱. نام مکان',
          done: hasTitle,
          active: !hasTitle,
        },
        {
          label: isEn ? '2. Live GPS' : '۲. GPS زنده',
          done: hasLiveGps,
          active: hasTitle && !hasLiveGps,
        },
        {
          label: isEn ? '3. Confirm' : '۳. تایید نهایی',
          done: false,
          active: hasTitle && hasLiveGps,
        },
      ];
    }

    if (draft.intentType === 'idea') {
      return [
        {
          label: isEn ? '1. Subject' : '۱. موضوع ایده',
          done: hasTitle,
          active: !hasTitle,
        },
        {
          label: isEn ? '2. Details' : '۲. توضیحات',
          done: Boolean(draft.detailsAsked),
          active: hasTitle && !draft.detailsAsked,
        },
        {
          label: isEn ? '3. Confirm' : '۳. تایید نهایی',
          done: false,
          active: hasTitle && Boolean(draft.detailsAsked),
        },
      ];
    }

    // Default / Reminder steps: 1. Title -> 2. Day -> 3. Time -> 4. Confirm
    const hasDay = Boolean(
      draft.daySpecified ||
        (draft.solarDay && draft.solarMonth) ||
        typeof draft.offsetDays === 'number'
    );
    const hasTime = typeof draft.hour === 'number' && draft.hour >= 0;

    return [
      {
        label: isEn ? '1. Subject' : '۱. موضوع',
        done: hasTitle,
        active: !hasTitle,
      },
      {
        label: isEn ? '2. Day' : '۲. روز',
        done: hasDay,
        active: hasTitle && !hasDay,
      },
      {
        label: isEn ? '3. Time' : '۳. ساعت',
        done: hasTime,
        active: hasTitle && hasDay && !hasTime,
      },
      {
        label: isEn ? '4. Confirm' : '۴. تایید نهایی',
        done: false,
        active: hasTitle && hasDay && hasTime,
      },
    ];
  };

  const wizardSteps = getWizardSteps();

  return (
    <div
      dir={isEn ? 'ltr' : 'rtl'}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          unlockAudio();
        }}
        className="w-full max-w-lg bg-stone-950 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Minimal Clean Header: Only "ثبت هوشمند" / "Smart Capture" */}
        <div className="px-4 py-3 border-b border-stone-800/90 flex items-center justify-between bg-stone-900/70">
          <div className="flex items-center gap-2.5">
            <div
              data-keep-color="true"
              className="w-8 h-8 rounded-xl bg-[#FF8C00] text-white flex items-center justify-center shadow-md shadow-[#FF8C00]/30"
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-sm sm:text-base font-black text-white">
              {isEn ? 'Smart Capture' : 'ثبت هوشمند'}
            </h3>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setVoiceFeedbackEnabled((v) => !v)}
              className="p-2 rounded-xl bg-stone-800/80 hover:bg-stone-800 text-stone-300 transition-colors cursor-pointer"
              title={isEn ? 'Voice Readback' : 'صدای گوینده'}
            >
              {voiceFeedbackEnabled ? (
                <Volume2 className="w-4 h-4 text-[#FF8C00]" />
              ) : (
                <VolumeX className="w-4 h-4 text-stone-500" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-stone-800/80 hover:bg-stone-800 text-stone-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Step-by-Step Progress Bar */}
        <div className="px-4 py-2 bg-stone-900/40 border-b border-stone-800/60 flex items-center justify-between gap-1.5 overflow-x-auto">
          {wizardSteps.map((step, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${
                step.done
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : step.active
                  ? 'bg-[#FF8C00]/20 text-[#FF8C00] border border-[#FF8C00]/50'
                  : 'bg-stone-900 text-stone-500 border border-stone-800'
              }`}
            >
              {step.done && <Check className="w-3 h-3 stroke-[3]" />}
              <span>{step.label}</span>
            </div>
          ))}
        </div>

        {/* Conversation Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[160px] max-h-[290px]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#FF8C00]/15 border border-[#FF8C00]/35 text-white rounded-br-sm'
                    : 'bg-stone-900 border border-stone-800 text-stone-200 rounded-bl-sm'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {liveTranscript && (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl px-3.5 py-2 text-xs sm:text-sm bg-[#FF8C00]/10 border border-dashed border-[#FF8C00]/50 text-stone-200">
                {liveTranscript}...
              </div>
            </div>
          )}

          {isAnalyzing && (
            <div className="flex justify-end">
              <div className="rounded-2xl px-3.5 py-2 text-xs bg-stone-900 border border-stone-800 text-stone-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#FF8C00] animate-ping" />
                <span>{isEn ? 'Analyzing...' : 'در حال پردازش...'}</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Live Extracted Fields Card */}
        {(draft.title || draft.intentType !== 'unknown') && (
          <div className="mx-4 mb-2 p-3 rounded-2xl bg-stone-900/90 border border-stone-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${currentSection.badgeClass}`}
              >
                {currentSection.icon}
                <span>{currentSection.label}</span>
              </span>

              {isComplete ? (
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {isEn
                      ? 'Awaiting your confirmation (Say Yes / OK)'
                      : 'منتظر تایید شما (بگویید: بله / اوکی / ثبت کن)'}
                  </span>
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-400">
                  {isEn ? 'Step-by-step completion...' : 'در حال تکمیل مرحله‌ای...'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-[10px] text-stone-400 mb-0.5">
                  {isEn ? 'Title' : 'عنوان'}
                </label>
                <input
                  type="text"
                  value={draft.title || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraft((prev) => ({ ...prev, title: val }));
                  }}
                  placeholder={isEn ? 'Enter title...' : 'عنوان...'}
                  className="w-full px-2.5 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-white focus:outline-none focus:border-[#FF8C00]"
                />
              </div>

              {(draft.intentType === 'reminder' || draft.intentType === 'unknown') && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="block text-[10px] text-stone-400">
                      {isEn ? 'Date & Time' : 'روز و ساعت'}
                    </label>
                    {(typeof draft.hour === 'number' && draft.hour >= 0) ||
                    (draft.solarDay && draft.solarMonth) ? (
                      <span className="text-[10px] text-[#FF8C00] font-bold truncate max-w-[155px]">
                        {formatJalaliFull(computeReminderTimestampFromDraft(draft), language)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={
                        draft.solarDay && draft.solarMonth
                          ? 'solar'
                          : draft.daySpecified && typeof draft.offsetDays === 'number'
                          ? String(draft.offsetDays)
                          : ''
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'solar' || val === '') return;
                        const nextOffset = Number(val);
                        const nextDraft: SmartCaptureDraft = {
                          ...draft,
                          intentType: draft.intentType === 'unknown' ? 'reminder' : draft.intentType,
                          daySpecified: true,
                          offsetDays: nextOffset,
                          solarDay: undefined,
                          solarMonth: undefined,
                          solarYear: undefined,
                        };
                        setDraft(nextDraft);
                        if (nextDraft.title && typeof nextDraft.hour === 'number') {
                          setIsComplete(true);
                        }
                      }}
                      className="px-2 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-stone-200 focus:outline-none focus:border-[#FF8C00] cursor-pointer"
                    >
                      <option value="">{isEn ? 'Select day...' : 'انتخاب روز...'}</option>
                      {draft.solarDay && draft.solarMonth && (
                        <option value="solar">
                          {isEn
                            ? `${draft.solarDay}/${draft.solarMonth}${
                                draft.solarYear ? `/${draft.solarYear}` : ''
                              }`
                            : `${toPersianDigits(draft.solarDay)} ${PERSIAN_MONTHS[draft.solarMonth - 1]}${
                                draft.solarYear ? ` ${toPersianDigits(draft.solarYear)}` : ''
                              }`}
                        </option>
                      )}
                      <option value="0">{isEn ? 'Today' : 'امروز'}</option>
                      <option value="1">{isEn ? 'Tomorrow' : 'فردا'}</option>
                      <option value="2">{isEn ? 'In 2 days' : 'پس‌فردا'}</option>
                      <option value="3">{isEn ? 'In 3 days' : '۳ روز دیگر'}</option>
                      <option value="4">{isEn ? 'In 4 days' : '۴ روز دیگر'}</option>
                      <option value="7">{isEn ? 'Next week' : 'هفته آینده'}</option>
                      {typeof draft.offsetDays === 'number' &&
                        ![0, 1, 2, 3, 4, 7].includes(draft.offsetDays) && (
                          <option value={String(draft.offsetDays)}>
                            {isEn
                              ? `In ${draft.offsetDays} days`
                              : `${toPersianDigits(draft.offsetDays)} روز دیگر`}
                          </option>
                        )}
                    </select>
                    <input
                      type="time"
                      dir="ltr"
                      value={
                        typeof draft.hour === 'number' && draft.hour >= 0
                          ? `${String(draft.hour).padStart(2, '0')}:${String(draft.minute || 0).padStart(2, '0')}`
                          : ''
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        const [hStr, mStr] = val.split(':');
                        const h = Number(hStr);
                        const m = Number(mStr);
                        if (!Number.isNaN(h) && !Number.isNaN(m)) {
                          const hasSolar = Boolean(draft.solarDay && draft.solarMonth);
                          const nextDraft: SmartCaptureDraft = {
                            ...draft,
                            intentType: draft.intentType === 'unknown' ? 'reminder' : draft.intentType,
                            hour: h,
                            minute: m,
                            daySpecified: true,
                            offsetDays: hasSolar
                              ? undefined
                              : typeof draft.offsetDays === 'number'
                              ? draft.offsetDays
                              : 0,
                          };
                          setDraft(nextDraft);
                          if (nextDraft.title) setIsComplete(true);
                        }
                      }}
                      className="flex-1 px-2.5 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-white font-mono focus:outline-none focus:border-[#FF8C00]"
                    />
                  </div>
                </div>
              )}

              {draft.intentType === 'occasion' && (
                <div>
                  <label className="block text-[10px] text-stone-400 mb-0.5">
                    {isEn ? 'Date' : 'تاریخ مناسبت'}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={draft.solarDay || ''}
                      onChange={(e) => {
                        const nextDay = Number(e.target.value) || undefined;
                        const nextMonth = draft.solarMonth || 1;
                        const nextDraft = {
                          ...draft,
                          solarDay: nextDay,
                          solarMonth: nextDay ? nextMonth : draft.solarMonth,
                        };
                        setDraft(nextDraft);
                        if (nextDraft.title && nextDraft.solarDay && nextDraft.solarMonth) {
                          setIsComplete(true);
                        }
                      }}
                      className="w-20 px-2 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-stone-200 focus:outline-none focus:border-[#FF8C00] cursor-pointer"
                    >
                      <option value="">{isEn ? 'Day' : 'روز'}</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {isEn ? d : toPersianDigits(d)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draft.solarMonth || ''}
                      onChange={(e) => {
                        const nextMonth = Number(e.target.value) || undefined;
                        const nextDay = draft.solarDay || 1;
                        const nextDraft = {
                          ...draft,
                          solarMonth: nextMonth,
                          solarDay: nextMonth ? nextDay : draft.solarDay,
                        };
                        setDraft(nextDraft);
                        if (nextDraft.title && nextDraft.solarDay && nextDraft.solarMonth) {
                          setIsComplete(true);
                        }
                      }}
                      className="flex-1 px-2 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-stone-200 focus:outline-none focus:border-[#FF8C00] cursor-pointer"
                    >
                      <option value="">{isEn ? 'Month' : 'ماه'}</option>
                      {PERSIAN_MONTHS.map((mName, idx) => (
                        <option key={mName} value={idx + 1}>
                          {isEn ? `${idx + 1} - ${mName}` : mName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {draft.intentType === 'location' && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="block text-[10px] text-stone-400">
                      {isEn ? 'Live GPS Coordinates' : 'موقعیت زنده GPS'}
                    </label>
                    <button
                      type="button"
                      onClick={() => acquireLiveGpsCoordinates()}
                      className="text-[10px] text-[#FF8C00] hover:underline flex items-center gap-1 cursor-pointer font-bold"
                    >
                      <Navigation className="w-3 h-3" />
                      <span>{isEn ? 'Refresh GPS' : 'بروزرسانی GPS'}</span>
                    </button>
                  </div>
                  <div
                    className={`px-2.5 py-1.5 rounded-xl bg-stone-950 border text-xs truncate ${
                      gpsStatus === 'ready' && gpsCoords
                        ? 'border-emerald-500/40 text-emerald-400 font-mono'
                        : gpsStatus === 'error'
                        ? 'border-rose-500/40 text-rose-400'
                        : 'border-stone-800 text-amber-400'
                    }`}
                  >
                    {gpsStatus === 'ready' && gpsCoords
                      ? `${gpsCoords.lat.toFixed(5)}, ${gpsCoords.lng.toFixed(5)}`
                      : gpsStatus === 'fetching'
                      ? isEn
                        ? 'Receiving live GPS signal...'
                        : 'در حال دریافت سیگنال زنده GPS...'
                      : gpsErrorMsg ||
                        (isEn ? 'Waiting for live GPS...' : 'در انتظار اتصال به GPS زنده...')}
                  </div>
                </div>
              )}

              {draft.intentType === 'idea' && (
                <div>
                  <label className="block text-[10px] text-stone-400 mb-0.5">
                    {isEn ? 'Additional Details' : 'توضیحات تکمیلی'}
                  </label>
                  <input
                    type="text"
                    value={draft.description || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((prev) => ({ ...prev, description: val }));
                    }}
                    placeholder={isEn ? 'Optional note...' : 'توضیحات ایده (اختیاری)...'}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-white focus:outline-none focus:border-[#FF8C00]"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom Controls: Prominent Continuous Microphone Bar + Text Input + Final Submit Button */}
        <div className="p-3.5 bg-stone-900/95 border-t border-stone-800 space-y-2.5">
          {/* Prominent Microphone Hero Box */}
          <div
            onClick={() => {
              unlockAudio();
              stopSpeaking();
              const pendingText = (liveTranscript || inputText).trim();
              if (isListening && pendingText) {
                handleUserUtterance(pendingText);
              } else if (isListening) {
                stopListening();
              } else {
                startListening();
              }
            }}
            className={`w-full rounded-2xl p-3 border-2 transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
              isSpeechActive
                ? 'bg-[#FF8C00]/20 border-[#FF8C00] shadow-lg shadow-[#FF8C00]/25'
                : isListening
                ? 'bg-[#FF8C00]/12 border-[#FF8C00]/80 shadow-md shadow-[#FF8C00]/15'
                : 'bg-stone-950/90 hover:bg-stone-900 border-[#FF8C00]/50'
            }`}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Large Unmistakable Microphone Button */}
              <button
                type="button"
                data-keep-color="true"
                onClick={(e) => {
                  e.stopPropagation();
                  unlockAudio();
                  stopSpeaking();
                  const pendingText = (liveTranscript || inputText).trim();
                  if (isListening && pendingText) {
                    handleUserUtterance(pendingText);
                  } else if (isListening) {
                    stopListening();
                  } else {
                    startListening();
                  }
                }}
                style={{
                  transform: isSpeechActive
                    ? `scale(${1.06 + Math.min(0.14, voiceLevel / 450)})`
                    : undefined,
                }}
                className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer shrink-0 ${
                  isListening
                    ? 'bg-[#FF8C00] text-white shadow-xl shadow-[#FF8C00]/50 ring-4 ring-[#FF8C00]/30'
                    : 'bg-[#FF8C00] hover:bg-[#FF9E1F] text-white shadow-lg shadow-[#FF8C00]/35 ring-2 ring-white/25'
                }`}
              >
                {isListening && (
                  <>
                    <span className="absolute inset-0 rounded-2xl bg-[#FF8C00] animate-ping opacity-35 pointer-events-none" />
                    <span
                      className="absolute -inset-1.5 rounded-3xl border-2 border-[#FF8C00]/60 pointer-events-none transition-transform duration-150"
                      style={{
                        transform: `scale(${1 + Math.min(0.25, voiceLevel / 260)})`,
                      }}
                    />
                  </>
                )}
                <Mic className="w-7 h-7 sm:w-8 sm:h-8 text-white stroke-[2.4] drop-shadow" />
                <span className="text-[9px] font-black text-white/95 mt-0.5 leading-none">
                  {isListening ? (isEn ? 'ON' : 'روشن') : isEn ? 'MIC' : 'میکروفون'}
                </span>
              </button>

              {/* Live Status & Speech-to-Text Preview */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isSpeechActive
                        ? 'bg-emerald-400 animate-ping'
                        : isListening
                        ? 'bg-[#FF8C00] animate-pulse'
                        : isAssistantSpeaking
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-stone-500'
                    }`}
                  />
                  <p className="text-xs sm:text-sm font-black text-white truncate">
                    {isSpeechActive
                      ? isEn
                        ? 'Listening to your voice...'
                        : 'در حال شنیدن و تبدیل گفتار شما...'
                      : isListening
                      ? isEn
                        ? 'Microphone is ON — Waiting for your response'
                        : 'میکروفون روشن است — منتظر پاسخ شما'
                      : isAssistantSpeaking
                      ? isEn
                        ? 'Assistant is speaking...'
                        : 'در حال بیان صوتی پرسش...'
                      : isEn
                      ? 'Tap Microphone to Speak'
                      : 'برای صحبت روی میکروفون بزنید'}
                  </p>
                </div>
                <p className="text-[11px] text-stone-300 mt-0.5 truncate">
                  {liveTranscript
                    ? liveTranscript
                    : isComplete
                    ? isEn
                      ? 'Say "Yes", "OK", or "Save" to confirm'
                      : 'برای تایید نهایی بگویید: «بله»، «اوکی»، «باشه» یا «ثبت کن»'
                    : isListening
                    ? isEn
                      ? 'Microphone stays active for at least 30 seconds'
                      : 'میکروفون حداقل ۳۰ ثانیه آماده شنیدن صحبت شما می‌ماند'
                    : isAssistantSpeaking
                    ? isEn
                      ? 'Microphone activates right after voice prompt'
                      : 'بلافاصله پس از پایان صدای گوینده، میکروفون فعال می‌شود'
                    : isEn
                    ? 'Tap the orange button to start voice capture'
                    : 'دکمه نارنجی میکروفون را لمس کنید'}
                </p>
              </div>
            </div>

            {/* Real-Time 5-Bar Voice Equalizer Indicator */}
            <div className="flex items-center gap-1 h-9 px-1.5 shrink-0" aria-hidden="true">
              {[0.45, 0.75, 1.0, 0.8, 0.5].map((multiplier, i) => {
                const activeHeight = isListening
                  ? Math.max(
                      8,
                      Math.min(
                        34,
                        Math.round(
                          (isSpeechActive ? Math.max(30, voiceLevel) : Math.max(16, voiceLevel)) *
                            0.34 *
                            multiplier
                        )
                      )
                    )
                  : 6;
                return (
                  <span
                    key={i}
                    data-keep-color="true"
                    style={{ height: `${activeHeight}px` }}
                    className={`w-1.5 rounded-full transition-all duration-100 ${
                      isSpeechActive
                        ? 'bg-emerald-400'
                        : isListening
                        ? 'bg-[#FF8C00]'
                        : 'bg-stone-700'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Secondary Text Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              unlockAudio();
              if (inputText.trim()) {
                handleUserUtterance(inputText);
              }
            }}
            className="flex items-center gap-1.5 bg-stone-950 border border-stone-800 focus-within:border-[#FF8C00] rounded-2xl px-3 py-1"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
              }}
              placeholder={
                isEn ? 'Or type your response here...' : 'یا پاسخ خود را اینجا بنویسید...'
              }
              className="w-full bg-transparent border-0 text-xs sm:text-sm text-white placeholder-stone-500 focus:outline-none py-1.5"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              data-keep-color="true"
              className="p-2 rounded-xl bg-[#FF8C00] disabled:opacity-35 text-white transition-all cursor-pointer active:scale-95 shrink-0"
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </form>

          {/* Direct Final Save Button when title is present */}
          {draft.title && draft.title.trim().length >= 2 && (
            <button
              type="button"
              data-keep-color="true"
              onClick={() => executeFinalSave(draft)}
              className="btn-brand-submit w-full py-3 px-4 rounded-2xl bg-[#FF8C00] hover:bg-[#FF9E1F] text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#FF8C00]/30 transition-all active:scale-98 cursor-pointer"
            >
              <Check className="w-4 h-4 text-white stroke-[3]" />
              <span>
                {isEn
                  ? `Confirm & Save in ${
                      draft.intentType === 'unknown' ? 'Reminders' : currentSection.label
                    }`
                  : `تایید و ثبت نهایی در بخش ${
                      draft.intentType === 'unknown' ? 'یادآورها' : currentSection.label
                    }`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
