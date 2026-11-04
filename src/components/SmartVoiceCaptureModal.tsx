import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
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
  setNativeSpeechRecognizerMuteGate,
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
  isEchoOfAssistantSpeech,
  isIncompleteIntroductoryUtterance,
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

function selectSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // ignore
    }
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to read audio blob'));
    reader.readAsDataURL(blob);
  });
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

  // Half-duplex Turn Control & Direct Microphone VAD refs
  const recognitionRef = useRef<any>(null);
  const directStreamRef = useRef<MediaStream | null>(null);
  const vadAudioContextRef = useRef<AudioContext | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recorderMimeTypeRef = useRef<string>('audio/webm');
  const hasUserSpokenInTurnRef = useRef<boolean>(false);
  const lastVoiceActivityTimestampRef = useRef<number>(0);
  const isCommittingTurnRef = useRef<boolean>(false);
  const directTranscribeUnavailableRef = useRef<boolean>(false);
  const finishAndTranscribeDirectRef = useRef<() => void>(() => {});

  const shouldKeepListeningRef = useRef<boolean>(false);
  const isUserTurnActiveRef = useRef<boolean>(false);
  const isAssistantSpeakingRef = useRef<boolean>(false);
  const ttsMuteUntilRef = useRef<number>(0);
  const lastMicStopTimestampRef = useRef<number>(0);
  const silentRestartCountRef = useRef<number>(0);
  const unclearAttemptsRef = useRef<number>(0);
  const showTextInputFallbackRef = useRef<boolean>(false);
  const spokenPromptsHistoryRef = useRef<string[]>([]);

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
  const nativeMutePreStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeUnmuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (nativeMutePreStartTimerRef.current) {
      clearTimeout(nativeMutePreStartTimerRef.current);
      nativeMutePreStartTimerRef.current = null;
    }
  }, []);

  const cleanupDirectMicrophoneHardware = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (mediaRecorderRef.current) {
      const rec = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      try {
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.onerror = null;
        if (rec.state !== 'inactive') {
          rec.stop();
        }
      } catch {
        // ignore
      }
    }
    if (vadSourceRef.current) {
      try {
        vadSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      vadSourceRef.current = null;
    }
    vadAnalyserRef.current = null;
    if (directStreamRef.current) {
      try {
        directStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      directStreamRef.current = null;
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
   * قطع کامل و فوری میکروفون (هم هنگام بستن مدال و هم در تمام مدت صحبت گوینده):
   * - در صورت فعال بودن میکروفون مستقیم (getUserMedia)، تمام ترک‌های صوتی و MediaRecorder متوقف می‌شوند.
   * - در صورت فعال بودن SpeechRecognition، با abort() هرگونه صدای بافرشده دور ریخته می‌شود.
   * - برای خنثی شدن کامل بوق بسته شدن میکروفون در اندروید، بازگردانی صدا (unmute) با تاخیر ایمن ۳۲۰ میلی‌ثانیه انجام می‌شود.
   */
  const stopListening = useCallback(
    (unmuteNativeAfterStop = false) => {
      shouldKeepListeningRef.current = false;
      isUserTurnActiveRef.current = false;
      hasUserSpokenInTurnRef.current = false;
      isCommittingTurnRef.current = false;
      clearTurnTimers();
      cleanupDirectMicrophoneHardware();
      recordedChunksRef.current = [];

      if (recognitionRef.current) {
        const activeRec = recognitionRef.current;
        recognitionRef.current = null;
        lastMicStopTimestampRef.current = Date.now();
        try {
          activeRec.onstart = null;
          activeRec.onsoundstart = null;
          activeRec.onspeechstart = null;
          activeRec.onresult = null;
          activeRec.onerror = null;
          activeRec.onend = null;
        } catch {
          // ignore
        }
        safeAbortSpeechRecognition(activeRec);
      }

      if (unmuteNativeAfterStop) {
        if (nativeUnmuteTimerRef.current) {
          clearTimeout(nativeUnmuteTimerRef.current);
        }
        nativeUnmuteTimerRef.current = setTimeout(() => {
          nativeUnmuteTimerRef.current = null;
          if (!isUserTurnActiveRef.current && !recognitionRef.current) {
            setNativeSpeechRecognizerMuteGate(false);
          }
        }, 320);
      }

      accumulatedFinalRef.current = '';
      latestInterimRef.current = '';
      lastFinalChunkRef.current = '';
      setIsListening(false);
      setIsSpeechActive(false);
      setVoiceLevel(0);
    },
    [cleanupDirectMicrophoneHardware, clearTurnTimers]
  );

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
   * موتور تشخیص گفتار Native/WebView (با قفل بی‌صداکننده ۵ کاناله اندروید و بدون حلقه خاموش/روشن شدن مکرر):
   * - قبل از rec.start()، هر ۵ کانال صوتی اندروید (MUSIC, NOTIFICATION, SYSTEM, RING, DTMF) به حجم ۰ قفل می‌شوند.
   * - در داخل rec.onend هرگز قفل بی‌صداکننده باز نمی‌شود تا بوق بسته شدن میکروفون در اندروید ۱۰۰٪ خفه شود.
   * - حلقه ری‌استارت خودکار در حین صحبت حذف شده تا میکروفون هرگز وسط صحبت خاموش و روشن نشود.
   */
  const ensureRecognitionEngineRunning = useCallback(() => {
    if (
      !isOpenRef.current ||
      showTextInputFallbackRef.current ||
      isAssistantSpeakingRef.current ||
      !isUserTurnActiveRef.current ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsListening(false);
      return;
    }

    if (recognitionRef.current) {
      return;
    }

    if (nativeUnmuteTimerRef.current) {
      clearTimeout(nativeUnmuteTimerRef.current);
      nativeUnmuteTimerRef.current = null;
    }

    // قفل کردن کامل صداهای سیستم اندروید قبل از باز شدن میکروفون
    setNativeSpeechRecognizerMuteGate(true);

    const commitCurrentUtterance = () => {
      if (!isUserTurnActiveRef.current || isAssistantSpeakingRef.current || isCommittingTurnRef.current) {
        return;
      }
      const combined = appendWithoutDuplicate(
        accumulatedFinalRef.current,
        latestInterimRef.current
      ).trim();

      if (!combined) return;

      // فیلتر ضد اکوی صدای خود گوینده
      if (isEchoOfAssistantSpeech(combined, spokenPromptsHistoryRef.current)) {
        accumulatedFinalRef.current = '';
        latestInterimRef.current = '';
        lastFinalChunkRef.current = '';
        setLiveTranscript('');
        setInputText('');
        setIsSpeechActive(false);
        setVoiceLevel(0);
        return;
      }

      isCommittingTurnRef.current = true;
      stopListening(false);
      setLiveTranscript('');
      setInputText('');

      handleUserUtteranceRef.current(combined, false);
    };

    const schedulePostSpeechCommit = (baseDelayMs = 2800) => {
      if (speechDoneTimerRef.current) {
        clearTimeout(speechDoneTimerRef.current);
      }
      const sens = micSensitivityRef.current ?? 75;
      const sensitivityBonusMs = Math.round((sens - 50) * 8);
      const effectiveDelayMs = Math.max(1500, baseDelayMs + sensitivityBonusMs);

      speechDoneTimerRef.current = setTimeout(() => {
        commitCurrentUtterance();
      }, effectiveDelayMs);
    };

    const launchRecognitionInstance = () => {
      if (
        !isOpenRef.current ||
        showTextInputFallbackRef.current ||
        isAssistantSpeakingRef.current ||
        !isUserTurnActiveRef.current ||
        recognitionRef.current
      ) {
        return;
      }

      try {
        setNativeSpeechRecognizerMuteGate(true);
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
          if (
            !isUserTurnActiveRef.current ||
            isAssistantSpeakingRef.current ||
            Date.now() < ttsMuteUntilRef.current
          ) {
            return;
          }
          hasUserSpokenInTurnRef.current = true;
          lastVoiceActivityTimestampRef.current = Date.now();
          setIsSpeechActive(true);
          setVoiceLevel(55);
          if (speechDoneTimerRef.current) {
            schedulePostSpeechCommit(3400);
          }
        };

        rec.onspeechstart = () => {
          if (
            !isUserTurnActiveRef.current ||
            isAssistantSpeakingRef.current ||
            Date.now() < ttsMuteUntilRef.current
          ) {
            return;
          }
          hasUserSpokenInTurnRef.current = true;
          lastVoiceActivityTimestampRef.current = Date.now();
          setIsSpeechActive(true);
          setVoiceLevel(80);
          if (speechDoneTimerRef.current) {
            schedulePostSpeechCommit(3400);
          }
        };

        rec.onresult = (event: any) => {
          latestResultCountRef.current = event.results?.length || 0;

          if (
            !isUserTurnActiveRef.current ||
            isAssistantSpeakingRef.current ||
            Date.now() < ttsMuteUntilRef.current
          ) {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              ignoredResultIndicesRef.current.add(i);
              processedFinalIndicesRef.current.add(i);
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

            if (isEchoOfAssistantSpeech(bestTranscript, spokenPromptsHistoryRef.current)) {
              ignoredResultIndicesRef.current.add(i);
              processedFinalIndicesRef.current.add(i);
              continue;
            }

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

          const cleanInterim = interimText.trim();
          const candidateCombined = appendWithoutDuplicate(
            accumulatedFinalRef.current,
            cleanInterim
          ).trim();

          if (
            candidateCombined &&
            isEchoOfAssistantSpeech(candidateCombined, spokenPromptsHistoryRef.current)
          ) {
            accumulatedFinalRef.current = '';
            latestInterimRef.current = '';
            lastFinalChunkRef.current = '';
            setLiveTranscript('');
            setInputText('');
            return;
          }

          hasUserSpokenInTurnRef.current = true;
          lastVoiceActivityTimestampRef.current = Date.now();
          if (silenceWatchdogTimerRef.current) {
            clearTimeout(silenceWatchdogTimerRef.current);
            silenceWatchdogTimerRef.current = null;
          }

          setIsSpeechActive(true);
          setVoiceLevel(65 + Math.floor(Math.random() * 30));

          latestInterimRef.current = cleanInterim;

          if (candidateCombined) {
            setLiveTranscript(candidateCombined);
            setInputText(candidateCombined);

            if (cleanInterim.length > 0) {
              schedulePostSpeechCommit(2200);
            } else {
              const isIntroOnly = isIncompleteIntroductoryUtterance(candidateCombined);
              const isConfirmOnly =
                draftRef.current.wizardStep === 'confirm' &&
                isConfirmationUtterance(candidateCombined);

              schedulePostSpeechCommit(
                isIntroOnly ? 2600 : isConfirmOnly ? 1050 : 1600
              );
            }
          }
        };

        rec.onerror = (e: any) => {
          if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
            stopListening(true);
          }
        };

        rec.onend = () => {
          recognitionRef.current = null;
          lastMicStopTimestampRef.current = Date.now();

          // هرگز داخل onend صدای سیستم اندروید را unmute نکن تا بوق بسته شدن میکروفون ۱۰۰٪ بی‌صدا بماند!
          if (isUserTurnActiveRef.current && !isAssistantSpeakingRef.current) {
            const pendingInterim = latestInterimRef.current.trim();
            if (
              pendingInterim &&
              !isEchoOfAssistantSpeech(pendingInterim, spokenPromptsHistoryRef.current)
            ) {
              accumulatedFinalRef.current = appendWithoutDuplicate(
                accumulatedFinalRef.current,
                pendingInterim
              );
              latestInterimRef.current = '';
            }
            const finalSoFar = accumulatedFinalRef.current.trim();
            if (finalSoFar) {
              commitCurrentUtterance();
              return;
            }

            // در محیط نیتیو اندروید (APK) که هر ۵ کانال صوتی با پلاگین کاتلین روی صفر قفل شده‌اند (بدون هیچ بوقی)،
            // اگر موتور قبل از شروع صحبت کاربر متوقف شد، در همان حالت قفل بی‌صدا میکروفون را باز نگه دار
            if (
              Capacitor.isNativePlatform() &&
              shouldKeepListeningRef.current &&
              silentRestartCountRef.current < 4
            ) {
              silentRestartCountRef.current += 1;
              setNativeSpeechRecognizerMuteGate(true);
              setTimeout(() => {
                if (
                  isOpenRef.current &&
                  isUserTurnActiveRef.current &&
                  !isAssistantSpeakingRef.current
                ) {
                  launchRecognitionInstance();
                }
              }, 120);
              return;
            }
          }

          setIsListening(false);
          setIsSpeechActive(false);
          setVoiceLevel(0);
        };

        recognitionRef.current = rec;
        rec.start();
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
      }
    };

    // صبر ۹۰ میلی‌ثانیه‌ای پس از قفل کردن ۵ کانال صوتی اندروید تا بوق شروع میکروفون ۱۰۰٪ خفه شود
    const elapsedSinceStop = Date.now() - lastMicStopTimestampRef.current;
    const waitMs = Math.max(90, 360 - elapsedSinceStop);
    if (nativeMutePreStartTimerRef.current) {
      clearTimeout(nativeMutePreStartTimerRef.current);
    }
    nativeMutePreStartTimerRef.current = setTimeout(() => {
      nativeMutePreStartTimerRef.current = null;
      launchRecognitionInstance();
    }, waitMs);
  }, [ isEn, stopListening]);

  /**
   * موتور ضبط یکپارچه با میکروفون مستقیم (getUserMedia + Web Audio AnalyserNode VAD + MediaRecorder):
   * - بدون هیچ صدای بوق سیستم اندروید (چه در مرورگر کروم موبایل و چه در وب‌اپ).
   * - بدون هیچ خاموش و روشن شدن میکروفون در حین مکث یا صحبت کاربر (میکروفون به صورت یکپارچه باز می‌ماند).
   * - تشخیص دقیق شروع و پایان صحبت کاربر بر اساس انرژی فرکانس گفتار انسان (۸۵ تا ۳۴۰۰ هرتز) و سکوت واقعی.
   */
  const startDirectMicrophoneSession = useCallback(async (): Promise<boolean> => {
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      if (
        !isOpenRef.current ||
        !isUserTurnActiveRef.current ||
        isAssistantSpeakingRef.current ||
        showTextInputFallbackRef.current
      ) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
        return false;
      }

      markPermissionGranted('microphone');
      directStreamRef.current = stream;
      recordedChunksRef.current = [];
      hasUserSpokenInTurnRef.current = false;
      isCommittingTurnRef.current = false;

      const mimeType = selectSupportedAudioMimeType();
      recorderMimeTypeRef.current = mimeType || 'audio/webm';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(200);

      // راه‌اندازی آنالیزور طیف فرکانس گفتار (Web Audio AnalyserNode VAD)
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!vadAudioContextRef.current || vadAudioContextRef.current.state === 'closed') {
        vadAudioContextRef.current = new AudioContextClass();
      }
      const audioCtx = vadAudioContextRef.current;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.42;
      source.connect(analyser);

      vadSourceRef.current = source;
      vadAnalyserRef.current = analyser;

      // کره دقیقاً زمانی سبز می‌شود که جریان میکروفون مستقیم باز و آماده دریافت صداست
      setIsListening(true);

      const finishAndTranscribeDirect = async () => {
        if (isCommittingTurnRef.current || !isUserTurnActiveRef.current) return;
        isCommittingTurnRef.current = true;
        isUserTurnActiveRef.current = false;
        shouldKeepListeningRef.current = false;
        clearTurnTimers();

        if (vadRafRef.current !== null) {
          cancelAnimationFrame(vadRafRef.current);
          vadRafRef.current = null;
        }

        const activeRecorder = mediaRecorderRef.current;
        mediaRecorderRef.current = null;

        const audioBlob: Blob = await new Promise((resolve) => {
          if (!activeRecorder || activeRecorder.state === 'inactive') {
            resolve(
              new Blob(recordedChunksRef.current, {
                type: recorderMimeTypeRef.current || 'audio/webm',
              })
            );
            return;
          }
          const safetyTimeout = setTimeout(() => {
            resolve(
              new Blob(recordedChunksRef.current, {
                type: recorderMimeTypeRef.current || 'audio/webm',
              })
            );
          }, 400);
          activeRecorder.onstop = () => {
            clearTimeout(safetyTimeout);
            resolve(
              new Blob(recordedChunksRef.current, {
                type: recorderMimeTypeRef.current || 'audio/webm',
              })
            );
          };
          try {
            activeRecorder.stop();
          } catch {
            clearTimeout(safetyTimeout);
            resolve(
              new Blob(recordedChunksRef.current, {
                type: recorderMimeTypeRef.current || 'audio/webm',
              })
            );
          }
        });

        cleanupDirectMicrophoneHardware();
        recordedChunksRef.current = [];
        setIsListening(false);
        setIsSpeechActive(false);
        setVoiceLevel(0);

        if (!isOpenRef.current || isAssistantSpeakingRef.current) {
          return;
        }

        if (!audioBlob || audioBlob.size < 250) {
          handleSilenceOrUnclearTimeoutRef.current();
          return;
        }

        setIsAnalyzing(true);
        try {
          const audioBase64 = await blobToBase64(audioBlob);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 9000);
          const res = await fetch('/api/smart-capture/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64,
              mimeType: recorderMimeTypeRef.current || 'audio/webm',
              language: isEn ? 'en' : 'fa',
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            directTranscribeUnavailableRef.current = true;
            setIsAnalyzing(false);
            if (isOpenRef.current && !showTextInputFallbackRef.current) {
              isUserTurnActiveRef.current = true;
              shouldKeepListeningRef.current = true;
              isCommittingTurnRef.current = false;
              ensureRecognitionEngineRunning();
            }
            return;
          }

          const data = await res.json();
          const transcript = (data?.transcript || '').trim();
          setIsAnalyzing(false);

          if (!transcript) {
            handleSilenceOrUnclearTimeoutRef.current();
            return;
          }

          setLiveTranscript(transcript);
          setInputText(transcript);
          handleUserUtteranceRef.current(transcript, false);
        } catch {
          setIsAnalyzing(false);
          directTranscribeUnavailableRef.current = true;
          if (isOpenRef.current && !showTextInputFallbackRef.current) {
            isUserTurnActiveRef.current = true;
            shouldKeepListeningRef.current = true;
            isCommittingTurnRef.current = false;
            ensureRecognitionEngineRunning();
          }
        }
      };

      finishAndTranscribeDirectRef.current = () => {
        finishAndTranscribeDirect();
      };

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const timeData = new Uint8Array(analyser.fftSize);
      const sampleRate = audioCtx.sampleRate || 48000;
      const binHz = sampleRate / analyser.fftSize;
      const minBin = Math.max(1, Math.floor(95 / binHz));
      const maxBin = Math.min(analyser.frequencyBinCount - 1, Math.ceil(2900 / binHz));

      let noiseFloor = 16;
      let peakVocalSignal = 32;
      let consecutiveSpeechFrames = 0;
      let totalSpeechFrames = 0;
      let firstSpeechOnsetTs = 0;
      let lastUiUpdateTs = 0;
      const turnStartedAt = Date.now();

      const vadLoop = () => {
        if (
          !isOpenRef.current ||
          !isUserTurnActiveRef.current ||
          isAssistantSpeakingRef.current ||
          isCommittingTurnRef.current ||
          !vadAnalyserRef.current
        ) {
          return;
        }

        const now = Date.now();
        vadAnalyserRef.current.getByteFrequencyData(freqData);
        vadAnalyserRef.current.getByteTimeDomainData(timeData);

        // ۱. محاسبه میانگین ۶ قله فرکانسی قوی در باند گفتار انسان (۹۵ تا ۲۹۰۰ هرتز) برای تشخیص دقیق فرمنت‌های صدا
        let top1 = 0,
          top2 = 0,
          top3 = 0,
          top4 = 0,
          top5 = 0,
          top6 = 0;
        for (let i = minBin; i <= maxBin; i++) {
          const val = freqData[i];
          if (val > top1) {
            top6 = top5;
            top5 = top4;
            top4 = top3;
            top3 = top2;
            top2 = top1;
            top1 = val;
          } else if (val > top2) {
            top6 = top5;
            top5 = top4;
            top4 = top3;
            top3 = top2;
            top2 = val;
          } else if (val > top3) {
            top6 = top5;
            top5 = top4;
            top4 = top3;
            top3 = val;
          } else if (val > top4) {
            top6 = top5;
            top5 = top4;
            top4 = val;
          } else if (val > top5) {
            top6 = top5;
            top5 = val;
          } else if (val > top6) {
            top6 = val;
          }
        }
        const topFormantAvg = (top1 + top2 + top3 + top4 + top5 + top6) / 6;

        // ۲. محاسبه انرژی دامنه زمانی (RMS) برای تشخیص حروف بی‌صدا (س، ش، ت، ف، ک) و صدای آرام
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          const centered = timeData[i] - 128;
          sumSq += centered * centered;
        }
        const rmsRaw = Math.sqrt(sumSq / timeData.length);
        const vocalSignal = Math.max(topFormantAvg, rmsRaw * 3.4);

        const sens = micSensitivityRef.current ?? 75;
        const baseThreshold = Math.max(20, 34 - (sens - 50) * 0.25);
        const onsetThreshold = Math.max(baseThreshold, noiseFloor * 1.42 + 6);
        // هیسترزیس: پس از شروع صحبت کاربر، نویز ضعیف محیط یا AGC نباید تایمر سکوت را ریست کند
        const holdThreshold = hasUserSpokenInTurnRef.current
          ? Math.max(onsetThreshold * 0.9, noiseFloor + 10, peakVocalSignal * 0.34)
          : onsetThreshold;

        const isFrameVocal =
          now >= ttsMuteUntilRef.current &&
          vocalSignal > (hasUserSpokenInTurnRef.current ? holdThreshold : onsetThreshold);

        if (isFrameVocal) {
          consecutiveSpeechFrames += 1;
          peakVocalSignal = Math.min(115, Math.max(peakVocalSignal, vocalSignal * 0.88));

          if (consecutiveSpeechFrames >= 2) {
            lastVoiceActivityTimestampRef.current = now;
            totalSpeechFrames += 1;

            if (totalSpeechFrames >= 2 && !hasUserSpokenInTurnRef.current) {
              hasUserSpokenInTurnRef.current = true;
              firstSpeechOnsetTs = now;
              if (silenceWatchdogTimerRef.current) {
                clearTimeout(silenceWatchdogTimerRef.current);
                silenceWatchdogTimerRef.current = null;
              }
            }

            if (now - lastUiUpdateTs >= 50) {
              lastUiUpdateTs = now;
              const scaledLevel = Math.min(
                100,
                Math.max(40, Math.round((vocalSignal - onsetThreshold) * 1.6 + 48))
              );
              setIsSpeechActive(true);
              setVoiceLevel(scaledLevel);
            }
          }

          // سقف زمانی ایمنی پس از شروع صحبت تا حتی در محیط بسیار شلوغ هم گفتار کاربر حتماً پردازش شود
          if (hasUserSpokenInTurnRef.current && firstSpeechOnsetTs > 0 && now - firstSpeechOnsetTs >= 10500) {
            finishAndTranscribeDirect();
            return;
          }
        } else {
          consecutiveSpeechFrames = Math.max(0, consecutiveSpeechFrames - 1);
          if (!hasUserSpokenInTurnRef.current) {
            noiseFloor = Math.max(10, Math.min(38, noiseFloor * 0.95 + vocalSignal * 0.05));
          }

          if (now - lastUiUpdateTs >= 75) {
            lastUiUpdateTs = now;
            if (hasUserSpokenInTurnRef.current && now - lastVoiceActivityTimestampRef.current < 320) {
              setVoiceLevel((prev) => Math.max(22, Math.round(prev * 0.72)));
            } else {
              setIsSpeechActive(false);
              setVoiceLevel(Math.min(16, Math.round(vocalSignal * 0.25)));
            }
          }

          // تشخیص پایان صحبت بر اساس سکوت طبیعی کاربر (۱.۱ ثانیه در مرحله تایید، ۱.۴ ثانیه در مراحل عادی)
          if (hasUserSpokenInTurnRef.current) {
            const silenceDurationMs = now - lastVoiceActivityTimestampRef.current;
            const isConfirmStep = draftRef.current.wizardStep === 'confirm';
            const requiredSilenceMs = isConfirmStep
              ? 1100
              : Math.max(1350, 1480 - Math.round((sens - 50) * 3));
            if (silenceDurationMs >= requiredSilenceMs || now - turnStartedAt >= 24000) {
              finishAndTranscribeDirect();
              return;
            }
          }
        }

        vadRafRef.current = requestAnimationFrame(vadLoop);
      };

      vadRafRef.current = requestAnimationFrame(vadLoop);
      return true;
    } catch {
      cleanupDirectMicrophoneHardware();
      return false;
    }
  }, [cleanupDirectMicrophoneHardware, clearTurnTimers, ensureRecognitionEngineRunning, isEn]);

  /**
   * شروع نوبت گوش دادن به کاربر (فقط پس از اتمام کامل صحبت گوینده):
   * - در مرورگر موبایل/وب، از میکروفون مستقیم (getUserMedia + Web Audio VAD + MediaRecorder) استفاده می‌کند تا هیچ بوقی نزند و هرگز قطع و وصل نشود.
   * - در محیط آفلاین/APK، از موتور تشخیص گفتار با قفل ۵ کاناله بی‌صداکننده اندروید استفاده می‌کند.
   */
  const startListening = useCallback(() => {
    if (
      !isOpenRef.current ||
      showTextInputFallbackRef.current ||
      isAssistantSpeakingRef.current ||
      typeof window === 'undefined'
    ) {
      return;
    }

    stopSpeaking();
    clearTurnTimers();
    cleanupDirectMicrophoneHardware();

    accumulatedFinalRef.current = '';
    latestInterimRef.current = '';
    lastFinalChunkRef.current = '';
    silentRestartCountRef.current = 0;
    hasUserSpokenInTurnRef.current = false;
    isCommittingTurnRef.current = false;
    processedFinalIndicesRef.current.clear();
    ignoredResultIndicesRef.current.clear();
    setLiveTranscript('');

    shouldKeepListeningRef.current = true;
    isUserTurnActiveRef.current = true;
    setIsSpeechActive(false);

    const isNativeOrStaticHost =
      Capacitor.isNativePlatform() ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'file:' ||
      window.location.hostname.includes('github.io');

    const canUseDirectMicTranscribe =
      !isNativeOrStaticHost &&
      !directTranscribeUnavailableRef.current &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined';

    if (canUseDirectMicTranscribe) {
      startDirectMicrophoneSession().then((started) => {
        if (!started && isOpenRef.current && isUserTurnActiveRef.current && !isAssistantSpeakingRef.current) {
          ensureRecognitionEngineRunning();
        }
      });
    } else {
      if (recognitionRef.current) {
        setIsListening(true);
      } else {
        ensureRecognitionEngineRunning();
      }
    }

    // اگر تا ۱۴ ثانیه هیچ صدای مفهومی دریافت نشد، در صورت وجود صدای ضبط‌شده ابتدا آن را بررسی کن وگرنه مودبانه درخواست تکرار کن
    silenceWatchdogTimerRef.current = setTimeout(() => {
      if (
        isOpenRef.current &&
        isUserTurnActiveRef.current &&
        !isAssistantSpeakingRef.current &&
        !accumulatedFinalRef.current.trim() &&
        !latestInterimRef.current.trim()
      ) {
        if (mediaRecorderRef.current && recordedChunksRef.current.length > 0 && hasUserSpokenInTurnRef.current) {
          finishAndTranscribeDirectRef.current();
        } else {
          handleSilenceOrUnclearTimeoutRef.current();
        }
      }
    }, 14000);
  }, [
    cleanupDirectMicrophoneHardware,
    clearTurnTimers,
    ensureRecognitionEngineRunning,
    startDirectMicrophoneSession,
    stopSpeaking,
  ]);

  /**
   * پخش صدای گوینده با خاموشی ۱۰۰٪ میکروفون در حین صحبت:
   * - قبل از شروع صدای گوینده، میکروفون به طور کامل بسته می‌شود تا صدای گوینده وارد میکروفون نشود.
   * - اگر میکروفون روشن بوده باشد، ۳۰۰ میلی‌ثانیه صبر می‌کند تا صدای بوق بسته شدن میکروفون اندروید در حالت Mute کامل خنثی شود و سپس صدای گوینده را پخش می‌کند.
   * - پس از اتمام کامل پخش صوت، ۲۴۰ میلی‌ثانیه صبر می‌کند تا انعکاس صدای اسپیکر در محیط محو شود و سپس میکروفون را باز می‌کند.
   */
  const speakPromptWithCallback = useCallback(
    (rawText: string, onDone?: () => void) => {
      const cleanText = rawText.replace(/\s+/g, ' ').trim();
      if (cleanText) {
        spokenPromptsHistoryRef.current = [
          ...spokenPromptsHistoryRef.current.slice(-12),
          cleanText,
        ];
      }

      const hadActiveNativeRec = Boolean(recognitionRef.current);

      // ۱. خاموش کردن قطعی میکروفون قبل از شروع صحبت گوینده
      stopListening(false);
      stopSpeaking();

      if (!voiceEnabledRef.current || !cleanText || typeof window === 'undefined') {
        setTimeout(() => {
          if (!isUserTurnActiveRef.current) {
            setNativeSpeechRecognizerMuteGate(false);
          }
        }, 320);
        onDone?.();
        return;
      }

      isAssistantSpeakingRef.current = true;
      setIsAssistantSpeaking(true);

      const startTtsPlayback = () => {
        if (!isOpenRef.current) {
          isAssistantSpeakingRef.current = false;
          setIsAssistantSpeaking(false);
          setNativeSpeechRecognizerMuteGate(false);
          return;
        }

        // باز کردن صدای خروجی اسپیکر دقیقاً پس از خنثی شدن کامل بوق بسته شدن میکروفون
        setNativeSpeechRecognizerMuteGate(false);

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

            // ۲. محافظ آکوستیک پس از پایان صدای اسپیکر (۲۴۰ میلی‌ثانیه) تا پژواک اتاق وارد میکروفون نشود
            ttsMuteUntilRef.current = Date.now() + 280;
            if (ttsWaitTimerRef.current) {
              clearTimeout(ttsWaitTimerRef.current);
            }
            ttsWaitTimerRef.current = setTimeout(() => {
              ttsWaitTimerRef.current = null;
              isAssistantSpeakingRef.current = false;
              setIsAssistantSpeaking(false);
              if (isOpenRef.current) {
                onDone?.();
              }
            }, 240);
          },
        });
      };

      if (hadActiveNativeRec) {
        ttsWaitTimerRef.current = setTimeout(() => {
          ttsWaitTimerRef.current = null;
          startTtsPlayback();
        }, 300);
      } else {
        startTtsPlayback();
      }
    },
    [isEn, stopListening, stopSpeaking]
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
      stopListening(false);

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
      stopListening(true);
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

  // هنگام باز شدن مدال: میکروفون در حین گویش خوش‌آمدگویی کاملاً خاموش است و فقط پس از پایان جمله گوینده فعال می‌شود
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      stopListening(true);
      stopSpeaking();
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('yaad:stop-all-microphones'));
    }

    unlockAudio();
    stopListening(false);

    unclearAttemptsRef.current = 0;
    silentRestartCountRef.current = 0;
    showTextInputFallbackRef.current = false;
    setShowTextInputFallback(false);

    const initialQuestion = getSmartWelcomePrompt(isEn ? 'en' : 'fa');
    spokenPromptsHistoryRef.current = [initialQuestion];

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
        if (isOpenRef.current && !showTextInputFallbackRef.current) {
          startListening();
        }
      });
    }, 20);

    return () => {
      clearTimeout(timer);
    };
  }, [
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

      // اگر صدای دریافت‌شده اکوی خود گوینده بود، هرگز آن را به عنوان ورودی کاربر ثبت نکن
      if (!isTyped && isEchoOfAssistantSpeech(trimmed, spokenPromptsHistoryRef.current)) {
        if (isOpenRef.current && !showTextInputFallbackRef.current && !isAssistantSpeakingRef.current) {
          startListening();
        }
        return;
      }

      stopListening();
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
      executeFinalSave,
      language,
      speakPromptWithCallback,
      startListening,
      stopListening,
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
    } else if (
      isListening &&
      (mediaRecorderRef.current || recordedChunksRef.current.length > 0) &&
      !showTextInputFallback
    ) {
      finishAndTranscribeDirectRef.current();
    } else if (isListening) {
      stopListening(true);
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
            stopListening(true);
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


