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
import {
  SmartCaptureDraft,
  SmartChatMessage,
  analyzeSmartCaptureTurn,
  computeReminderTimestampFromDraft,
  formatDraftDayLabel,
  isConfirmationUtterance,
  isMeaningfulStepInput,
  pickInitialGreeting,
  pickUnclearRetryPrompt,
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

/**
 * تبدیل آرایه‌ای از قطعات PCM 16-bit (نرخ ۱۶ کیلوهرتز) به رشته Base64 با هدر استاندارد WAV
 */
function encodePcmChunksToWavBase64(chunks: Int16Array[], sampleRate = 16000): string {
  let totalSamples = 0;
  for (const c of chunks) totalSamples += c.length;

  const dataSize = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(offset, chunk[i], true);
      offset += 2;
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + step, bytes.length)))
    );
  }
  return window.btoa(binary);
}

/**
 * کاهش نرخ نمونه‌برداری (Downsampling) از نرخ کارت صدا (۴۴.۱ یا ۴۸ کیلوهرتز) به ۱۶ کیلوهرتز ۱۶ بیتی
 */
function downsampleFloat32ToInt16(
  input: Float32Array,
  inRate: number,
  outRate = 16000
): Int16Array {
  if (inRate <= outRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const s = Math.max(-1, Math.min(1, input[idx] || 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
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
  const [showFallbackTypeBox, setShowFallbackTypeBox] = useState(false);

  // Real live GPS state (strictly live hardware GPS with maximumAge: 0; never cached or mock coordinates)
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'fetching' | 'ready' | 'error'>('idle');
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);

  // Persistent Continuous MediaStream & Audio Pipeline refs (ChatGPT Voice Architecture)
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);

  // Persistent Continuous Web Speech API refs (0ms lag, live word-by-word Persian caption)
  const recognitionRef = useRef<any>(null);
  const consumedResultCountRef = useRef<number>(0);
  const latestResultsLenRef = useRef<number>(0);
  const webSpeechTextRef = useRef<string>('');
  const webSpeechCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listening Gate & Ring Buffer refs (0ms startup latency, 650ms pre-roll, strict acoustic VAD)
  const isListeningGateOpenRef = useRef<boolean>(false);
  const isCapturingUtteranceRef = useRef<boolean>(false);
  const isProcessingTurnRef = useRef<boolean>(false);
  const preRollChunksRef = useRef<Int16Array[]>([]);
  const capturedPcmChunksRef = useRef<Int16Array[]>([]);
  const voicedFramesCountRef = useRef<number>(0);
  const utterancePeakSampleRef = useRef<number>(0);
  const speechStartedAtRef = useRef<number>(0);
  const lastVoiceDetectedAtRef = useRef<number>(0);
  const gateOpenedAtRef = useRef<number>(0);
  const noiseFloorRmsRef = useRef<number>(1.8);
  const unclearRetryCountRef = useRef<number>(0);

  const typeInputRef = useRef<HTMLInputElement | null>(null);
  const isOpenRef = useRef(isOpen);
  const messagesRef = useRef<SmartChatMessage[]>(messages);
  const draftRef = useRef(draft);
  const isCompleteRef = useRef(isComplete);
  const voiceEnabledRef = useRef(voiceFeedbackEnabled);
  const gpsCoordsRef = useRef<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const micSensitivityRef = useRef<number>(micSensitivity);
  const aiVoicePersonaRef = useRef<AiVoicePersona>(aiVoicePersona);
  const aiVoiceVolumeRef = useRef<number>(aiVoiceVolume);
  const ttsWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processCapturedAudioRef = useRef<(chunks: Int16Array[]) => void>(() => {});
  const commitWebSpeechTranscriptRef = useRef<(text: string) => void>(() => {});

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

  /**
   * راه‌اندازی یکپارچه و پیوسته Web Speech API با continuous=true
   * تا در پس‌زمینه گرم شود، هیچ تاخیر شروعی نداشته باشد و دقیقاً کلمات کاربر را زنده بنویسد.
   */
  const ensurePersistentWebSpeech = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    if (recognitionRef.current) return;

    try {
      const rec = new SpeechRec();
      rec.lang = isEn ? 'en-US' : 'fa-IR';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;

      rec.onresult = (event: any) => {
        if (!isOpenRef.current) return;
        latestResultsLenRef.current = event.results.length;

        // اگر دریچه شنود بسته است (گوینده در حال صحبت است)، اشاره‌گر نتایج مصرف‌شده را جلو ببر تا صدای گوینده ثبت نشود
        if (!isListeningGateOpenRef.current || isProcessingTurnRef.current) {
          consumedResultCountRef.current = event.results.length;
          return;
        }

        let combined = '';
        let hasFinalInTurn = false;
        const startIdx = Math.min(consumedResultCountRef.current, event.results.length);
        for (let i = startIdx; i < event.results.length; i++) {
          const res = event.results[i];
          const chunk = (res[0]?.transcript || '').trim();
          if (chunk) {
            combined += (combined ? ' ' : '') + chunk;
            if (res.isFinal) hasFinalInTurn = true;
          }
        }

        const cleaned = combined.replace(/\s+/g, ' ').trim();
        if (!cleaned) return;

        webSpeechTextRef.current = cleaned;
        setLiveTranscript(cleaned);
        setIsSpeechActive(true);
        lastVoiceDetectedAtRef.current = Date.now();

        if (webSpeechCommitTimerRef.current) {
          clearTimeout(webSpeechCommitTimerRef.current);
        }

        const step = draftRef.current.wizardStep;
        const waitMs = hasFinalInTurn
          ? step === 'confirm' || step === 'ask_day' || step === 'ask_time'
            ? 650
            : 820
          : 1250;

        webSpeechCommitTimerRef.current = setTimeout(() => {
          if (!isOpenRef.current || !isListeningGateOpenRef.current || isProcessingTurnRef.current) {
            return;
          }
          const finalTxt = webSpeechTextRef.current.trim();
          if (finalTxt) {
            consumedResultCountRef.current = latestResultsLenRef.current;
            webSpeechTextRef.current = '';
            commitWebSpeechTranscriptRef.current(finalTxt);
          }
        }, waitMs);
      };

      rec.onerror = (err: any) => {
        const code = err?.error || '';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          recognitionRef.current = null;
        }
      };

      rec.onend = () => {
        if (!isOpenRef.current) {
          recognitionRef.current = null;
          return;
        }
        // اگر مرورگر بعد از سکوت طولانی نشست را بست، بی‌صدا آن را باز نگه دار
        try {
          consumedResultCountRef.current = 0;
          latestResultsLenRef.current = 0;
          rec.start();
        } catch {
          recognitionRef.current = null;
        }
      };

      recognitionRef.current = rec;
      consumedResultCountRef.current = 0;
      latestResultsLenRef.current = 0;
      rec.start();
    } catch {
      recognitionRef.current = null;
    }
  }, [isEn]);

  /**
   * بستن کامل استریم میکروفون فقط هنگام بسته شدن پنجره ثبت هوشمند
   */
  const destroyContinuousMicStream = useCallback(() => {
    isListeningGateOpenRef.current = false;
    isCapturingUtteranceRef.current = false;
    preRollChunksRef.current = [];
    capturedPcmChunksRef.current = [];
    webSpeechTextRef.current = '';
    consumedResultCountRef.current = 0;
    latestResultsLenRef.current = 0;

    if (webSpeechCommitTimerRef.current) {
      clearTimeout(webSpeechCommitTimerRef.current);
      webSpeechCommitTimerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        const r = recognitionRef.current;
        recognitionRef.current = null;
        r.onend = null;
        r.onresult = null;
        r.onerror = null;
        r.abort();
      } catch {
        // ignore
      }
    }

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.onaudioprocess = null;
        processorNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      processorNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close().catch(() => {});
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }

    setIsListening(false);
    setIsSpeechActive(false);
    setVoiceLevel(0);
  }, []);

  /**
   * بستن موقت دریچه شنود (در زمان صحبت گوینده یا پردازش) بدون قطع کردن خط میکروفون
   * تا هیچ بوقی زده نشود و در مرحله بعد در 0 میلی‌ثانیه آماده شنیدن باشد.
   */
  const pauseListeningGate = useCallback(() => {
    isListeningGateOpenRef.current = false;
    isCapturingUtteranceRef.current = false;
    preRollChunksRef.current = [];
    capturedPcmChunksRef.current = [];
    voicedFramesCountRef.current = 0;
    utterancePeakSampleRef.current = 0;
    webSpeechTextRef.current = '';
    consumedResultCountRef.current = latestResultsLenRef.current;
    if (webSpeechCommitTimerRef.current) {
      clearTimeout(webSpeechCommitTimerRef.current);
      webSpeechCommitTimerRef.current = null;
    }
    setIsListening(false);
    setIsSpeechActive(false);
    setVoiceLevel(0);
  }, []);

  /**
   * راه‌اندازی خط میکروفون یکپارچه و همیشه باز (مشابه ChatGPT Voice)
   * با بافر پیش‌ضبط ۶۵۰ میلی‌ثانیه‌ای (Pre-Roll Ring Buffer) و تشخیص دقیق صدای واقعی انسان
   */
  const ensureContinuousMicStream = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    if (mediaStreamRef.current && audioCtxRef.current && processorNodeRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {});
      }
      return true;
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

      if (!isOpenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }

      markPermissionGranted('microphone');
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx: AudioContext = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorNodeRef.current = processor;

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const inRate = audioCtx.sampleRate || 48000;
      const maxPreRollChunks = 15;

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (!isOpenRef.current) return;

        // اگر دریچه شنود بسته است (گوینده در حال صحبت است)، بافر را خالی نگه دار تا صدای گوینده ضبط نشود
        if (!isListeningGateOpenRef.current || isProcessingTurnRef.current) {
          preRollChunksRef.current = [];
          return;
        }

        const now = Date.now();
        // محافظ ۲۲۰ میلی‌ثانیه‌ای پس از پایان صدای گوینده برای جلوگیری از ضبط پژواک اسپیکر
        if (now - gateOpenedAtRef.current < 220) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = downsampleFloat32ToInt16(inputData, inRate, 16000);

        // ۱. محاسبه انرژی لحظه‌ای سیگنال (RMS) و بیشینه دامنه نمونه (Peak)
        let sumSq = 0;
        let chunkPeak = 0;
        for (let i = 0; i < pcm16.length; i++) {
          const abs = Math.abs(pcm16[i]);
          if (abs > chunkPeak) chunkPeak = abs;
          const norm = pcm16[i] / 32768;
          sumSq += norm * norm;
        }
        const currentRms = Math.sqrt(sumSq / Math.max(1, pcm16.length)) * 100;

        const sens = Math.max(10, Math.min(100, micSensitivityRef.current || 75));
        // آستانه واقعی صدای انسان (هرگز با نویز خفیف اتاق فعال نمی‌شود)
        const rmsThreshold = Math.max(3.8, noiseFloorRmsRef.current + (110 - sens) * 0.06);
        const isVoiceFrame = currentRms >= rmsThreshold && chunkPeak >= 2400;

        const visualLevel = Math.min(
          100,
          Math.round(Math.max(0, (currentRms - noiseFloorRmsRef.current) * 14))
        );
        setVoiceLevel(visualLevel > 6 ? visualLevel : 0);

        if (!isCapturingUtteranceRef.current) {
          preRollChunksRef.current.push(pcm16);
          if (preRollChunksRef.current.length > maxPreRollChunks) {
            preRollChunksRef.current.shift();
          }

          if (isVoiceFrame) {
            isCapturingUtteranceRef.current = true;
            speechStartedAtRef.current = now;
            lastVoiceDetectedAtRef.current = now;
            voicedFramesCountRef.current = 1;
            utterancePeakSampleRef.current = chunkPeak;
            capturedPcmChunksRef.current = [...preRollChunksRef.current, pcm16];
            preRollChunksRef.current = [];
            setIsSpeechActive(true);
          } else {
            noiseFloorRmsRef.current =
              noiseFloorRmsRef.current * 0.94 + Math.min(currentRms, 4.5) * 0.06;
          }
        } else {
          capturedPcmChunksRef.current.push(pcm16);
          if (chunkPeak > utterancePeakSampleRef.current) {
            utterancePeakSampleRef.current = chunkPeak;
          }
          if (isVoiceFrame) {
            voicedFramesCountRef.current += 1;
            lastVoiceDetectedAtRef.current = now;
          } else if (currentRms >= rmsThreshold * 0.82 && chunkPeak >= 1900) {
            lastVoiceDetectedAtRef.current = now;
          }

          const silenceDurationMs = now - lastVoiceDetectedAtRef.current;
          const totalSpeechDurationMs = now - speechStartedAtRef.current;
          const currentStep = draftRef.current.wizardStep;
          const pauseRequiredMs =
            currentStep === 'confirm' || currentStep === 'ask_day' || currentStep === 'ask_time'
              ? 1050
              : 1200;

          if (silenceDurationMs >= pauseRequiredMs || totalSpeechDurationMs >= 14000) {
            const chunksToProcess = capturedPcmChunksRef.current;
            const voicedFrames = voicedFramesCountRef.current;
            const maxPeak = utterancePeakSampleRef.current;

            isCapturingUtteranceRef.current = false;
            capturedPcmChunksRef.current = [];
            voicedFramesCountRef.current = 0;
            utterancePeakSampleRef.current = 0;

            // اگر Web Speech API متن زنده کاربر را دریافت کرده، بلافاصله همان متن دقیق را ثبت کن
            if (webSpeechTextRef.current.trim()) {
              const txt = webSpeechTextRef.current.trim();
              webSpeechTextRef.current = '';
              consumedResultCountRef.current = latestResultsLenRef.current;
              if (webSpeechCommitTimerRef.current) {
                clearTimeout(webSpeechCommitTimerRef.current);
                webSpeechCommitTimerRef.current = null;
              }
              isListeningGateOpenRef.current = false;
              setIsSpeechActive(false);
              setIsListening(false);
              setVoiceLevel(0);
              commitWebSpeechTranscriptRef.current(txt);
              return;
            }

            // اگر فقط یک ضربه کوتاه یا نویز لحظه‌ای بوده (کمتر از ۸ فریم آوایی)، نادیده بگیر و به گوش دادن ادامه بده
            if (voicedFrames < 8 || maxPeak < 2700) {
              setIsSpeechActive(false);
              setVoiceLevel(0);
              return;
            }

            isListeningGateOpenRef.current = false;
            setIsSpeechActive(false);
            setIsListening(false);
            setVoiceLevel(0);
            processCapturedAudioRef.current(chunksToProcess);
          }
        }
      };

      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * باز کردن فوری دریچه شنود در ۰ میلی‌ثانیه بدون هیچ بوق و بدون خاموش/روشن شدن میکروفون
   */
  const openListeningGate = useCallback(async () => {
    if (!isOpenRef.current) return;
    ensurePersistentWebSpeech();
    const ready = await ensureContinuousMicStream();
    if (!ready && !recognitionRef.current) {
      setIsListening(false);
      return;
    }
    preRollChunksRef.current = [];
    capturedPcmChunksRef.current = [];
    voicedFramesCountRef.current = 0;
    utterancePeakSampleRef.current = 0;
    webSpeechTextRef.current = '';
    consumedResultCountRef.current = latestResultsLenRef.current;
    isCapturingUtteranceRef.current = false;
    gateOpenedAtRef.current = Date.now();
    isListeningGateOpenRef.current = true;
    setIsListening(true);
    setIsSpeechActive(false);
  }, [ensureContinuousMicStream, ensurePersistentWebSpeech]);

  const stopSpeaking = useCallback(() => {
    setIsAssistantSpeaking(false);
    if (ttsWaitTimerRef.current) {
      clearTimeout(ttsWaitTimerRef.current);
      ttsWaitTimerRef.current = null;
    }
    stopAiAssistantPrompt();
  }, []);

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

  // Pre-warm all short varied voice prompts into RAM
  useEffect(() => {
    if (typeof window === 'undefined') return;
    prewarmAiAssistantPrompt('سلام؛ بفرمایید ثبت کنم.', isEn ? 'en' : 'fa', aiVoicePersona);
  }, [isEn, aiVoicePersona]);

  const speakPromptWithCallback = useCallback(
    (rawText: string, onDone?: () => void) => {
      const cleanText = rawText.replace(/\s+/g, ' ').trim();
      if (!voiceEnabledRef.current || !cleanText || typeof window === 'undefined') {
        onDone?.();
        return;
      }

      pauseListeningGate();
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
          ttsWaitTimerRef.current = setTimeout(() => {
            if (isOpenRef.current) {
              onDone?.();
            }
          }, 20);
        },
      });
    },
    [isEn, pauseListeningGate, stopSpeaking]
  );

  const executeFinalSave = useCallback(
    async (finalDraft: SmartCaptureDraft) => {
      pauseListeningGate();
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
            if (isOpenRef.current) openListeningGate();
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
      openListeningGate,
      pauseListeningGate,
      speakPromptWithCallback,
      stopSpeaking,
    ]
  );

  /**
   * مدیریت صدای نامفهوم کاربر با سقف ۳ بار تلاش و باز کردن خودکار کادر تایپ
   */
  const handleUnclearVoiceAttempt = useCallback(() => {
    unclearRetryCountRef.current += 1;
    const retryCount = unclearRetryCountRef.current;
    const retryPrompt = pickUnclearRetryPrompt(retryCount, language);

    const assistantMsg: SmartChatMessage = {
      id: 'retry_' + Date.now(),
      role: 'assistant',
      text: retryPrompt,
      timestamp: Date.now(),
    };
    const nextMessages = [...messagesRef.current, assistantMsg];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    if (retryCount >= 3) {
      setShowFallbackTypeBox(true);
      speakPromptWithCallback(retryPrompt, () => {
        setTimeout(() => {
          typeInputRef.current?.focus();
        }, 80);
      });
      return;
    }

    speakPromptWithCallback(retryPrompt, () => {
      if (isOpenRef.current) {
        openListeningGate();
      }
    });
  }, [language, openListeningGate, speakPromptWithCallback]);

  const handleUserUtterance = useCallback(
    async (rawText: string, fromVoice = false) => {
      const trimmed = rawText.trim();
      if (!trimmed) {
        if (fromVoice) handleUnclearVoiceAttempt();
        return;
      }

      pauseListeningGate();
      setInputText('');
      setLiveTranscript('');

      const activeDraft = draftRef.current;

      // اگر از طریق صوت دریافت شده و برای مرحله فعلی نامفهوم است، طبق قانون ۳ بار تلاش، مودبانه درخواست تکرار کن
      if (fromVoice && !isMeaningfulStepInput(trimmed, activeDraft)) {
        handleUnclearVoiceAttempt();
        return;
      }

      // پاسخ معتبر دریافت شد -> صفر کردن شمارنده خطای صوتی
      unclearRetryCountRef.current = 0;

      const wasAlreadyComplete = isCompleteRef.current && Boolean(activeDraft.title);

      // گام ۶: اگر در مرحله تایید نهایی هستیم و کاربر کلمه تایید را بگوید
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
          if (isOpenRef.current) {
            openListeningGate();
          }
        });
      } finally {
        setIsAnalyzing(false);
      }
    },
    [
      executeFinalSave,
      handleUnclearVoiceAttempt,
      language,
      openListeningGate,
      pauseListeningGate,
      speakPromptWithCallback,
    ]
  );

  /**
   * ارسال صدای ضبط‌شده کاربر از بافر پیوسته به `/api/smart-stt` و تحلیل بلافاصله
   */
  const processCapturedAudio = useCallback(
    async (pcmChunks: Int16Array[]) => {
      if (!isOpenRef.current || isProcessingTurnRef.current) return;
      if (!pcmChunks || pcmChunks.length === 0) {
        openListeningGate();
        return;
      }

      isProcessingTurnRef.current = true;
      setIsAnalyzing(true);

      try {
        const audioBase64 = encodePcmChunksToWavBase64(pcmChunks, 16000);
        const resp = await fetch('/api/smart-stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType: 'audio/wav',
            language,
          }),
        });

        if (!resp.ok) {
          handleUnclearVoiceAttempt();
          return;
        }

        const data = await resp.json();
        const transcript = (data?.transcript || '').trim();
        if (!data?.ok || data?.isUnclear || !transcript) {
          handleUnclearVoiceAttempt();
          return;
        }

        setLiveTranscript(transcript);
        await handleUserUtterance(transcript, true);
      } catch {
        handleUnclearVoiceAttempt();
      } finally {
        isProcessingTurnRef.current = false;
        setIsAnalyzing(false);
      }
    },
    [handleUnclearVoiceAttempt, handleUserUtterance, language, openListeningGate]
  );

  useEffect(() => {
    processCapturedAudioRef.current = processCapturedAudio;
  }, [processCapturedAudio]);

  useEffect(() => {
    commitWebSpeechTranscriptRef.current = (txt: string) => {
      handleUserUtterance(txt, true);
    };
  }, [handleUserUtterance]);

  const wasOpenRef = useRef(false);

  // گام ۱: هنگام باز شدن مدال، خط میکروفون یکپارچه گرم شده، سلام کوتاه و متنوع پخش شده و در ۰ms شنود فعال می‌شود
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      destroyContinuousMicStream();
      stopSpeaking();
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    unlockAudio();
    // گرم کردن خط میکروفون و موتور تشخیص گفتار از همان لحظه اول باز شدن پنجره (بدون بوق و آماده در پس‌زمینه)
    ensureContinuousMicStream();
    ensurePersistentWebSpeech();

    const initialQuestion = pickInitialGreeting(language);

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
    unclearRetryCountRef.current = 0;

    setMessages([initialGreeting]);
    setDraft(initialDraft);
    setIsComplete(false);
    setInputText('');
    setLiveTranscript('');
    setShowFallbackTypeBox(false);
    setGpsCoords(null);
    gpsCoordsRef.current = null;
    setGpsStatus('idle');
    setGpsErrorMsg(null);

    const timer = setTimeout(() => {
      speakPromptWithCallback(initialQuestion, () => {
        if (isOpenRef.current) {
          openListeningGate();
        }
      });
    }, 20);

    return () => {
      clearTimeout(timer);
    };
  }, [
    destroyContinuousMicStream,
    ensureContinuousMicStream,
    ensurePersistentWebSpeech,
    isOpen,
    language,
    openListeningGate,
    speakPromptWithCallback,
    stopSpeaking,
  ]);

  // به محض تشخیص دسته‌ی «مکان»، دریافت زنده و واقعی GPS (با maximumAge: 0) آغاز شود
  useEffect(() => {
    if (!isOpen || draft.intentType !== 'location') return;
    if (gpsStatus === 'idle') {
      acquireLiveGpsCoordinates();
    }
  }, [acquireLiveGpsCoordinates, draft.intentType, gpsStatus, isOpen]);

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
    if (hasDay) {
      const dayStr = formatDraftDayLabel(draft, isEn);
      return `${typeLabel}: ${draft.title} · ${dayStr}`;
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
    if (isAssistantSpeaking) {
      stopSpeaking();
      openListeningGate();
      return;
    }
    if (webSpeechTextRef.current.trim()) {
      const txt = webSpeechTextRef.current.trim();
      webSpeechTextRef.current = '';
      consumedResultCountRef.current = latestResultsLenRef.current;
      pauseListeningGate();
      handleUserUtterance(txt, true);
      return;
    }
    if (isCapturingUtteranceRef.current && capturedPcmChunksRef.current.length > 0) {
      const chunksToProcess = capturedPcmChunksRef.current;
      pauseListeningGate();
      processCapturedAudio(chunksToProcess);
    } else if (!isListening) {
      openListeningGate();
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    handleUserUtterance(inputText.trim(), false);
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
            ? 'opacity-30'
            : 'opacity-15'
        }`}
        style={{
          background: isSpeechActive
            ? 'radial-gradient(circle at 50% 44%, rgba(16, 185, 129, 0.30), rgba(255, 140, 0, 0.12) 45%, transparent 72%)'
            : isAssistantSpeaking
            ? 'radial-gradient(circle at 50% 44%, rgba(255, 140, 0, 0.34), rgba(251, 191, 36, 0.12) 45%, transparent 72%)'
            : isListening
            ? 'radial-gradient(circle at 50% 44%, rgba(16, 185, 129, 0.22), transparent 68%)'
            : 'radial-gradient(circle at 50% 44%, rgba(255, 140, 0, 0.18), transparent 68%)',
        }}
      />

      {/* Top Minimal Header */}
      <div className="relative z-10 flex items-center justify-between max-w-xl w-full mx-auto">
        <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
          {isEn ? 'Smart Capture' : 'ثبت هوشمند'}
        </h3>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowFallbackTypeBox((v) => !v);
              setTimeout(() => typeInputRef.current?.focus(), 60);
            }}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
              showFallbackTypeBox
                ? 'bg-[#FF8C00]/20 border-[#FF8C00] text-[#FF8C00]'
                : 'bg-stone-900/80 hover:bg-stone-800 border-stone-800 text-stone-300'
            }`}
            title={isEn ? 'Type instead' : 'تایپ دستی'}
          >
            <Keyboard className="w-4 h-4" />
          </button>

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
      </div>

      {/* Center Stage: Interactive Conversational Voice Orb + Live Caption */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-xl w-full mx-auto my-2">
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
          className="relative w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center cursor-pointer group focus:outline-none"
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
                  ? 1.08 + Math.min(0.15, voiceLevel / 280)
                  : 0.96
              })`,
            }}
            className={`absolute inset-0 rounded-full transition-all duration-150 ${
              isSpeechActive || isListening
                ? 'bg-emerald-500/15 border border-emerald-400/30'
                : isAssistantSpeaking
                ? 'bg-[#FF8C00]/15 border border-[#FF8C00]/35 animate-pulse'
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
                  ? 1.03 + Math.min(0.1, voiceLevel / 320)
                  : 0.94
              })`,
            }}
            className={`absolute inset-5 rounded-full transition-all duration-150 ${
              isSpeechActive || isListening
                ? 'bg-emerald-400/20 border border-emerald-400/40'
                : isAssistantSpeaking
                ? 'bg-[#FF8C00]/25 border border-amber-400/40 animate-ping [animation-duration:2.4s]'
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
                : isSpeechActive || isListening
                ? 'radial-gradient(circle at 32% 28%, #a7f3d0 0%, #10b981 46%, #065f46 88%, #022c22 100%)'
                : isAssistantSpeaking
                ? 'radial-gradient(circle at 30% 26%, #fef08a 0%, #ff8c00 46%, #c2410c 86%, #431407 100%)'
                : 'radial-gradient(circle at 32% 28%, #78716c 0%, #44403c 55%, #1c1917 100%)',
              boxShadow:
                isSpeechActive || isListening
                  ? '0 0 75px rgba(16, 185, 129, 0.55), inset 0 -14px 28px rgba(0,0,0,0.45), inset 0 12px 24px rgba(255,255,255,0.35)'
                  : isAssistantSpeaking
                  ? '0 0 80px rgba(255, 140, 0, 0.65), inset 0 -14px 28px rgba(0,0,0,0.45), inset 0 12px 24px rgba(255,255,255,0.4)'
                  : '0 0 30px rgba(0, 0, 0, 0.6), inset 0 8px 18px rgba(255,255,255,0.12)',
            }}
            className={`relative w-36 h-36 sm:w-44 sm:h-44 rounded-full transition-transform duration-150 flex flex-col items-center justify-center overflow-hidden ${
              isAnalyzing ? 'animate-spin' : isAssistantSpeaking ? 'animate-pulse' : ''
            }`}
          >
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
              ? 'Analyzing...'
              : 'در حال بررسی...'
            : isAssistantSpeaking
            ? isEn
              ? 'Speaking — Tap orb to interrupt'
              : 'در حال صحبت — با لمس گوی می‌توانید صحبت کنید'
            : isSpeechActive
            ? isEn
              ? 'Hearing your voice...'
              : 'در حال شنیدن صدای شما...'
            : isListening
            ? isEn
              ? 'Ready & Listening — Speak anytime'
              : 'آماده شنیدن — بفرمایید...'
            : isEn
            ? 'Tap the orb to speak'
            : 'برای صحبت روی گوی بزنید'}
        </p>

        {/* Live Conversational Caption */}
        <div className="mt-3 min-h-[68px] max-w-md w-full flex flex-col items-center justify-center text-center px-3">
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
            <p className="mt-1.5 text-xs text-stone-400 truncate max-w-sm">
              {isEn ? `You said: "${lastUserMessage}"` : `شما فرمودید: «${lastUserMessage}»`}
            </p>
          )}
        </div>

        {/* Minimal Summary Line when item details are captured */}
        {minimalSummaryLine && (
          <div className="mt-3 px-4 py-2 rounded-2xl bg-stone-900/75 border border-stone-800/90 text-center max-w-md">
            <p className="text-xs sm:text-sm font-bold text-amber-300 leading-relaxed">
              {minimalSummaryLine}
            </p>
          </div>
        )}

        {/* Fallback Typing Input (Appears automatically after 3 unclear voice attempts or via Keyboard icon) */}
        {showFallbackTypeBox && (
          <form
            onSubmit={handleTextSubmit}
            onClick={(e) => e.stopPropagation()}
            className="mt-4 w-full max-w-md flex items-center gap-2 bg-stone-900/90 border border-stone-700/80 rounded-2xl p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <input
              ref={typeInputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isEn
                  ? 'Type your request here...'
                  : 'خواسته یا پاسخ خود را اینجا تایپ کنید...'
              }
              className="flex-1 bg-transparent text-white text-sm font-bold px-3 py-2 focus:outline-none placeholder:text-stone-500"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isAnalyzing}
              data-keep-color="true"
              className="w-10 h-10 rounded-xl bg-[#FF8C00] hover:bg-amber-500 disabled:opacity-40 text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </form>
        )}
      </div>

      {/* Bottom Minimal Action Dock */}
      <div className="relative z-10 flex items-center justify-center gap-6 pb-2">
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
          title={isListening ? (isEn ? 'Microphone Active' : 'میکروفون فعال') : isEn ? 'Speak' : 'صحبت'}
        >
          <Mic className="w-7 h-7 text-white stroke-[2.2]" />
        </button>

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

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            destroyContinuousMicStream();
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
