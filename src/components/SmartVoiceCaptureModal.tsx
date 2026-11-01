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
  const messagesRef = useRef<SmartChatMessage[]>(messages);
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
    messagesRef.current = messages;
  }, [messages]);

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
          // مکث کوتاه برای آزادسازی کامل کانال صوتی پیش از روشن شدن میکروفون
          ttsWaitTimerRef.current = setTimeout(() => {
            if (isOpenRef.current) {
              onDone?.();
            }
          }, 160);
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
            const wordCount = currentConvertedText.split(/\s+/).filter(Boolean).length;
            const currentStep = draftRef.current.wizardStep;
            const isStepShortAnswer =
              (currentStep === 'ask_day' || currentStep === 'ask_time' || currentStep === 'confirm') &&
              wordCount <= 4;
            schedulePostSpeechCommit(
              isShortConfirm ? 950 : isStepShortAnswer ? 1250 : 1750
            );
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

  const wasOpenRef = useRef(false);

  // گام ۱: هنگام باز شدن مدال، سوال صمیمانه و محترمانه پرسیده شده و میکروفون بلافاصله حداقل ۳۰ ثانیه روشن می‌ماند
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      stopListening();
      stopSpeaking();
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

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

    const initialDraft: SmartCaptureDraft = { intentType: 'unknown', wizardStep: 'ask_subject' };
    messagesRef.current = [initialGreeting];
    draftRef.current = initialDraft;
    isCompleteRef.current = false;

    setMessages([initialGreeting]);
    setDraft(initialDraft);
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

      const activeDraft = draftRef.current;
      const wasAlreadyComplete = isCompleteRef.current && Boolean(activeDraft.title);

      // گام ۶: اگر در مرحله تایید نهایی هستیم و کاربر هر یک از کلمات تایید (اوکی، خوبه، بله، باشه، ثبت کن، ادامه بده و ...) را بگوید
      if (wasAlreadyComplete && isConfirmationUtterance(trimmed)) {
        await executeFinalSave(activeDraft);
        return;
      }

      const userMsg: SmartChatMessage = {
        id: 'u_' + Date.now(),
        role: 'user',
        text: trimmed,
        timestamp: Date.now(),
      };

      const updatedMessages = [...messagesRef.current, userMsg];
      messagesRef.current = updatedMessages;
      setMessages(updatedMessages);
      setIsAnalyzing(true);

      try {
        const analysis = await analyzeSmartCaptureTurn(updatedMessages, activeDraft, language);

        draftRef.current = analysis.draft;
        isCompleteRef.current = analysis.isComplete;
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
        const nextMessages = [...updatedMessages, assistantMsg];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);

        // در تمام مراحل، گوینده جمله را کامل بیان کرده و بلافاصله میکروفون را روشن می‌کند تا پاسخ یا تایید کاربر را بشنود
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
      executeFinalSave,
      language,
      speakPromptWithCallback,
      startListening,
      stopListening,
    ]
  );

  useEffect(() => {
    handleUserUtteranceRef.current = handleUserUtterance;
  }, [handleUserUtterance]);

  if (!isOpen) return null;

  // آخرین جمله منشی برای نمایش در زیرنویس زنده
  const lastAssistantMessage =
    [...messages].reverse().find((m) => m.role === 'assistant')?.text || '';
  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === 'user')?.text || '';

  // خلاصه تک‌خطی و شفاف در مرحله تایید نهایی (بدون هیچ فرمی)
  const buildMinimalSummaryLine = (): string | null => {
    if (!draft.title || draft.title.trim().length < 2) return null;
    const typeLabel =
      draft.intentType === 'occasion'
        ? isEn
          ? 'Occasion'
          : 'مناسبت'
        : draft.intentType === 'location'
        ? isEn
          ? 'Location'
          : 'مکان'
        : draft.intentType === 'idea'
        ? isEn
          ? 'Idea'
          : 'ایده'
        : isEn
        ? 'Reminder'
        : 'یادآور';

    if (draft.intentType === 'occasion') {
      if (draft.solarDay && draft.solarMonth) {
        const mName = PERSIAN_MONTHS[draft.solarMonth - 1] || '';
        const datePart = isEn
          ? `${draft.solarDay} ${mName}`
          : `${toPersianDigits(draft.solarDay)} ${mName}`;
        return `${typeLabel}: ${draft.title} · ${datePart}`;
      }
      return `${typeLabel}: ${draft.title}`;
    }

    if (draft.intentType === 'location') {
      const gpsPart =
        gpsStatus === 'ready' && gpsCoords
          ? isEn
            ? 'Live GPS Ready'
            : 'موقعیت زنده GPS دریافت شد'
          : gpsStatus === 'fetching'
          ? isEn
            ? 'Getting Live GPS...'
            : 'در حال دریافت GPS زنده...'
          : gpsErrorMsg || (isEn ? 'Waiting for GPS' : 'در انتظار GPS');
      return `${typeLabel}: ${draft.title} · ${gpsPart}`;
    }

    if (draft.intentType === 'idea') {
      return `${typeLabel}: ${draft.title}${draft.description ? ` · ${draft.description}` : ''}`;
    }

    // Reminder
    const hasTime = typeof draft.hour === 'number' && draft.hour >= 0;
    const hasDay = Boolean(
      draft.daySpecified ||
        (draft.solarDay && draft.solarMonth) ||
        typeof draft.offsetDays === 'number'
    );
    if (hasTime && hasDay) {
      const timeStr = formatJalaliFull(computeReminderTimestampFromDraft(draft), language);
      return `${typeLabel}: ${draft.title} · ${timeStr}`;
    }
    return `${typeLabel}: ${draft.title}`;
  };

  const minimalSummaryLine = buildMinimalSummaryLine();

  // مقیاس پویا برای کره بر اساس بلندی صدای کاربر یا صحبت منشی
  const dynamicOrbScale = isSpeechActive
    ? 1 + Math.min(0.28, Math.max(0.06, voiceLevel / 190))
    : isListening
    ? 1 + Math.min(0.1, voiceLevel / 360)
    : 1;

  const handleOrbOrMicInteraction = () => {
    unlockAudio();
    // اگر منشی در حال صحبت است، با لمس کره صحبت او قطع شده و بلافاصله میکروفون برای شنیدن صدای کاربر باز می‌شود (Interrupt)
    if (isAssistantSpeaking) {
      stopSpeaking();
      startListening();
      return;
    }
    const pendingText = (liveTranscript || inputText).trim();
    if (isListening && pendingText) {
      handleUserUtterance(pendingText);
    } else if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div
      dir={isEn ? 'ltr' : 'rtl'}
      className="fixed inset-0 z-50 bg-stone-950/95 backdrop-blur-2xl flex flex-col justify-between p-6 sm:p-10 animate-in fade-in duration-300 select-none overflow-hidden"
      onClick={() => unlockAudio()}
    >
      {/* Ambient Background Glow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 transition-opacity duration-700 ${
          isSpeechActive
            ? 'opacity-45'
            : isAssistantSpeaking
            ? 'opacity-40'
            : isListening
            ? 'opacity-25'
            : 'opacity-15'
        }`}
        style={{
          background: isSpeechActive
            ? 'radial-gradient(circle at 50% 44%, rgba(16, 185, 129, 0.28), rgba(255, 140, 0, 0.12) 45%, transparent 72%)'
            : isAssistantSpeaking
            ? 'radial-gradient(circle at 50% 44%, rgba(255, 140, 0, 0.34), rgba(251, 191, 36, 0.12) 45%, transparent 72%)'
            : 'radial-gradient(circle at 50% 44%, rgba(255, 140, 0, 0.20), transparent 68%)',
        }}
      />

      {/* Top Minimal Header: Only Title + Mute Toggle */}
      <div className="relative z-10 flex items-center justify-between max-w-xl w-full mx-auto">
        <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
          {isEn ? 'Smart Capture' : 'ثبت هوشمند'}
        </h3>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            unlockAudio();
            setVoiceFeedbackEnabled((v) => !v);
          }}
          className="w-10 h-10 rounded-full bg-stone-900/80 hover:bg-stone-800 border border-stone-800 text-stone-300 flex items-center justify-center transition-colors cursor-pointer"
          title={isEn ? 'Voice Output' : 'صدای گوینده'}
        >
          {voiceFeedbackEnabled ? (
            <Volume2 className="w-4 h-4 text-[#FF8C00]" />
          ) : (
            <VolumeX className="w-4 h-4 text-stone-500" />
          )}
        </button>
      </div>

      {/* Center Stage: Interactive Conversational Voice Orb + Live Caption */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-xl w-full mx-auto my-4">
        {/* Interactive Fluid Sphere Container */}
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            handleOrbOrMicInteraction();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOrbOrMicInteraction();
            }
          }}
          aria-label={isEn ? 'Interactive Voice Assistant Orb' : 'گوی محاوره‌ای دستیار هوشمند'}
          className="relative w-56 h-56 sm:w-64 sm:h-64 flex items-center justify-center cursor-pointer group focus:outline-none"
        >
          {/* Outer Acoustic Ripple 1 */}
          <div
            aria-hidden="true"
            style={{
              transform: `scale(${
                isSpeechActive
                  ? 1.18 + Math.min(0.35, voiceLevel / 160)
                  : isAssistantSpeaking
                  ? 1.16
                  : isListening
                  ? 1.06
                  : 0.96
              })`,
            }}
            className={`absolute inset-0 rounded-full transition-all duration-200 ${
              isSpeechActive
                ? 'bg-emerald-500/15 border border-emerald-400/30'
                : isAssistantSpeaking
                ? 'bg-[#FF8C00]/15 border border-[#FF8C00]/35 animate-pulse'
                : isListening
                ? 'bg-[#FF8C00]/10 border border-[#FF8C00]/20'
                : 'bg-stone-800/20 border border-stone-800/40'
            }`}
          />

          {/* Middle Acoustic Ripple 2 */}
          <div
            aria-hidden="true"
            style={{
              transform: `scale(${
                isSpeechActive
                  ? 1.08 + Math.min(0.24, voiceLevel / 210)
                  : isAssistantSpeaking
                  ? 1.08
                  : isListening
                  ? 1.02
                  : 0.94
              })`,
            }}
            className={`absolute inset-5 rounded-full transition-all duration-150 ${
              isSpeechActive
                ? 'bg-emerald-400/20 border border-emerald-400/40'
                : isAssistantSpeaking
                ? 'bg-[#FF8C00]/25 border border-amber-400/40 animate-ping [animation-duration:2.4s]'
                : isListening
                ? 'bg-[#FF8C00]/15 border border-[#FF8C00]/25'
                : 'bg-stone-800/30'
            }`}
          />

          {/* Core Living Conversational Sphere */}
          <div
            data-keep-color="true"
            style={{
              transform: `scale(${dynamicOrbScale})`,
              background: isAnalyzing
                ? 'radial-gradient(circle at 32% 28%, #fde68a 0%, #ff8c00 48%, #7c2d12 100%)'
                : isSpeechActive
                ? 'radial-gradient(circle at 32% 28%, #a7f3d0 0%, #10b981 46%, #065f46 88%, #022c22 100%)'
                : isAssistantSpeaking
                ? 'radial-gradient(circle at 30% 26%, #fef08a 0%, #ff8c00 46%, #c2410c 86%, #431407 100%)'
                : isListening
                ? 'radial-gradient(circle at 32% 28%, #fed7aa 0%, #ff8c00 50%, #9a3412 88%, #292524 100%)'
                : 'radial-gradient(circle at 32% 28%, #78716c 0%, #44403c 55%, #1c1917 100%)',
              boxShadow: isSpeechActive
                ? '0 0 75px rgba(16, 185, 129, 0.55), inset 0 -14px 28px rgba(0,0,0,0.45), inset 0 12px 24px rgba(255,255,255,0.35)'
                : isAssistantSpeaking
                ? '0 0 80px rgba(255, 140, 0, 0.65), inset 0 -14px 28px rgba(0,0,0,0.45), inset 0 12px 24px rgba(255,255,255,0.4)'
                : isListening
                ? '0 0 55px rgba(255, 140, 0, 0.40), inset 0 -12px 24px rgba(0,0,0,0.45), inset 0 10px 20px rgba(255,255,255,0.28)'
                : '0 0 30px rgba(0, 0, 0, 0.6), inset 0 8px 18px rgba(255,255,255,0.12)',
            }}
            className={`relative w-36 h-36 sm:w-44 sm:h-44 rounded-full transition-transform duration-150 flex flex-col items-center justify-center overflow-hidden ${
              isAnalyzing ? 'animate-spin' : isAssistantSpeaking ? 'animate-pulse' : ''
            }`}
          >
            {/* Internal Fluid Light Specular Highlight */}
            <div
              aria-hidden="true"
              className="w-24 h-14 rounded-full bg-white/25 blur-md -translate-y-8 -translate-x-3 pointer-events-none"
            />
          </div>
        </div>

        {/* Status Indicator Line */}
        <p className="mt-6 text-xs sm:text-sm font-bold tracking-wide text-stone-400 text-center">
          {isAnalyzing
            ? isEn
              ? 'Thinking...'
              : 'در حال تنظیم...'
            : isAssistantSpeaking
            ? isEn
              ? 'Speaking — Tap the orb anytime to interrupt'
              : 'در حال صحبت — هر زمان خواستید بفرمایید'
            : isSpeechActive
            ? isEn
              ? 'Listening to you...'
              : 'در حال شنیدن صحبت شما...'
            : isListening
            ? isEn
              ? 'Listening...'
              : 'گوش می‌دهم، بفرمایید...'
            : isEn
            ? 'Tap the orb to continue speaking'
            : 'برای صحبت روی گوی بزنید'}
        </p>

        {/* Live Conversational Caption (Single-Focus Subtitle) */}
        <div className="mt-4 min-h-[76px] max-w-md w-full flex flex-col items-center justify-center text-center px-3">
          {liveTranscript ? (
            <p className="text-base sm:text-xl font-black text-emerald-300 leading-relaxed animate-in fade-in duration-150">
              «{liveTranscript}»
            </p>
          ) : (
            <p className="text-base sm:text-xl font-black text-white leading-relaxed">
              {lastAssistantMessage}
            </p>
          )}

          {!liveTranscript && lastUserMessage && !isAssistantSpeaking && (
            <p className="mt-2 text-xs text-stone-400 truncate max-w-sm">
              {isEn ? `You said: "${lastUserMessage}"` : `شما فرمودید: «${lastUserMessage}»`}
            </p>
          )}
        </div>

        {/* Minimal Unboxed / Whisper Summary Line when item details are captured */}
        {minimalSummaryLine && (
          <div className="mt-4 px-4 py-2 rounded-2xl bg-stone-900/75 border border-stone-800/90 text-center max-w-md">
            <p className="text-xs sm:text-sm font-bold text-amber-300 leading-relaxed">
              {minimalSummaryLine}
            </p>
          </div>
        )}
      </div>

      {/* Bottom Minimal Action Dock (Like ChatGPT Voice Mode) */}
      <div className="relative z-10 flex items-center justify-center gap-6 pb-2">
        {/* Mic / Interrupt Button */}
        <button
          type="button"
          data-keep-color="true"
          onClick={(e) => {
            e.stopPropagation();
            handleOrbOrMicInteraction();
          }}
          className={`w-16 h-16 rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            isSpeechActive
              ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-400/30'
              : isListening
              ? 'bg-[#FF8C00] text-white shadow-xl shadow-[#FF8C00]/40 ring-4 ring-[#FF8C00]/25'
              : 'bg-stone-800 hover:bg-stone-700 text-white border border-stone-700'
          }`}
          title={isListening ? (isEn ? 'Microphone On' : 'میکروفون روشن') : isEn ? 'Speak' : 'صحبت'}
        >
          <Mic className="w-7 h-7 text-white stroke-[2.2]" />
        </button>

        {/* Optional One-Tap Save Button when draft is complete */}
        {isComplete && draft.title && draft.title.trim().length >= 2 && (
          <button
            type="button"
            data-keep-color="true"
            onClick={(e) => {
              e.stopPropagation();
              executeFinalSave(draft);
            }}
            className="h-16 px-6 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xs sm:text-sm flex items-center gap-2 shadow-xl shadow-emerald-500/30 transition-all cursor-pointer active:scale-95"
          >
            <Check className="w-5 h-5 text-white stroke-[2.8]" />
            <span>{isEn ? 'Save Now' : 'ثبت نهایی'}</span>
          </button>
        )}

        {/* Close / End Session Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            stopListening();
            stopSpeaking();
            onClose();
          }}
          className="w-16 h-16 rounded-full bg-stone-900 hover:bg-rose-500/20 border border-stone-800 hover:border-rose-500/40 text-stone-300 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer active:scale-95"
          title={isEn ? 'End Voice Session' : 'پایان گفتگو'}
        >
          <X className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
};

