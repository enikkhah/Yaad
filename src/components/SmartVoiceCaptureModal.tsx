import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  Send,
  X,
  Check,
  Volume2,
  VolumeX,
  Keyboard,
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
  analyzeSmartCaptureTurn,
  computeReminderTimestampFromDraft,
  getSmartRetryPrompt,
  getSmartTypeFallbackPrompt,
  getSmartWelcomePrompt,
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
  const [showTextInputFallback, setShowTextInputFallback] = useState(false);

  // Real live GPS state (strictly live hardware GPS with maximumAge: 0; never cached or mock coordinates)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'fetching' | 'ready' | 'error'>('idle');
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);

  // Persistent SpeechRecognition refs (ChatGPT Voice Mode: single continuous warm session, 0ms turn latency)
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const isUserTurnActiveRef = useRef<boolean>(false);
  const isAssistantSpeakingRef = useRef<boolean>(false);
  const ttsMuteUntilRef = useRef<number>(0);
  const unclearAttemptsRef = useRef<number>(0);
  const showTextInputFallbackRef = useRef<boolean>(false);

  const accumulatedFinalRef = useRef<string>('');
  const latestInterimRef = useRef<string>('');
  const lastFinalChunkRef = useRef<string>('');
  const processedFinalIndicesRef = useRef<Set<number>>(new Set());
  const ignoredResultIndicesRef = useRef<Set<number>>(new Set());
  const latestResultCountRef = useRef<number>(0);

  const handleUserUtteranceRef = useRef<(text: string, isTyped?: boolean) => void>(() => {});
  const handleSilenceOrUnclearTimeoutRef = useRef<() => void>(() => {});
  const isOpenRef = useRef(isOpen);
  const messagesRef = useRef<SmartChatMessage[]>(messages);
  const draftRef = useRef(draft);
  const isCompleteRef = useRef(isComplete);
  const voiceEnabledRef = useRef(voiceFeedbackEnabled);
  const gpsCoordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const micSensitivityRef = useRef<number>(micSensitivity);
  const aiVoicePersonaRef = useRef<AiVoicePersona>(aiVoicePersona);
  const aiVoiceVolumeRef = useRef<number>(aiVoiceVolume);
  const ttsVoiceRateRef = useRef<number>(ttsVoiceRate);

  const speechDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

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
    aiVoicePersonaRef.current = aiVoicePersona;
  }, [aiVoicePersona]);

  useEffect(() => {
    aiVoiceVolumeRef.current = aiVoiceVolume;
  }, [aiVoiceVolume]);

  useEffect(() => {
    ttsVoiceRateRef.current = ttsVoiceRate;
  }, [ttsVoiceRate]);

  useEffect(() => {
    showTextInputFallbackRef.current = showTextInputFallback;
    if (showTextInputFallback) {
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 80);
    }
  }, [showTextInputFallback]);

  const clearTurnTimers = useCallback(() => {
    if (speechDoneTimerRef.current) {
      clearTimeout(speechDoneTimerRef.current);
      speechDoneTimerRef.current = null;
    }
    if (silenceWatchdogTimerRef.current) {
      clearTimeout(silenceWatchdogTimerRef.current);
      silenceWatchdogTimerRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    isAssistantSpeakingRef.current = false;
    setIsAssistantSpeaking(false);
    if (ttsWaitTimerRef.current) {
      clearTimeout(ttsWaitTimerRef.current);
      ttsWaitTimerRef.current = null;
    }
    stopAiAssistantPrompt();
  }, []);

  /**
   * توقف کامل موتور تشخیص گفتار (فقط هنگام بستن مدال یا فعال شدن حالت تایپ پس از ۳ بار عدم وضوح صدا)
   */
  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    isUserTurnActiveRef.current = false;
    clearTurnTimers();
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
  }, [clearTurnTimers]);

  /**
   * دریافت موقعیت مکانی زنده و واقعی از سنسور GPS دستگاه (maximumAge: 0)
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

  // Pre-warm short welcome prompts
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sampleWelcome = isEn ? "Hello! Go ahead, I'm ready to save." : 'سلام؛ بفرمایید ثبت کنم.';
    prewarmAiAssistantPrompt(sampleWelcome, isEn ? 'en' : 'fa', aiVoicePersona);
  }, [isEn, aiVoicePersona]);

  /**
   * موتور پیوسته و بدون لگ میکروفون (مشابه ChatGPT Voice Mode):
   * - از لحظه باز شدن مدال روشن می‌شود و در تمام طول مکالمه باز می‌ماند (هی خاموش و روشن نمی‌شود).
   * - در زمان صحبت گوینده (isAssistantSpeakingRef = true)، خروجی‌ها نادیده گرفته می‌شوند تا صدای خود گوینده ثبت نشود.
   * - به محض اتمام جمله گوینده، بدون حتی ۱ میلی‌ثانیه تاخیر راه‌اندازی، آماده دریافت اولین کلمه کاربر است.
   */
  const ensureRecognitionEngineRunning = useCallback(() => {
    if (!isOpenRef.current || showTextInputFallbackRef.current || typeof window === 'undefined') {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsListening(false);
      return;
    }

    // اگر موتور در حال حاضر فعال است، دوباره استارت نزن تا هیچ وقفه یا چشمک میکروفونی ایجاد نشود
    if (recognitionRef.current) {
      return;
    }

    const commitCurrentUtterance = () => {
      if (!isUserTurnActiveRef.current) return;
      const combined = appendWithoutDuplicate(
        accumulatedFinalRef.current,
        latestInterimRef.current
      ).trim();

      if (!combined) return;

      // پایان نوبت فعلی کاربر بدون خاموش کردن موتور میکروفون
      isUserTurnActiveRef.current = false;
      clearTurnTimers();

      // علامت‌گذاری تمام ایندکس‌های قبلی تا در نوبت بعدی دوباره خوانده نشوند
      for (let idx = 0; idx < latestResultCountRef.current; idx++) {
        ignoredResultIndicesRef.current.add(idx);
        processedFinalIndicesRef.current.add(idx);
      }

      accumulatedFinalRef.current = '';
      latestInterimRef.current = '';
      lastFinalChunkRef.current = '';

      setIsSpeechActive(false);
      setVoiceLevel(0);
      setLiveTranscript('');
      setInputText('');

      handleUserUtteranceRef.current(combined, false);
    };

    const schedulePostSpeechCommit = (baseDelayMs = 1550) => {
      if (speechDoneTimerRef.current) {
        clearTimeout(speechDoneTimerRef.current);
      }
      const sens = micSensitivityRef.current ?? 75;
      const sensitivityBonusMs = Math.round((sens - 50) * 5);
      const effectiveDelayMs = Math.max(1050, baseDelayMs + sensitivityBonusMs);

      speechDoneTimerRef.current = setTimeout(() => {
        commitCurrentUtterance();
      }, effectiveDelayMs);
    };

    try {
      const rec = new SpeechRecognition();
      rec.lang = isEn ? 'en-US' : 'fa-IR';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;

      processedFinalIndicesRef.current.clear();
      ignoredResultIndicesRef.current.clear();
      latestResultCountRef.current = 0;

      rec.onstart = () => {
        markPermissionGranted('microphone');
        if (isOpenRef.current && isUserTurnActiveRef.current && !isAssistantSpeakingRef.current) {
          setIsListening(true);
        }
      };

      rec.onsoundstart = () => {
        if (!isUserTurnActiveRef.current || isAssistantSpeakingRef.current || Date.now() < ttsMuteUntilRef.current) {
          return;
        }
        setIsSpeechActive(true);
        setVoiceLevel(55);
      };

      rec.onspeechstart = () => {
        if (!isUserTurnActiveRef.current || isAssistantSpeakingRef.current || Date.now() < ttsMuteUntilRef.current) {
          return;
        }
        setIsSpeechActive(true);
        setVoiceLevel(80);
      };

      rec.onresult = (event: any) => {
        latestResultCountRef.current = event.results?.length || 0;

        // اگر گوینده در حال صحبت است یا هنوز در بازه محافظ اکو (90ms) هستیم، این نتایج مربوط به صدای گوینده است
        if (
          !isUserTurnActiveRef.current ||
          isAssistantSpeakingRef.current ||
          Date.now() < ttsMuteUntilRef.current
        ) {
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i]?.isFinal) {
              ignoredResultIndicesRef.current.add(i);
              processedFinalIndicesRef.current.add(i);
            }
          }
          return;
        }

        let interimText = '';
        let heardNewUserWords = false;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (ignoredResultIndicesRef.current.has(i)) continue;
          const res = event.results[i];
          const bestTranscript = (res[0]?.transcript || '').trim();
          if (!bestTranscript) continue;

          heardNewUserWords = true;

          if (res.isFinal) {
            if (!processedFinalIndicesRef.current.has(i)) {
              processedFinalIndicesRef.current.add(i);
              if (bestTranscript !== lastFinalChunkRef.current) {
                lastFinalChunkRef.current = bestTranscript;
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

        if (!heardNewUserWords) return;

        // کاربر شروع به صحبت کرده است -> تایمر سکوت ریست شود
        if (silenceWatchdogTimerRef.current) {
          clearTimeout(silenceWatchdogTimerRef.current);
          silenceWatchdogTimerRef.current = null;
        }

        setIsSpeechActive(true);
        setVoiceLevel(60 + Math.floor(Math.random() * 35));

        const cleanInterim = interimText.trim();
        latestInterimRef.current = cleanInterim;

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
            isShortConfirm ? 850 : isStepShortAnswer ? 1150 : 1550
          );
        }
      };

      rec.onerror = (e: any) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          stopListening();
        }
      };

      rec.onend = () => {
        recognitionRef.current = null;

        // اگر کاربر جمله‌ای گفته بود و مرورگر جلسه تشخیص را بست، بلافاصله جمله او را ثبت کن
        if (isUserTurnActiveRef.current) {
          if (latestInterimRef.current.trim()) {
            accumulatedFinalRef.current = appendWithoutDuplicate(
              accumulatedFinalRef.current,
              latestInterimRef.current.trim()
            );
            latestInterimRef.current = '';
          }
          if (accumulatedFinalRef.current.trim()) {
            commitCurrentUtterance();
          }
        }

        // اگر مدال باز است و در حالت تایپ نیستیم، بدون خاموش کردن وضعیت کره، بلافاصله موتور را گرم نگه دار
        if (isOpenRef.current && shouldKeepListeningRef.current && !showTextInputFallbackRef.current) {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            if (isOpenRef.current && shouldKeepListeningRef.current && !showTextInputFallbackRef.current) {
              ensureRecognitionEngineRunning();
            }
          }, 20);
        } else {
          setIsListening(false);
          setIsSpeechActive(false);
          setVoiceLevel(0);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      recognitionRef.current = null;
    }
  }, [clearTurnTimers, isEn, stopListening]);

  /**
   * فعال‌سازی نوبت صحبت کاربر با تاخیر صفر (۰ میلی‌ثانیه):
   * چون موتور SpeechRecognition از قبل روشن و گرم است، بلافاصله در همان لحظه سبز/فعال شدن کره، صدای کاربر شنیده می‌شود.
   */
  const startListening = useCallback(() => {
    if (!isOpenRef.current || showTextInputFallbackRef.current || typeof window === 'undefined') {
      return;
    }

    stopSpeaking();
    clearTurnTimers();

    // علامت‌گذاری نتایج قبلی تا فقط صدای جدید کاربر در این نوبت دریافت شود
    for (let idx = 0; idx < latestResultCountRef.current; idx++) {
      ignoredResultIndicesRef.current.add(idx);
      processedFinalIndicesRef.current.add(idx);
    }

    accumulatedFinalRef.current = '';
    latestInterimRef.current = '';
    lastFinalChunkRef.current = '';
    setLiveTranscript('');

    shouldKeepListeningRef.current = true;
    isUserTurnActiveRef.current = true;
    setIsListening(true);
    setIsSpeechActive(false);

    ensureRecognitionEngineRunning();

    // اگر تا ۱۴ ثانیه هیچ صدای مفهومی دریافت نشد، گوینده مودبانه درخواست تکرار کند (و بعد از ۳ بار کادر تایپ را باز کند)
    silenceWatchdogTimerRef.current = setTimeout(() => {
      if (
        isOpenRef.current &&
        isUserTurnActiveRef.current &&
        !isAssistantSpeakingRef.current &&
        !accumulatedFinalRef.current.trim() &&
        !latestInterimRef.current.trim()
      ) {
        handleSilenceOrUnclearTimeoutRef.current();
      }
    }, 14000);
  }, [clearTurnTimers, ensureRecognitionEngineRunning, stopSpeaking]);

  /**
   * پخش صدای گوینده در حالی که موتور میکروفون در پس‌زمینه گرم می‌ماند (صفر لگ در شروع شنیدن)
   */
  const speakPromptWithCallback = useCallback(
    (rawText: string, onDone?: () => void) => {
      const cleanText = rawText.replace(/\s+/g, ' ').trim();
      if (!voiceEnabledRef.current || !cleanText || typeof window === 'undefined') {
        onDone?.();
        return;
      }

      clearTurnTimers();
      isUserTurnActiveRef.current = false;
      setIsSpeechActive(false);
      setVoiceLevel(0);

      // گرم نگه داشتن موتور تشخیص گفتار در پس‌زمینه حین صحبت گوینده تا به محض اتمام جمله، بدون تاخیر بشنود
      if (!showTextInputFallbackRef.current) {
        shouldKeepListeningRef.current = true;
        ensureRecognitionEngineRunning();
      }

      stopSpeaking();
      isAssistantSpeakingRef.current = true;
      setIsAssistantSpeaking(true);

      speakAiAssistantPrompt({
        text: cleanText,
        language: isEn ? 'en' : 'fa',
        voicePersona: aiVoicePersonaRef.current,
        volume: aiVoiceVolumeRef.current,
        onDone: () => {
          if (!isOpenRef.current) {
            isAssistantSpeakingRef.current = false;
            setIsAssistantSpeaking(false);
            return;
          }
          isAssistantSpeakingRef.current = false;
          ttsMuteUntilRef.current = Date.now() + 80;
          setIsAssistantSpeaking(false);

          // فعال‌سازی آنی دریافت صدای کاربر (۰ میلی‌ثانیه لگ چون میکروفون از قبل گرم است)
          if (isOpenRef.current) {
            onDone?.();
          }
        },
      });
    },
    [clearTurnTimers, ensureRecognitionEngineRunning, isEn, stopSpeaking]
  );

  /**
   * مدیریت صدای نامفهوم یا سکوت:
   * - تا ۳ مرتبه جملات کوتاه و متنوع («متوجه نشدم؛ بی‌زحمت یک بار دیگه بفرمایید.» و...) می‌گوید.
   * - اگر بیش از ۳ بار شد (مرتبه چهارم)، مودبانه از کاربر می‌خواهد تایپ کند و کادر تایپ را نمایش می‌دهد.
   */
  const triggerUnclearSpeechRetry = useCallback(() => {
    if (!isOpenRef.current) return;
    clearTurnTimers();
    isUserTurnActiveRef.current = false;

    unclearAttemptsRef.current += 1;
    const attempt = unclearAttemptsRef.current;

    if (attempt > 3) {
      showTextInputFallbackRef.current = true;
      setShowTextInputFallback(true);
      stopListening();

      const fallbackPrompt = getSmartTypeFallbackPrompt(language);
      const fallbackMsg: SmartChatMessage = {
        id: 'retry_type_' + Date.now(),
        role: 'assistant',
        text: fallbackPrompt,
        timestamp: Date.now(),
      };
      const nextMsgs = [...messagesRef.current, fallbackMsg];
      messagesRef.current = nextMsgs;
      setMessages(nextMsgs);

      speakPromptWithCallback(fallbackPrompt);
      return;
    }

    const retryPrompt = getSmartRetryPrompt(attempt, language);
    const retryMsg: SmartChatMessage = {
      id: 'retry_' + Date.now(),
      role: 'assistant',
      text: retryPrompt,
      timestamp: Date.now(),
    };
    const nextMsgs = [...messagesRef.current, retryMsg];
    messagesRef.current = nextMsgs;
    setMessages(nextMsgs);

    speakPromptWithCallback(retryPrompt, () => {
      if (isOpenRef.current && !showTextInputFallbackRef.current) {
        startListening();
      }
    });
  }, [clearTurnTimers, language, speakPromptWithCallback, startListening, stopListening]);

  useEffect(() => {
    handleSilenceOrUnclearTimeoutRef.current = triggerUnclearSpeechRetry;
  }, [triggerUnclearSpeechRetry]);

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

  // هنگام باز شدن مدال: جمله خوش‌آمدگویی کوتاه و متنوع پخش شده و میکروفون از همان لحظه اول در پس‌زمینه گرم و آماده می‌شود
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

    unclearAttemptsRef.current = 0;
    showTextInputFallbackRef.current = false;
    setShowTextInputFallback(false);

    const initialQuestion = getSmartWelcomePrompt(isEn ? 'en' : 'fa');

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

    // پیش‌راه‌اندازی میکروفون همزمان با شروع خوش‌آمدگویی کوتاه تا به محض پایان جمله، بدون هیچ لگی آماده شنیدن باشد
    shouldKeepListeningRef.current = true;
    ensureRecognitionEngineRunning();

    const timer = setTimeout(() => {
      speakPromptWithCallback(initialQuestion, () => {
        if (isOpenRef.current) {
          startListening();
        }
      });
    }, 20);

    return () => {
      clearTimeout(timer);
    };
  }, [
    ensureRecognitionEngineRunning,
    isOpen,
    isEn,
    speakPromptWithCallback,
    startListening,
    stopListening,
    stopSpeaking,
  ]);

  // به محض تشخیص دسته‌ی «مکان»، دریافت زنده و واقعی GPS (با maximumAge: 0) آغاز شود
  useEffect(() => {
    if (!isOpen || draft.intentType !== 'location') return;
    if (gpsStatus === 'idle') {
      acquireLiveGpsCoordinates();
    }
  }, [acquireLiveGpsCoordinates, draft.intentType, gpsStatus, isOpen]);

  const handleUserUtterance = useCallback(
    async (rawText: string, isTyped = false) => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      clearTurnTimers();
      isUserTurnActiveRef.current = false;
      setIsSpeechActive(false);
      setVoiceLevel(0);
      setInputText('');
      setLiveTranscript('');

      const activeDraft = draftRef.current;
      const wasAlreadyComplete = isCompleteRef.current && Boolean(activeDraft.title);

      // اگر در مرحله تایید نهایی هستیم و کاربر تایید کرد
      if (wasAlreadyComplete && isConfirmationUtterance(trimmed)) {
        unclearAttemptsRef.current = 0;
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

        // اگر صدای کاربر نامفهوم بود یا اطلاعات خواسته شده را نداشت (در حالت صوتی)
        if (analysis.unclearInput && !isTyped) {
          setIsAnalyzing(false);
          triggerUnclearSpeechRetry();
          return;
        }

        // ورودی معتبر دریافت شد -> شمارنده خطای وضوح صدا صفر شود
        unclearAttemptsRef.current = 0;

        draftRef.current = analysis.draft;
        isCompleteRef.current = analysis.isComplete;
        setDraft(analysis.draft);
        setIsComplete(analysis.isComplete);

        // اگر کاربر مستقیماً دستور ثبت داده باشد
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

        speakPromptWithCallback(analysis.clarifyingQuestion, () => {
          if (isOpenRef.current && !showTextInputFallbackRef.current) {
            startListening();
          }
        });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      clearTurnTimers,
      executeFinalSave,
      language,
      speakPromptWithCallback,
      startListening,
      triggerUnclearSpeechRetry,
    ]
  );

  useEffect(() => {
    handleUserUtteranceRef.current = handleUserUtterance;
  }, [handleUserUtterance]);

  if (!isOpen) return null;

  const lastAssistantMessage =
    [...messages].reverse().find((m) => m.role === 'assistant')?.text || '';
  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === 'user')?.text || '';

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

  const dynamicOrbScale = isSpeechActive
    ? 1 + Math.min(0.28, Math.max(0.06, voiceLevel / 190))
    : isListening
    ? 1 + Math.min(0.1, voiceLevel / 360)
    : 1;

  const handleOrbOrMicInteraction = () => {
    unlockAudio();
    // اگر منشی در حال صحبت است، با لمس کره صحبت او قطع شده و بلافاصله میکروفون برای شنیدن صدای کاربر فعال می‌شود
    if (isAssistantSpeaking) {
      stopSpeaking();
      showTextInputFallbackRef.current = false;
      setShowTextInputFallback(false);
      startListening();
      return;
    }
    const pendingText = (liveTranscript || inputText).trim();
    if (isListening && pendingText && !showTextInputFallback) {
      handleUserUtterance(pendingText, false);
    } else if (isListening) {
      stopListening();
    } else {
      showTextInputFallbackRef.current = false;
      setShowTextInputFallback(false);
      unclearAttemptsRef.current = 0;
      startListening();
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = inputText.trim();
    if (!cleaned) return;
    handleUserUtterance(cleaned, true);
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
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-xl w-full mx-auto my-2">
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
          className="relative w-52 h-52 sm:w-64 sm:h-64 flex items-center justify-center cursor-pointer group focus:outline-none"
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
                ? 'bg-emerald-500/10 border border-emerald-400/25'
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
                ? 'bg-emerald-400/15 border border-emerald-400/30'
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
                ? 'radial-gradient(circle at 32% 28%, #a7f3d0 0%, #10b981 48%, #065f46 88%, #022c22 100%)'
                : 'radial-gradient(circle at 32% 28%, #78716c 0%, #44403c 55%, #1c1917 100%)',
              boxShadow: isSpeechActive
                ? '0 0 75px rgba(16, 185, 129, 0.55), inset 0 -14px 28px rgba(0,0,0,0.45), inset 0 12px 24px rgba(255,255,255,0.35)'
                : isAssistantSpeaking
                ? '0 0 80px rgba(255, 140, 0, 0.65), inset 0 -14px 28px rgba(0,0,0,0.45), inset 0 12px 24px rgba(255,255,255,0.4)'
                : isListening
                ? '0 0 60px rgba(16, 185, 129, 0.45), inset 0 -12px 24px rgba(0,0,0,0.45), inset 0 10px 20px rgba(255,255,255,0.3)'
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
        <p className="mt-5 text-xs sm:text-sm font-bold tracking-wide text-stone-400 text-center">
          {isAnalyzing
            ? isEn
              ? 'Thinking...'
              : 'در حال تنظیم...'
            : isAssistantSpeaking
            ? isEn
              ? 'Speaking — Tap the orb anytime to interrupt'
              : 'در حال صحبت — هر زمان خواستید بفرمایید'
            : showTextInputFallback
            ? isEn
              ? 'Please type your request below'
              : 'لطفاً خواسته خود را در کادر پایین بنویسید'
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
        <div className="mt-3 min-h-[72px] max-w-md w-full flex flex-col items-center justify-center text-center px-3">
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
          <div className="mt-3 px-4 py-2 rounded-2xl bg-stone-900/75 border border-stone-800/90 text-center max-w-md">
            <p className="text-xs sm:text-sm font-bold text-amber-300 leading-relaxed">
              {minimalSummaryLine}
            </p>
          </div>
        )}

        {/* کادر تایپ محترمانه (فقط زمانی نمایش داده می‌شود که بیش از ۳ بار صدا واضح دریافت نشده باشد) */}
        {showTextInputFallback && (
          <form
            onSubmit={handleTextSubmit}
            onClick={(e) => e.stopPropagation()}
            className="mt-4 w-full max-w-md flex items-center gap-2 bg-stone-900/95 border border-amber-500/40 rounded-2xl p-2 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <Keyboard className="w-5 h-5 text-amber-400 mx-2 shrink-0" />
            <input
              ref={textInputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isEn ? 'Type your request here...' : 'اینجا بنویسید (مثلاً: فردا ساعت ۵ عصر دکتر)...'
              }
              className="flex-1 bg-transparent text-white text-sm sm:text-base placeholder-stone-500 focus:outline-none px-1 py-1.5"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              data-keep-color="true"
              className="h-10 px-4 rounded-xl bg-[#FF8C00] hover:bg-amber-500 disabled:opacity-40 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>{isEn ? 'Send' : 'ارسال'}</span>
            </button>
          </form>
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
            isSpeechActive || isListening
              ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-400/30'
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


