import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
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
} from 'lucide-react';
import { IdeaNote, Occasion, Reminder, SavedLocation } from '../types';
import {
  PERSIAN_MONTHS,
  formatJalaliFull,
  getJalaliComponents,
  toPersianDigits,
} from '../utils/jalali';
import { requestLocationPermission, markPermissionGranted } from '../utils/nativePermissions';
import { getLastKnownPosition, saveLastKnownPosition } from '../utils/geofenceManager';
import { appendWithoutDuplicate, safeAbortSpeechRecognition } from '../utils/speechDeduplication';
import {
  SmartCaptureDraft,
  SmartChatMessage,
  SmartIntentType,
  analyzeSmartCaptureTurn,
  computeReminderTimestampFromDraft,
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
}

export const SmartVoiceCaptureModal: React.FC<SmartVoiceCaptureModalProps> = ({
  isOpen,
  onClose,
  onSaveReminder,
  onSaveOccasion,
  onSaveLocation,
  onSaveIdea,
  language = 'fa',
}) => {
  const isEn = language === 'en';

  const [messages, setMessages] = useState<SmartChatMessage[]>([]);
  const [draft, setDraft] = useState<SmartCaptureDraft>({ intentType: 'unknown' });
  const [isComplete, setIsComplete] = useState(false);
  const [quickSuggestions, setQuickSuggestions] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [voiceFeedbackEnabled, setVoiceFeedbackEnabled] = useState(true);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [autoSaveCountdown, setAutoSaveCountdown] = useState<number | null>(null);

  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const speechStartTimeRef = useRef<number>(0);
  const lastSpeechTimeRef = useRef<number>(0);
  const accumulatedFinalRef = useRef<string>('');
  const latestInterimRef = useRef<string>('');
  const lastFinalChunkRef = useRef<string>('');
  const processedFinalIndicesRef = useRef<Set<number>>(new Set());

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const handleUserUtteranceRef = useRef<(text: string) => void>(() => {});
  const handleSilenceOnIncompleteRef = useRef<() => void>(() => {});
  const isOpenRef = useRef(isOpen);
  const draftRef = useRef(draft);
  const isCompleteRef = useRef(isComplete);
  const voiceEnabledRef = useRef(voiceFeedbackEnabled);
  const autoSaveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silencePromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearAutoSaveTimers = useCallback(() => {
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    setAutoSaveCountdown(null);
  }, []);

  const activeTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsClientCacheRef = useRef<Map<string, string>>(new Map());

  const stopSpeaking = useCallback(() => {
    setIsAssistantSpeaking(false);
    if (activeTtsAudioRef.current) {
      try {
        activeTtsAudioRef.current.onended = null;
        activeTtsAudioRef.current.onerror = null;
        activeTtsAudioRef.current.pause();
        activeTtsAudioRef.current.src = '';
      } catch {
        // ignore
      }
      activeTtsAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }, []);

  // Pre-warm the conversational welcome voice in the background so it plays immediately when the modal opens
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const welcomeText = isEn
      ? "Hi there! I'm ready. Tell me, what reminder, occasion, location, or idea would you like me to save for you?"
      : 'سلام! من آماده‌ام؛ بگو چه یادآور، مناسبت، مکان یا ایده‌ای رو می‌خوای برات ثبت کنم؟';
    const langKey = isEn ? 'en' : 'fa';
    const cacheKey = `${langKey}:${welcomeText}`;
    if (ttsClientCacheRef.current.has(cacheKey)) return;

    fetch('/api/smart-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: welcomeText, language: langKey }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data?.audioBase64) {
          ttsClientCacheRef.current.set(cacheKey, data.audioBase64);
        }
      })
      .catch(() => {});
  }, [isEn]);

  /**
   * بیان صوتی کامل سوال با لحن صمیمی و محاوره‌ای (فارسی در تنظیم فارسی و انگلیسی در تنظیم انگلیسی)
   * ابتدا سوال به صورت کامل خوانده می‌شود و پس از اتمام آن، میکروفون فعال شده و منتظر پاسخ کاربر می‌ماند.
   */
  const speakPromptWithCallback = useCallback(
    (rawText: string, onDone?: () => void) => {
      const cleanText = rawText.replace(/\s+/g, ' ').trim();
      if (!voiceEnabledRef.current || !cleanText || typeof window === 'undefined') {
        onDone?.();
        return;
      }

      stopSpeaking();
      setIsAssistantSpeaking(true);

      let finished = false;
      const completeAndContinue = () => {
        if (finished) return;
        finished = true;
        setIsAssistantSpeaking(false);
        // مکث کوتاه پس از اتمام کامل سوال صوتی تا میکروفون بلافاصله آماده دریافت پاسخ کاربر شود
        setTimeout(() => {
          onDone?.();
        }, 220);
      };

      const playBase64Wav = (audioBase64: string, onFallback: () => void) => {
        try {
          const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
          activeTtsAudioRef.current = audio;
          const maxAudioWait = setTimeout(completeAndContinue, 15000);

          audio.onended = () => {
            clearTimeout(maxAudioWait);
            completeAndContinue();
          };
          audio.onerror = () => {
            clearTimeout(maxAudioWait);
            onFallback();
          };

          audio.play().catch(() => {
            clearTimeout(maxAudioWait);
            onFallback();
          });
        } catch {
          onFallback();
        }
      };

      const playViaBrowserSpeechSynthesis = () => {
        if (!('speechSynthesis' in window)) {
          completeAndContinue();
          return;
        }

        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(cleanText);
          utterance.lang = isEn ? 'en-US' : 'fa-IR';
          // کمی گرم‌تر و طبیعی‌تر برای لحن صمیمی و محاوره‌ای
          utterance.rate = isEn ? 1.0 : 0.98;
          utterance.pitch = 1.05;

          const voices = window.speechSynthesis.getVoices();
          const exactLangVoice = voices.find((v) =>
            isEn
              ? v.lang.toLowerCase().startsWith('en')
              : v.lang.toLowerCase().startsWith('fa') || v.name.toLowerCase().includes('persian')
          );
          const fallbackRtlVoice = !isEn
            ? voices.find((v) => v.lang.toLowerCase().startsWith('ar'))
            : undefined;

          if (exactLangVoice) {
            utterance.voice = exactLangVoice;
          } else if (fallbackRtlVoice) {
            utterance.voice = fallbackRtlVoice;
          }

          const maxSafetyMs = Math.max(7000, cleanText.length * 125);
          const safetyTimer = setTimeout(completeAndContinue, maxSafetyMs);

          utterance.onend = () => {
            clearTimeout(safetyTimer);
            completeAndContinue();
          };
          utterance.onerror = () => {
            clearTimeout(safetyTimer);
            completeAndContinue();
          };

          // If Persian is active and device WebView has no Persian voice at all, try online Google TTS audio stream first
          if (!isEn && !exactLangVoice) {
            try {
              const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=fa&client=tw-ob&q=${encodeURIComponent(
                cleanText
              )}`;
              const audio = new Audio(ttsUrl);
              activeTtsAudioRef.current = audio;
              audio.onended = () => {
                clearTimeout(safetyTimer);
                completeAndContinue();
              };
              audio.onerror = () => {
                window.speechSynthesis.speak(utterance);
              };
              audio.play().catch(() => {
                window.speechSynthesis.speak(utterance);
              });
              return;
            } catch {
              // continue to speechSynthesis below
            }
          }

          window.speechSynthesis.speak(utterance);
        } catch {
          completeAndContinue();
        }
      };

      const langKey = isEn ? 'en' : 'fa';
      const cacheKey = `${langKey}:${cleanText}`;
      const cached = ttsClientCacheRef.current.get(cacheKey);
      if (cached) {
        playBase64Wav(cached, playViaBrowserSpeechSynthesis);
        return;
      }

      // Tier 1: Server-side Gemini TTS (/api/smart-tts) with warm, friendly, conversational persona
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 7500);

      fetch('/api/smart-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          language: langKey,
        }),
        signal: controller.signal,
      })
        .then(async (res) => {
          clearTimeout(fetchTimeout);
          if (!res.ok) throw new Error('TTS HTTP error');
          const data = await res.json();
          if (!data?.ok || !data?.audioBase64) throw new Error('No audioBase64');

          ttsClientCacheRef.current.set(cacheKey, data.audioBase64);
          playBase64Wav(data.audioBase64, playViaBrowserSpeechSynthesis);
        })
        .catch(() => {
          clearTimeout(fetchTimeout);
          playViaBrowserSpeechSynthesis();
        });
    },
    [isEn, stopSpeaking]
  );

  // Auto-scroll conversation
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveTranscript, isAnalyzing, autoSaveCountdown]);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    if (speechDoneTimerRef.current) {
      clearTimeout(speechDoneTimerRef.current);
      speechDoneTimerRef.current = null;
    }
    if (silencePromptTimerRef.current) {
      clearTimeout(silencePromptTimerRef.current);
      silencePromptTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (recognitionRef.current) {
      safeAbortSpeechRecognition(recognitionRef.current);
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsSpeechActive(false);
    setVoiceLevel(0);
  }, []);

  /**
   * فعال‌سازی میکروفون در حالت «منتظر دستور» بدون تداخل getUserMedia:
   * - در حالت منتظر دستور، میکروفون فعال می‌ماند و به محض شروع صحبت کاربر، گفتار را زنده به متن تبدیل می‌کند.
   * - پس از اتمام جمله کاربر (۱.۳۵ ثانیه مکث پس از آخرین کلمه)، متن تبدیل‌شده بلافاصله وارد فرآیند تحلیل و ثبت هوشمند می‌شود.
   */
  const startListening = useCallback(() => {
    if (!isOpenRef.current || typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsListening(false);
      return;
    }

    // پاکسازی نشست قبلی بدون فراخوانی getUserMedia که در اندروید میکروفون را قفل می‌کند
    stopListening();

    shouldKeepListeningRef.current = true;
    speechStartTimeRef.current = Date.now();
    lastSpeechTimeRef.current = 0;
    accumulatedFinalRef.current = '';
    latestInterimRef.current = '';
    lastFinalChunkRef.current = '';
    processedFinalIndicesRef.current.clear();
    setLiveTranscript('');
    setIsListening(true);

    let hasCommitted = false;

    const commitCapturedSpeech = () => {
      if (hasCommitted) return;
      const combined = appendWithoutDuplicate(
        accumulatedFinalRef.current,
        latestInterimRef.current
      ).trim();

      if (!combined) return;
      hasCommitted = true;
      shouldKeepListeningRef.current = false;

      if (speechDoneTimerRef.current) {
        clearTimeout(speechDoneTimerRef.current);
        speechDoneTimerRef.current = null;
      }
      if (silencePromptTimerRef.current) {
        clearTimeout(silencePromptTimerRef.current);
        silencePromptTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (recognitionRef.current) {
        safeAbortSpeechRecognition(recognitionRef.current);
        recognitionRef.current = null;
      }

      setIsListening(false);
      setIsSpeechActive(false);
      setVoiceLevel(0);
      setLiveTranscript('');
      setInputText('');
      handleUserUtteranceRef.current(combined);
    };

    // اگر کاربر تا ۹ ثانیه هیچ صحبتی را شروع نکرد، سیستم سوال راهنما را می‌پرسد
    silencePromptTimerRef.current = setTimeout(() => {
      const hasAnyText = Boolean(
        accumulatedFinalRef.current.trim() || latestInterimRef.current.trim()
      );
      if (!hasAnyText && isOpenRef.current && shouldKeepListeningRef.current) {
        stopListening();
        if (!isCompleteRef.current) {
          handleSilenceOnIncompleteRef.current();
        }
      }
    }, 9000);

    const createAndRunRecognition = () => {
      if (!shouldKeepListeningRef.current || !isOpenRef.current || hasCommitted) return;

      try {
        if (recognitionRef.current) {
          safeAbortSpeechRecognition(recognitionRef.current);
          recognitionRef.current = null;
        }

        const rec = new SpeechRecognition();
        rec.lang = isEn ? 'en-US' : 'fa-IR';
        rec.continuous = true;
        rec.interimResults = true;
        processedFinalIndicesRef.current.clear();

        rec.onstart = () => {
          if (!shouldKeepListeningRef.current) return;
          setIsListening(true);
          markPermissionGranted('microphone');
        };

        rec.onsoundstart = () => {
          clearAutoSaveTimers();
          setIsSpeechActive(true);
          setVoiceLevel(55);
        };

        rec.onspeechstart = () => {
          clearAutoSaveTimers();
          setIsSpeechActive(true);
          setVoiceLevel(75);
        };

        rec.onresult = (event: any) => {
          if (hasCommitted) return;

          // به محض شروع صحبت کاربر، تایمر ۳ ثانیه‌ای ثبت خودکار و تایمر سکوت متوقف می‌شود
          clearAutoSaveTimers();
          if (silencePromptTimerRef.current) {
            clearTimeout(silencePromptTimerRef.current);
            silencePromptTimerRef.current = null;
          }

          setIsSpeechActive(true);
          setVoiceLevel(45 + Math.floor(Math.random() * 45));

          let interimText = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res.isFinal) {
              if (!processedFinalIndicesRef.current.has(i)) {
                processedFinalIndicesRef.current.add(i);
                const finalChunk = res[0]?.transcript?.trim();
                if (finalChunk && finalChunk !== lastFinalChunkRef.current) {
                  lastFinalChunkRef.current = finalChunk;
                  lastSpeechTimeRef.current = Date.now();
                  accumulatedFinalRef.current = appendWithoutDuplicate(
                    accumulatedFinalRef.current,
                    finalChunk
                  );
                }
              }
            } else {
              interimText += (res[0]?.transcript || '') + ' ';
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
            // نمایش زنده متن تبدیل‌شده در لحظه صحبت کاربر
            setLiveTranscript(currentConvertedText);
            setInputText(currentConvertedText);

            // پس از ۱.۳۵ ثانیه مکث بعد از پایان صحبت کاربر، فرآیند تحلیل و ثبت آغاز می‌شود
            if (speechDoneTimerRef.current) {
              clearTimeout(speechDoneTimerRef.current);
            }
            speechDoneTimerRef.current = setTimeout(() => {
              commitCapturedSpeech();
            }, 1350);
          }
        };

        rec.onerror = (e: any) => {
          if (e?.error === 'no-speech') {
            // در حالت منتظر دستور، اگر هنوز کاربر شروع به صحبت نکرده، اجازه بده در onend دوباره فعال شود
            return;
          }
          if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
            stopListening();
            return;
          }
        };

        rec.onend = () => {
          if (hasCommitted) return;

          // اگر کاربر صحبتی کرده و متن تبدیل شده آماده است، بلافاصله فرآیند را آغاز کن
          const capturedSoFar = appendWithoutDuplicate(
            accumulatedFinalRef.current,
            latestInterimRef.current
          ).trim();

          if (capturedSoFar) {
            commitCapturedSpeech();
            return;
          }

          if (!shouldKeepListeningRef.current || !isOpenRef.current) {
            setIsListening(false);
            setIsSpeechActive(false);
            setVoiceLevel(0);
            return;
          }

          // اگر هنوز در بازه انتظار دستور (۹ ثانیه) هستیم، میکروفون را بدون قطعی روشن نگه دار
          const elapsedWaiting = Date.now() - speechStartTimeRef.current;
          if (elapsedWaiting < 8600) {
            reconnectTimerRef.current = setTimeout(() => {
              if (shouldKeepListeningRef.current && isOpenRef.current && !hasCommitted) {
                createAndRunRecognition();
              }
            }, 150);
          } else {
            stopListening();
            if (!isCompleteRef.current) {
              handleSilenceOnIncompleteRef.current();
            }
          }
        };

        recognitionRef.current = rec;
        rec.start();
      } catch {
        setIsListening(false);
        setIsSpeechActive(false);
        setVoiceLevel(0);
      }
    };

    createAndRunRecognition();
  }, [clearAutoSaveTimers, isEn, stopListening]);

  const executeFinalSave = useCallback(
    (finalDraft: SmartCaptureDraft) => {
      clearAutoSaveTimers();
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
        const lat = gpsCoords?.lat ?? 35.6892;
        const lng = gpsCoords?.lng ?? 51.389;
        onSaveLocation(
          {
            title: cleanTitle,
            description: finalDraft.description || '',
            address: finalDraft.locationAddress || '',
            latitude: lat,
            longitude: lng,
            googleMapsUrl: `https://www.google.com/maps?q=${lat},${lng}`,
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

      // Default / 'idea'
      onSaveIdea({
        title: cleanTitle,
        content: finalDraft.description || cleanTitle,
        category: finalDraft.category || 'other',
        tags: [isEn ? 'Smart Capture' : 'ثبت هوشمند'],
      });
      onClose();
    },
    [clearAutoSaveTimers, gpsCoords, isEn, onClose, onSaveIdea, onSaveLocation, onSaveOccasion, onSaveReminder, stopListening, stopSpeaking]
  );

  /**
   * شروع شمارش معکوس ۳ ثانیه‌ای پس از پایان پرسش صوتی/متنی «آیا ثبت نهایی انجام شود؟»
   * در صورت عدم پاسخ کاربر پس از ۳ ثانیه، ثبت خودکار در بخش مربوطه انجام می‌شود.
   */
  const startThreeSecondAutoSave = useCallback(
    (completedDraft: SmartCaptureDraft) => {
      clearAutoSaveTimers();
      if (!isOpenRef.current) return;

      setAutoSaveCountdown(3);
      let remaining = 3;

      autoSaveIntervalRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          setAutoSaveCountdown(remaining);
        }
      }, 1000);

      autoSaveTimeoutRef.current = setTimeout(() => {
        clearAutoSaveTimers();
        if (isOpenRef.current) {
          executeFinalSave(completedDraft);
        }
      }, 3000);
    },
    [clearAutoSaveTimers, executeFinalSave]
  );

  // If the microphone stops without user input while a mandatory field is missing, prompt them by voice & text with a warm conversational question
  const hasPromptedSilenceRef = useRef(false);
  useEffect(() => {
    handleSilenceOnIncompleteRef.current = () => {
      if (!isOpenRef.current || isCompleteRef.current) return;
      if (hasPromptedSilenceRef.current) return;
      hasPromptedSilenceRef.current = true;

      const cur = draftRef.current;
      let missingPrompt = isEn
        ? "I didn't catch your voice! Tell me, what reminder, occasion, location, or idea would you like me to save for you?"
        : 'صدات رو نشنیدم؛ بگو چه یادآور، مناسبت، مکان یا ایده‌ای رو می‌خوای برات ثبت کنم؟';

      if (cur.intentType === 'reminder' && cur.title && (cur.hour === undefined || cur.hour === null || cur.hour < 0)) {
        missingPrompt = isEn
          ? `What day and what time should I remind you about "${cur.title}"?`
          : `برای یادآورِ «${cur.title}»، نگفتی چه روزی و ساعت چند بهت خبر بدم؟`;
      } else if (cur.intentType === 'reminder' && !cur.title) {
        missingPrompt = isEn
          ? 'What is the subject of this reminder so I can save it for you?'
          : 'موضوع یادآور رو نگفتی؛ بگو عنوانش چیه تا برات ثبتش کنم؟';
      } else if (cur.intentType === 'occasion' && cur.title && (!cur.solarDay || !cur.solarMonth)) {
        missingPrompt = isEn
          ? `What day and what month is "${cur.title}"?`
          : `نگفتی «${cur.title}» دقیقاً چه روزی و چه ماهیه؟`;
      } else if (cur.intentType === 'location' && !cur.title) {
        missingPrompt = isEn
          ? 'What name would you like me to save this place under?'
          : 'دوست داری این مکان رو با چه اسمی برات ذخیره کنم؟';
      }

      setMessages((prev) => [
        ...prev,
        {
          id: 'silence_' + Date.now(),
          role: 'assistant',
          text: missingPrompt,
          timestamp: Date.now(),
        },
      ]);

      speakPromptWithCallback(missingPrompt, () => {
        if (isOpenRef.current && !isCompleteRef.current) {
          startListening();
        }
      });
    };
  }, [isEn, speakPromptWithCallback, startListening]);

  // Reset, speak initial conversational question aloud FIRST, and THEN activate microphone to wait for user's answer
  useEffect(() => {
    if (!isOpen) {
      clearAutoSaveTimers();
      stopListening();
      stopSpeaking();
      return;
    }

    hasPromptedSilenceRef.current = false;

    const initialQuestion = isEn
      ? "Hi there! I'm ready. Tell me, what reminder, occasion, location, or idea would you like me to save for you?"
      : 'سلام! من آماده‌ام؛ بگو چه یادآور، مناسبت، مکان یا ایده‌ای رو می‌خوای برات ثبت کنم؟';

    const initialGreeting: SmartChatMessage = {
      id: 'welcome_' + Date.now(),
      role: 'assistant',
      text: initialQuestion,
      timestamp: Date.now(),
    };

    setMessages([initialGreeting]);
    setDraft({ intentType: 'unknown' });
    setIsComplete(false);
    setInputText('');
    setLiveTranscript('');
    setQuickSuggestions(
      isEn
        ? ['Remind me tomorrow at 9 AM to call Ali', 'Birthday of Sara on 15 Ordibehesht', 'Save my parked car location', 'New startup idea']
        : [
            'فردا ساعت ۱۰ صبح جلسه کاری',
            'تولد مریم ۱۵ اردیبهشت',
            'ذخیره مکان پارک خودرو',
            'ایده جدید برای پروژه',
          ]
    );

    const lastPos = getLastKnownPosition();
    if (lastPos) {
      setGpsCoords({ lat: lastPos.latitude, lng: lastPos.longitude });
    }

    // ابتدا هوش مصنوعی سوال را به صورت صوتی و با لحن صمیمی بیان می‌کند و پس از اتمام سوال، میکروفون فعال و منتظر پاسخ می‌شود
    const timer = setTimeout(() => {
      speakPromptWithCallback(initialQuestion, () => {
        if (isOpenRef.current) {
          startListening();
        }
      });
    }, 120);

    return () => {
      clearTimeout(timer);
      clearAutoSaveTimers();
      stopListening();
      stopSpeaking();
    };
  }, [clearAutoSaveTimers, isOpen, isEn, speakPromptWithCallback, startListening, stopListening, stopSpeaking]);

  // Acquire GPS when intent switches to 'location'
  useEffect(() => {
    if (!isOpen || draft.intentType !== 'location') return;
    requestLocationPermission()
      .then(() => {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
              saveLastKnownPosition({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: Date.now(),
              });
            },
            () => {},
            { enableHighAccuracy: true, timeout: 8000 }
          );
        }
      })
      .catch(() => {});
  }, [isOpen, draft.intentType]);

  const handleUserUtterance = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      clearAutoSaveTimers();
      stopListening();
      setInputText('');
      setLiveTranscript('');
      hasPromptedSilenceRef.current = false;

      // If already complete and user says "بله" / "ثبت کن" -> save immediately
      if (
        isCompleteRef.current &&
        draftRef.current.title &&
        /^(بله|بله ثبت کن|آره|ثبت|ثبت کن|ذخیره|ذخیره کن|تایید|انجام بده|حله|باشه|yes|ok|save)$/i.test(
          trimmed.replace(/[!.،؟?]/g, '').trim()
        )
      ) {
        executeFinalSave(draftRef.current);
        return;
      }

      // If already complete and user says "نه" / "ویرایش" / "صبر کن" -> cancel auto-save and ask what to change
      if (
        isCompleteRef.current &&
        /^(نه|خیر|صبر کن|دست نگه دار|ویرایش|تغییر|تغییر ساعت|تغییر تاریخ|تغییر نام مکان|ویرایش متن|no|wait|edit)$/i.test(
          trimmed.replace(/[!.،؟?]/g, '').trim()
        )
      ) {
        setIsComplete(false);
        const editQuestion = isEn
          ? 'Got it, I paused auto-save! Which part would you like to change?'
          : 'باشه، ثبت خودکار رو نگه داشتم؛ بگو کدوم قسمت رو می‌خوای تغییر بدی؟';
        setMessages((prev) => [
          ...prev,
          { id: 'u_' + Date.now(), role: 'user', text: trimmed, timestamp: Date.now() },
          { id: 'a_' + (Date.now() + 1), role: 'assistant', text: editQuestion, timestamp: Date.now() },
        ]);
        speakPromptWithCallback(editQuestion, () => {
          if (isOpenRef.current) startListening();
        });
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
        setQuickSuggestions(analysis.quickSuggestions || []);

        const assistantMsg: SmartChatMessage = {
          id: 'a_' + Date.now(),
          role: 'assistant',
          text: analysis.clarifyingQuestion,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // If user explicitly commanded immediate save and draft is complete
        if (analysis.isComplete && analysis.shouldAutoSubmit && analysis.draft.title) {
          executeFinalSave(analysis.draft);
          return;
        }

        if (!analysis.isComplete) {
          // Mandatory input is missing -> ask the exact missing question by voice & text, then activate mic
          speakPromptWithCallback(analysis.clarifyingQuestion, () => {
            if (isOpenRef.current) {
              startListening();
            }
          });
        } else if (analysis.draft.title) {
          // All required inputs are complete -> ask final confirmation by voice & text, then start 3-second auto-save timer
          speakPromptWithCallback(analysis.clarifyingQuestion, () => {
            if (isOpenRef.current) {
              startListening();
              startThreeSecondAutoSave(analysis.draft);
            }
          });
        }
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      clearAutoSaveTimers,
      draft,
      executeFinalSave,
       isEn,
      language,
      messages,
      speakPromptWithCallback,
      startListening,
      startThreeSecondAutoSave,
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
      label: isEn ? 'Auto-Detecting...' : 'تشخیص هوشمند بخش...',
      icon: <Sparkles className="w-4 h-4" />,
      badgeClass: 'bg-stone-800 text-stone-300 border-stone-700',
    },
  };

  const currentSection = sectionMeta[draft.intentType || 'unknown'];

  return (
    <div
      dir={isEn ? 'ltr' : 'rtl'}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-stone-950 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-stone-800/90 flex items-center justify-between bg-stone-900/70">
          <div className="flex items-center gap-2.5">
            <div
              data-keep-color="true"
              className="w-9 h-9 rounded-xl bg-[#FF8C00] text-white flex items-center justify-center shadow-md shadow-[#FF8C00]/30"
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                <span>{isEn ? 'Smart Voice Capture' : 'ثبت هوشمند صوتی و گفتگویی'}</span>
              </h3>
              <p className="text-[11px] text-stone-400">
                {isEn
                  ? 'Auto-routes to Reminders, Occasions, Locations, or Ideas'
                  : 'پرسش صوتی و متنی برای تکمیل اطلاعات و ثبت خودکار'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setVoiceFeedbackEnabled((v) => !v)}
              className="p-2 rounded-xl bg-stone-800/80 hover:bg-stone-800 text-stone-300 transition-colors cursor-pointer"
              title={isEn ? 'Voice Readback' : 'خوانش صوتی سوالات'}
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

        {/* Target Section Selector Bar (4 Tabs) */}
        <div className="px-4 py-2.5 bg-stone-900/40 border-b border-stone-800/70 flex items-center justify-between gap-1.5 overflow-x-auto">
          {(['reminder', 'occasion', 'location', 'idea'] as SmartIntentType[]).map((type) => {
            const meta = sectionMeta[type];
            const isSelected = draft.intentType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  clearAutoSaveTimers();
                  const nextDraft = { ...draft, intentType: type };
                  setDraft(nextDraft);
                  if (nextDraft.title) {
                    const nowReady =
                      type === 'idea' ||
                      type === 'location' ||
                      (type === 'reminder' && typeof nextDraft.hour === 'number' && nextDraft.hour >= 0) ||
                      (type === 'occasion' &&
                        typeof nextDraft.solarDay === 'number' &&
                        typeof nextDraft.solarMonth === 'number');
                    setIsComplete(nowReady);
                  }
                }}
                data-keep-color={isSelected ? 'true' : undefined}
                className={`flex-1 min-w-[72px] py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#FF8C00] text-white border-[#FF8C00] shadow-sm shadow-[#FF8C00]/30'
                    : 'bg-stone-900/90 text-stone-400 border-stone-800 hover:text-stone-200'
                }`}
              >
                {meta.icon}
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>

        {/* Conversation Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[210px] max-h-[340px]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
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
              <div className="max-w-[86%] rounded-2xl px-3.5 py-2 text-xs sm:text-sm bg-[#FF8C00]/10 border border-dashed border-[#FF8C00]/50 text-stone-200 italic">
                {liveTranscript}...
              </div>
            </div>
          )}

          {isAnalyzing && (
            <div className="flex justify-end">
              <div className="rounded-2xl px-3.5 py-2 text-xs bg-stone-900 border border-stone-800 text-stone-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#FF8C00] animate-ping" />
                <span>{isEn ? 'Analyzing...' : 'در حال تحلیل هوشمند...'}</span>
              </div>
            </div>
          )}

          {/* 3-Second Auto-Save Banner when Complete */}
          {autoSaveCountdown !== null && (
            <div className="p-3 rounded-2xl bg-[#FF8C00]/15 border border-[#FF8C00] text-white flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold min-w-0">
                <span
                  data-keep-color="true"
                  className="w-6 h-6 rounded-full bg-[#FF8C00] text-white font-black flex items-center justify-center text-xs shrink-0"
                >
                  {isEn ? autoSaveCountdown : toPersianDigits(autoSaveCountdown)}
                </span>
                <span className="truncate">
                  {isEn
                    ? `Auto-saving in ${autoSaveCountdown}s...`
                    : `ثبت خودکار در ${currentSection.label} تا ${toPersianDigits(autoSaveCountdown)} ثانیه...`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  data-keep-color="true"
                  onClick={() => executeFinalSave(draft)}
                  className="px-2.5 py-1 rounded-lg bg-[#FF8C00] hover:bg-[#FF9E1F] text-white text-[11px] font-black shadow-sm cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Save Now' : 'ثبت فوری'}</span>
                </button>
                <button
                  type="button"
                  onClick={clearAutoSaveTimers}
                  className="px-2.5 py-1 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-200 text-[11px] font-bold border border-stone-700 cursor-pointer"
                >
                  {isEn ? 'Stop / Edit' : 'توقف / ویرایش'}
                </button>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Live Structured Draft Card */}
        {(draft.title || draft.intentType !== 'unknown') && (
          <div className="mx-4 mb-2 p-3 rounded-2xl bg-stone-900/90 border border-stone-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${currentSection.badgeClass}`}
              >
                {currentSection.icon}
                <span>
                  {isEn ? 'Target Section:' : 'بخش مقصد:'} {currentSection.label}
                </span>
              </span>

              {isComplete ? (
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Complete & Ready' : 'اطلاعات کامل شد'}</span>
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-400">
                  {isEn ? 'Awaiting mandatory input...' : 'در انتظار ورودی اجباری...'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div>
                <label className="block text-[10px] text-stone-400 mb-0.5">
                  {isEn ? 'Title / Subject' : 'عنوان استخراج‌شده'}
                </label>
                <input
                  type="text"
                  value={draft.title || ''}
                  onChange={(e) => {
                    clearAutoSaveTimers();
                    const val = e.target.value;
                    setDraft((prev) => ({ ...prev, title: val }));
                  }}
                  placeholder={isEn ? 'Enter title...' : 'عنوان...'}
                  className="w-full px-2.5 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-white focus:outline-none focus:border-[#FF8C00]"
                />
              </div>

              {draft.intentType === 'reminder' && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="block text-[10px] text-stone-400">
                      {isEn ? 'Scheduled Time (Editable)' : 'زمان یادآور (قابل ویرایش)'}
                    </label>
                    {typeof draft.hour === 'number' && draft.hour >= 0 && (
                      <span className="text-[10px] text-[#FF8C00] font-bold truncate max-w-[140px]">
                        {formatJalaliFull(computeReminderTimestampFromDraft(draft), language)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={typeof draft.offsetDays === 'number' ? draft.offsetDays : 0}
                      onChange={(e) => {
                        clearAutoSaveTimers();
                        const nextOffset = Number(e.target.value);
                        const nextHour = typeof draft.hour === 'number' && draft.hour >= 0 ? draft.hour : 9;
                        const nextMinute = typeof draft.minute === 'number' && draft.minute >= 0 ? draft.minute : 0;
                        const nextDraft = {
                          ...draft,
                          offsetDays: nextOffset,
                          hour: nextHour,
                          minute: nextMinute,
                          targetTimestamp: undefined,
                        };
                        setDraft(nextDraft);
                        if (nextDraft.title) setIsComplete(true);
                      }}
                      className="px-2 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-stone-200 focus:outline-none focus:border-[#FF8C00] cursor-pointer"
                    >
                      <option value={0}>{isEn ? 'Today' : 'امروز'}</option>
                      <option value={1}>{isEn ? 'Tomorrow' : 'فردا'}</option>
                      <option value={2}>{isEn ? 'In 2 days' : 'پس‌فردا'}</option>
                      <option value={3}>{isEn ? 'In 3 days' : '۳ روز دیگر'}</option>
                      <option value={7}>{isEn ? 'Next week' : 'هفته آینده'}</option>
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
                        clearAutoSaveTimers();
                        const val = e.target.value;
                        if (!val) return;
                        const [hStr, mStr] = val.split(':');
                        const h = Number(hStr);
                        const m = Number(mStr);
                        if (!Number.isNaN(h) && !Number.isNaN(m)) {
                          const nextDraft = {
                            ...draft,
                            hour: h,
                            minute: m,
                            offsetDays: typeof draft.offsetDays === 'number' ? draft.offsetDays : 0,
                            targetTimestamp: undefined,
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
                    {isEn ? 'Occasion Date (Shamsi - Editable)' : 'تاریخ مناسبت شمسی (قابل ویرایش)'}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={draft.solarDay || ''}
                      onChange={(e) => {
                        clearAutoSaveTimers();
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
                        clearAutoSaveTimers();
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
                  <label className="block text-[10px] text-stone-400 mb-0.5">
                    {isEn ? 'GPS Coordinates' : 'موقعیت ماهواره‌ای GPS'}
                  </label>
                  <div className="px-2.5 py-1.5 rounded-xl bg-stone-950 border border-stone-800 text-xs text-emerald-400 font-mono truncate">
                    {gpsCoords
                      ? `${gpsCoords.lat.toFixed(4)}, ${gpsCoords.lng.toFixed(4)}`
                      : isEn
                      ? 'Ready to capture GPS'
                      : 'آماده ثبت مختصات فعلی'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Reply Chips */}
        {quickSuggestions.length > 0 && (
          <div className="px-4 pb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {quickSuggestions.map((chip, idx) => (
              <button
                key={`${chip}_${idx}`}
                type="button"
                onClick={() => handleUserUtterance(chip)}
                className="px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700/80 text-stone-200 text-xs font-bold whitespace-nowrap transition-all active:scale-95 cursor-pointer shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Bottom Controls: Prominent High-Sensitivity Microphone Bar + Text Input + Final Submit Button */}
        <div className="p-3.5 bg-stone-900/95 border-t border-stone-800 space-y-2.5">
          {/* Prominent Microphone Hero Box */}
          <div
            onClick={() => {
              clearAutoSaveTimers();
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
                  clearAutoSaveTimers();
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
                title={
                  isListening
                    ? isEn
                      ? 'Microphone Active'
                      : 'میکروفون فعال (منتظر دستور)'
                    : isEn
                    ? 'Tap to Speak'
                    : 'لمس برای شروع صحبت'
                }
              >
                {isListening && (
                  <>
                    <span className="absolute inset-0 rounded-2xl bg-[#FF8C00] animate-ping opacity-40 pointer-events-none" />
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
                  {isListening ? (isEn ? 'ON' : 'فعال') : isEn ? 'MIC' : 'میکروفون'}
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
                        ? 'Converting speech to text...'
                        : 'در حال تبدیل گفتار شما به متن...'
                      : isListening
                      ? isEn
                        ? 'Waiting for your command — Speak now'
                        : 'منتظر دستور صوتی شما... بفرمایید'
                      : isAssistantSpeaking
                      ? isEn
                        ? 'Assistant asking question...'
                        : 'در حال بیان سوال... (پس از آن بفرمایید)'
                      : isEn
                      ? 'Tap Microphone to Speak'
                      : 'برای صحبت روی دکمه میکروفون بزنید'}
                  </p>
                </div>
                <p className="text-[11px] text-stone-300 mt-0.5 truncate">
                  {liveTranscript
                    ? liveTranscript
                    : isListening
                    ? isEn
                      ? 'Start speaking to convert to text & begin'
                      : 'به‌محض شروع صحبت، به متن تبدیل شده و فرآیند آغاز می‌شود'
                    : isEn
                    ? 'Tap the orange microphone button to activate'
                    : 'برای فعال‌سازی مجدد میکروفون، دکمه نارنجی را لمس کنید'}
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
                          (isSpeechActive ? Math.max(28, voiceLevel) : Math.max(14, voiceLevel)) *
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

          {/* Secondary Text Input for manual answer/clarification */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
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
                clearAutoSaveTimers();
                setInputText(e.target.value);
              }}
              placeholder={
                isListening
                  ? isEn
                    ? 'Or type your answer here...'
                    : 'یا پاسخ خود را اینجا تایپ کنید...'
                  : isEn
                  ? 'Speak with the mic above or type here...'
                  : 'با میکروفون بالا بگویید یا اینجا بنویسید...'
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
                  ? `Save in ${currentSection.label}`
                  : `ثبت نهایی در بخش ${
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
