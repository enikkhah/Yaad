import React, { useState, useRef, useEffect } from 'react';
import { IdeaNote, Category } from '../types';
import { 
  Lightbulb, 
  Mic, 
  MicOff, 
  Video, 
  PenTool, 
  Trash2, 
  X, 
  Square, 
  Check, 
  Sparkles, 
  FileText,
  RotateCcw,
  Smartphone,
  AlertCircle,
  Camera,
  SwitchCamera,
  Briefcase,
  Heart,
  Tag
} from 'lucide-react';
import { syncToGoogleTasks } from '../utils/googleSync';
import { ValidationAlertModal } from './ValidationAlertModal';
import { AppLanguage } from '../utils/i18n';
import {
  openAndroidSettings,
  ensureNativeAndroidCameraPermission,
  markPermissionGranted,
} from '../utils/nativePermissions';
import { appendWithoutDuplicate, safeAbortSpeechRecognition } from '../utils/speechDeduplication';

interface IdeaCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveIdea: (idea: Omit<IdeaNote, 'id' | 'createdAt'>) => void;
  onUpdateIdea?: (id: string, idea: Partial<IdeaNote>) => void;
  editingIdea?: IdeaNote | null;
  googleToken: string | null;
  language?: AppLanguage;
}

export const IdeaCaptureModal: React.FC<IdeaCaptureModalProps> = ({
  isOpen,
  onClose,
  onSaveIdea,
  onUpdateIdea,
  editingIdea,
  googleToken,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<Category>('work');
  const [activeTab, setActiveTab] = useState<'text' | 'voice' | 'photo' | 'video' | 'sketch'>('text');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Virtual keyboard tracking: keeps modal & active input pinned directly above virtual keyboard
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
        setViewportOffsetTop(window.visualViewport.offsetTop || 0);
      }
    };
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    handleViewportChange();
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  // Voice typing (Speech-to-text) state for body content
  const [isVoiceTyping, setIsVoiceTyping] = useState(false);
  const [contentInterimTranscript, setContentInterimTranscript] = useState('');
  const speechRecognitionRef = useRef<any>(null);
  const shouldKeepContentListeningRef = useRef<boolean>(false);
  const lastFinalContentTranscriptRef = useRef<string>('');
  const processedFinalContentIndicesRef = useRef<Set<number>>(new Set());
  const contentRef = useRef<string>('');
  const contentSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const contentSpeechStartTimeRef = useRef<number>(0);
  const contentLastSpeechTimeRef = useRef<number>(0);

  // Voice typing for title
  const [isTitleVoiceTyping, setIsTitleVoiceTyping] = useState(false);
  const [titleInterimTranscript, setTitleInterimTranscript] = useState('');
  const [voiceLang, setVoiceLang] = useState<'fa' | 'en'>(language === 'en' ? 'en' : 'fa');
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const titleSpeechRecognitionRef = useRef<any>(null);
  const shouldKeepTitleListeningRef = useRef<boolean>(false);
  const lastFinalTitleTranscriptRef = useRef<string>('');
  const processedFinalTitleIndicesRef = useRef<Set<number>>(new Set());
  const titleRef = useRef<string>('');
  const titleSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const titleSpeechStartTimeRef = useRef<number>(0);
  const titleLastSpeechTimeRef = useRef<number>(0);

  // Keep voiceLang synced with app language
  useEffect(() => {
    setVoiceLang(language === 'en' ? 'en' : 'fa');
  }, [language, isOpen]);

  // Keep titleRef and contentRef synced to prevent stale closures
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Video recording state (supports both rear 'environment' and front 'user' camera)
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [isVideoPreviewActive, setIsVideoPreviewActive] = useState(false);
  const [videoFacingMode, setVideoFacingMode] = useState<'environment' | 'user'>('environment');
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const videoMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoAudioStreamRef = useRef<MediaStream | null>(null);

  // Rear-camera-only photo capture state
  const [isPhotoCameraActive, setIsPhotoCameraActive] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const photoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const photoStreamRef = useRef<MediaStream | null>(null);
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string | null>(null);

  // Drawing Canvas state with Samsung S Pen & Stylus Support
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#818CF8');
  const [penSize, setPenSize] = useState(3);
  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(null);
  const [isStylusActive, setIsStylusActive] = useState(false);
  const [currentPressure, setCurrentPressure] = useState<number>(0.5);
  const [penMode, setPenMode] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Google sync checkbox
  const [syncWithGoogle, setSyncWithGoogle] = useState(!!googleToken);

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      if (editingIdea) {
        setTitle(editingIdea.title || '');
        setContent(editingIdea.content || '');
        setCategory(editingIdea.category || 'work');
        setAudioBlobUrl(editingIdea.audioRecordUrl || null);
        setVideoBlobUrl(editingIdea.videoRecordUrl || null);
        setPhotoDataUrl(editingIdea.photoDataUrl || null);
        setDrawingDataUrl(editingIdea.drawingDataUrl || null);
      } else {
        setTitle('');
        setContent('');
        setCategory('work');
        setAudioBlobUrl(null);
        setVideoBlobUrl(null);
        setPhotoDataUrl(null);
        setDrawingDataUrl(null);
      }
      setIsVoiceTyping(false);
      setIsRecordingAudio(false);
      setIsRecordingVideo(false);
      setIsVideoPreviewActive(false);
      setIsPhotoCameraActive(false);
      setCameraErrorMsg(null);
      setValidationError(null);
    }
  }, [isOpen, editingIdea]);

  // Clean up streams & speech on close or when alarm fires
  useEffect(() => {
    const cleanupAllMedia = () => {
      if (videoMediaRecorderRef.current) {
        videoMediaRecorderRef.current.onstop = null;
        try {
          if (videoMediaRecorderRef.current.state !== 'inactive') {
            videoMediaRecorderRef.current.stop();
          }
        } catch {
          // ignore
        }
        videoMediaRecorderRef.current = null;
      }
      if (videoAudioStreamRef.current) {
        videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        videoAudioStreamRef.current = null;
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      if (photoStreamRef.current) {
        photoStreamRef.current.getTracks().forEach((t) => t.stop());
        photoStreamRef.current = null;
      }
      setIsRecordingVideo(false);
      setIsVideoPreviewActive(false);
      setIsPhotoCameraActive(false);
      shouldKeepContentListeningRef.current = false;
      shouldKeepTitleListeningRef.current = false;
      if (contentSilenceTimerRef.current) clearTimeout(contentSilenceTimerRef.current);
      if (titleSilenceTimerRef.current) clearTimeout(titleSilenceTimerRef.current);
      setIsVoiceTyping(false);
      setIsTitleVoiceTyping(false);
      setTitleInterimTranscript('');
      setContentInterimTranscript('');
      lastFinalTitleTranscriptRef.current = '';
      lastFinalContentTranscriptRef.current = '';
      processedFinalTitleIndicesRef.current.clear();
      processedFinalContentIndicesRef.current.clear();
      if (speechRecognitionRef.current) {
        safeAbortSpeechRecognition(speechRecognitionRef.current);
        speechRecognitionRef.current = null;
      }
      if (titleSpeechRecognitionRef.current) {
        safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
        titleSpeechRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current && isRecordingAudio) {
        mediaRecorderRef.current.stop();
      }
    };

    if (!isOpen) {
      cleanupAllMedia();
    }

    window.addEventListener('yaad:stop-all-microphones', cleanupAllMedia);
    return () => {
      window.removeEventListener('yaad:stop-all-microphones', cleanupAllMedia);
    };
  }, [isOpen, isRecordingAudio]);

  // 0. VOICE TYPING FOR TITLE (تبدیل گفتار به متن برای عنوان ایده)
  const toggleTitleVoiceTyping = async (forcedLang?: 'fa' | 'en') => {
    setVoiceErrorMsg(null);
    if (isTitleVoiceTyping) {
      shouldKeepTitleListeningRef.current = false;
      if (titleSilenceTimerRef.current) {
        clearTimeout(titleSilenceTimerRef.current);
        titleSilenceTimerRef.current = null;
      }
      safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
      titleSpeechRecognitionRef.current = null;
      setIsTitleVoiceTyping(false);
      setTitleInterimTranscript('');
      lastFinalTitleTranscriptRef.current = '';
      processedFinalTitleIndicesRef.current.clear();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceErrorMsg(isEn ? 'Speech recognition not supported on this device.' : 'تبدیل گفتار به متن در این دستگاه در دسترس نیست.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    // Clean up any existing title recognition instance
    safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
    titleSpeechRecognitionRef.current = null;
    setTitleInterimTranscript('');
    lastFinalTitleTranscriptRef.current = '';
    processedFinalTitleIndicesRef.current.clear();

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepTitleListeningRef.current = true;
      titleSpeechStartTimeRef.current = Date.now();
      titleLastSpeechTimeRef.current = 0;
      setIsTitleVoiceTyping(true);

      const resetTitleSilenceTimer = (durationMs = 5000) => {
        if (titleSilenceTimerRef.current) {
          clearTimeout(titleSilenceTimerRef.current);
          titleSilenceTimerRef.current = null;
        }
        titleSilenceTimerRef.current = setTimeout(() => {
          shouldKeepTitleListeningRef.current = false;
          safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
          titleSpeechRecognitionRef.current = null;
          setIsTitleVoiceTyping(false);
          setTitleInterimTranscript('');
        }, durationMs);
      };

      resetTitleSilenceTimer(5000);

      const createAndRunTitleRec = () => {
        if (!shouldKeepTitleListeningRef.current) return;

        const now = Date.now();
        const refTime = titleLastSpeechTimeRef.current || titleSpeechStartTimeRef.current;
        if (now - refTime >= 4900) {
          shouldKeepTitleListeningRef.current = false;
          safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
          titleSpeechRecognitionRef.current = null;
          setIsTitleVoiceTyping(false);
          setTitleInterimTranscript('');
          return;
        }

        try {
          if (titleSpeechRecognitionRef.current) {
            safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
            titleSpeechRecognitionRef.current = null;
          }

          const recognition = new SpeechRecognition();
          recognition.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          recognition.continuous = true;
          recognition.interimResults = true;
          processedFinalTitleIndicesRef.current.clear();

          recognition.onstart = () => {
            setIsTitleVoiceTyping(true);
          };

          recognition.onresult = (event: any) => {
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                if (!processedFinalTitleIndicesRef.current.has(i)) {
                  processedFinalTitleIndicesRef.current.add(i);
                  const finalChunk = res[0]?.transcript?.trim();
                  if (finalChunk && finalChunk !== lastFinalTitleTranscriptRef.current) {
                    lastFinalTitleTranscriptRef.current = finalChunk;
                    titleLastSpeechTimeRef.current = Date.now();

                    const currentTitle = titleRef.current || '';
                    const updated = appendWithoutDuplicate(currentTitle, finalChunk);
                    if (updated !== currentTitle) {
                      titleRef.current = updated;
                      setTitle(updated);
                    }
                  }
                }
              } else {
                interimText += res[0]?.transcript || '';
              }
            }

            const cleanInterim = interimText.trim();
            setTitleInterimTranscript(cleanInterim);
            if (cleanInterim) {
              titleLastSpeechTimeRef.current = Date.now();
            }

            resetTitleSilenceTimer(5000);
          };

          recognition.onerror = (e: any) => {
            if (e.error === 'no-speech') {
              const now = Date.now();
              const refTime = titleLastSpeechTimeRef.current || titleSpeechStartTimeRef.current;
              if (now - refTime >= 4800) {
                shouldKeepTitleListeningRef.current = false;
                safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
                titleSpeechRecognitionRef.current = null;
                setIsTitleVoiceTyping(false);
                setTitleInterimTranscript('');
              }
              return;
            }
            if (e.error === 'not-allowed') {
              shouldKeepTitleListeningRef.current = false;
              safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
              titleSpeechRecognitionRef.current = null;
              setIsTitleVoiceTyping(false);
              setTitleInterimTranscript('');
              return;
            }
          };

          recognition.onend = () => {
            if (!shouldKeepTitleListeningRef.current) {
              setIsTitleVoiceTyping(false);
              setTitleInterimTranscript('');
              return;
            }

            const now = Date.now();
            const refTime = titleLastSpeechTimeRef.current || titleSpeechStartTimeRef.current;
            if (now - refTime >= 4800) {
              shouldKeepTitleListeningRef.current = false;
              safeAbortSpeechRecognition(titleSpeechRecognitionRef.current);
              titleSpeechRecognitionRef.current = null;
              setIsTitleVoiceTyping(false);
              setTitleInterimTranscript('');
              return;
            }

            setTimeout(() => {
              if (shouldKeepTitleListeningRef.current) {
                createAndRunTitleRec();
              }
            }, 150);
          };

          titleSpeechRecognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.warn('Title speech recognition failed', e);
          setIsTitleVoiceTyping(false);
        }
      };

      createAndRunTitleRec();
    } catch (e) {
      console.warn('Title speech recognition failed', e);
      setIsTitleVoiceTyping(false);
    }
  };

  // 1. VOICE TYPING (Speech-to-text for Persian / English)
  const toggleVoiceTyping = async (forcedLang?: 'fa' | 'en') => {
    setVoiceErrorMsg(null);
    if (isVoiceTyping) {
      shouldKeepContentListeningRef.current = false;
      if (contentSilenceTimerRef.current) {
        clearTimeout(contentSilenceTimerRef.current);
        contentSilenceTimerRef.current = null;
      }
      safeAbortSpeechRecognition(speechRecognitionRef.current);
      speechRecognitionRef.current = null;
      setIsVoiceTyping(false);
      setContentInterimTranscript('');
      lastFinalContentTranscriptRef.current = '';
      processedFinalContentIndicesRef.current.clear();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceErrorMsg(isEn ? 'Speech recognition not supported on this device.' : 'تبدیل گفتار به متن در این دستگاه در دسترس نیست.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    // Clean up any existing content recognition instance
    safeAbortSpeechRecognition(speechRecognitionRef.current);
    speechRecognitionRef.current = null;
    setContentInterimTranscript('');
    lastFinalContentTranscriptRef.current = '';
    processedFinalContentIndicesRef.current.clear();

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepContentListeningRef.current = true;
      contentSpeechStartTimeRef.current = Date.now();
      contentLastSpeechTimeRef.current = 0;
      setIsVoiceTyping(true);

      const resetContentSilenceTimer = (durationMs = 5000) => {
        if (contentSilenceTimerRef.current) {
          clearTimeout(contentSilenceTimerRef.current);
          contentSilenceTimerRef.current = null;
        }
        contentSilenceTimerRef.current = setTimeout(() => {
          shouldKeepContentListeningRef.current = false;
          safeAbortSpeechRecognition(speechRecognitionRef.current);
          speechRecognitionRef.current = null;
          setIsVoiceTyping(false);
          setContentInterimTranscript('');
        }, durationMs);
      };

      resetContentSilenceTimer(5000);

      const createAndRunContentRec = () => {
        if (!shouldKeepContentListeningRef.current) return;

        const now = Date.now();
        const refTime = contentLastSpeechTimeRef.current || contentSpeechStartTimeRef.current;
        if (now - refTime >= 4900) {
          shouldKeepContentListeningRef.current = false;
          safeAbortSpeechRecognition(speechRecognitionRef.current);
          speechRecognitionRef.current = null;
          setIsVoiceTyping(false);
          setContentInterimTranscript('');
          return;
        }

        try {
          if (speechRecognitionRef.current) {
            safeAbortSpeechRecognition(speechRecognitionRef.current);
            speechRecognitionRef.current = null;
          }

          const recognition = new SpeechRecognition();
          recognition.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          recognition.continuous = true;
          recognition.interimResults = true;
          processedFinalContentIndicesRef.current.clear();

          recognition.onstart = () => {
            setIsVoiceTyping(true);
          };

          recognition.onresult = (event: any) => {
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                if (!processedFinalContentIndicesRef.current.has(i)) {
                  processedFinalContentIndicesRef.current.add(i);
                  const finalChunk = res[0]?.transcript?.trim();
                  if (finalChunk && finalChunk !== lastFinalContentTranscriptRef.current) {
                    lastFinalContentTranscriptRef.current = finalChunk;
                    contentLastSpeechTimeRef.current = Date.now();

                    const currentContent = contentRef.current || '';
                    const updated = appendWithoutDuplicate(currentContent, finalChunk);
                    if (updated !== currentContent) {
                      contentRef.current = updated;
                      setContent(updated);
                    }
                  }
                }
              } else {
                interimText += res[0]?.transcript || '';
              }
            }

            const cleanInterim = interimText.trim();
            setContentInterimTranscript(cleanInterim);
            if (cleanInterim) {
              contentLastSpeechTimeRef.current = Date.now();
            }

            resetContentSilenceTimer(5000);
          };

          recognition.onerror = (e: any) => {
            if (e.error === 'no-speech') {
              const now = Date.now();
              const refTime = contentLastSpeechTimeRef.current || contentSpeechStartTimeRef.current;
              if (now - refTime >= 4800) {
                shouldKeepContentListeningRef.current = false;
                safeAbortSpeechRecognition(speechRecognitionRef.current);
                speechRecognitionRef.current = null;
                setIsVoiceTyping(false);
                setContentInterimTranscript('');
              }
              return;
            }
            if (e.error === 'not-allowed') {
              shouldKeepContentListeningRef.current = false;
              safeAbortSpeechRecognition(speechRecognitionRef.current);
              speechRecognitionRef.current = null;
              setIsVoiceTyping(false);
              setContentInterimTranscript('');
              return;
            }
          };

          recognition.onend = () => {
            if (!shouldKeepContentListeningRef.current) {
              setIsVoiceTyping(false);
              setContentInterimTranscript('');
              return;
            }

            const now = Date.now();
            const refTime = contentLastSpeechTimeRef.current || contentSpeechStartTimeRef.current;
            if (now - refTime >= 4800) {
              shouldKeepContentListeningRef.current = false;
              safeAbortSpeechRecognition(speechRecognitionRef.current);
              speechRecognitionRef.current = null;
              setIsVoiceTyping(false);
              setContentInterimTranscript('');
              return;
            }

            setTimeout(() => {
              if (shouldKeepContentListeningRef.current) {
                createAndRunContentRec();
              }
            }, 150);
          };

          speechRecognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.warn('Speech recognition start failed', e);
          setIsVoiceTyping(false);
        }
      };

      createAndRunContentRec();
    } catch (e) {
      console.warn('Speech recognition start failed', e);
      setIsVoiceTyping(false);
    }
  };

  // 2. AUDIO MEMO RECORDING
  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioBlobUrl(url);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecordingAudio(true);
    } catch (err) {
      console.warn('Microphone recording access denied:', err);
      openAndroidSettings('microphone');
    }
  };

  const stopAudioRecording = () => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
    }
  };

  // 3. CAMERA STREAM HELPERS, VIDEO RECORDING & REAR-CAMERA PHOTO CAPTURE
  const attachStreamToVideo = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!el || !stream) return;
    try {
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
      requestAnimationFrame(() => {
        if (el.srcObject === stream && el.paused) {
          el.play().catch(() => {});
        }
      });
    } catch {
      // ignore play race condition
    }
  };

  const setVideoPreviewElement = (node: HTMLVideoElement | null) => {
    videoPreviewRef.current = node;
    if (node && videoStreamRef.current) {
      attachStreamToVideo(node, videoStreamRef.current);
    }
  };

  const setPhotoPreviewElement = (node: HTMLVideoElement | null) => {
    photoPreviewRef.current = node;
    if (node && photoStreamRef.current) {
      attachStreamToVideo(node, photoStreamRef.current);
    }
  };

  const openCameraVideoStream = async (facing: 'environment' | 'user'): Promise<MediaStream> => {
    await ensureNativeAndroidCameraPermission(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported');
    }

    const candidates: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { exact: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: { facingMode: facing },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    for (const constraints of candidates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) {
          markPermissionGranted('camera');
          return stream;
        }
      } catch {
        // try next fallback constraint
      }
    }

    throw new Error('Unable to access camera stream');
  };

  const stopVideoPreviewStream = () => {
    if (videoAudioStreamRef.current) {
      videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      videoAudioStreamRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    setIsVideoPreviewActive(false);
  };

  const startVideoLivePreview = async (
    overrideFacing?: 'environment' | 'user',
    silent = false
  ): Promise<MediaStream | null> => {
    const targetFacing = overrideFacing || videoFacingMode;
    setCameraErrorMsg(null);
    try {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      const stream = await openCameraVideoStream(targetFacing);
      videoStreamRef.current = stream;
      setIsVideoPreviewActive(true);
      if (videoPreviewRef.current) {
        attachStreamToVideo(videoPreviewRef.current, stream);
      }
      return stream;
    } catch (err) {
      console.warn('Video live preview error:', err);
      setIsVideoPreviewActive(false);
      setCameraErrorMsg(
        isEn
          ? 'Camera access could not be started. Please check camera permission.'
          : 'دسترسی به پیش‌نمایش زنده دوربین ممکن نشد. لطفاً مجوز دوربین را بررسی کنید.'
      );
      if (!silent) {
        openAndroidSettings('camera');
      }
      return null;
    }
  };

  // Ensure live video preview element always attaches to the active stream after render
  useEffect(() => {
    if ((isRecordingVideo || isVideoPreviewActive) && videoPreviewRef.current && videoStreamRef.current) {
      attachStreamToVideo(videoPreviewRef.current, videoStreamRef.current);
    }
  }, [isRecordingVideo, isVideoPreviewActive, activeTab, videoFacingMode]);

  // Ensure rear-camera photo preview element attaches to the active photo stream after render
  useEffect(() => {
    if (isPhotoCameraActive && photoPreviewRef.current && photoStreamRef.current) {
      attachStreamToVideo(photoPreviewRef.current, photoStreamRef.current);
    }
  }, [isPhotoCameraActive, activeTab]);

  // Auto-start live camera preview when switching into Photo or Video tabs, and stop unused streams when leaving
  useEffect(() => {
    if (!isOpen) return;

    if (activeTab !== 'video' && !isRecordingVideo && videoStreamRef.current) {
      stopVideoPreviewStream();
    }
    if (activeTab !== 'photo' && photoStreamRef.current) {
      photoStreamRef.current.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
      if (photoPreviewRef.current) {
        photoPreviewRef.current.srcObject = null;
      }
      setIsPhotoCameraActive(false);
    }

    if (activeTab === 'photo' && !photoDataUrl && !photoStreamRef.current) {
      startRearPhotoCamera(true);
    } else if (activeTab === 'video' && !videoBlobUrl && !videoStreamRef.current && !isRecordingVideo) {
      startVideoLivePreview(videoFacingMode, true);
    }
  }, [isOpen, activeTab]);

  const startVideoRecording = async (overrideFacing?: 'environment' | 'user') => {
    const targetFacing = overrideFacing || videoFacingMode;
    setCameraErrorMsg(null);
    try {
      setVideoBlobUrl(null);

      // Reuse active live preview stream if already running for the same camera, otherwise open it now
      let videoStream = videoStreamRef.current;
      const hasLiveVideoTrack =
        videoStream &&
        videoStream.getVideoTracks().some((t) => t.readyState === 'live') &&
        (!overrideFacing || overrideFacing === videoFacingMode);

      if (!hasLiveVideoTrack || !videoStream) {
        if (videoStream) {
          videoStream.getTracks().forEach((t) => t.stop());
          videoStreamRef.current = null;
        }
        videoStream = await openCameraVideoStream(targetFacing);
        videoStreamRef.current = videoStream;
      }

      setIsVideoPreviewActive(true);
      setIsRecordingVideo(true);

      if (videoPreviewRef.current) {
        attachStreamToVideo(videoPreviewRef.current, videoStream);
      }

      // Optionally acquire microphone audio stream separately so camera live preview never fails or flickers
      if (videoAudioStreamRef.current) {
        videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        videoAudioStreamRef.current = null;
      }
      let audioStream: MediaStream | null = null;
      try {
        await ensureNativeAndroidCameraPermission(true);
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        videoAudioStreamRef.current = audioStream;
      } catch (audioErr) {
        console.warn('Video recording proceeding without audio track:', audioErr);
      }

      const combinedTracks: MediaStreamTrack[] = [
        ...videoStream.getVideoTracks(),
        ...(audioStream ? audioStream.getAudioTracks() : []),
      ];
      const recordingStream = new MediaStream(combinedTracks);

      const mimeCandidates = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ];
      let selectedMime = '';
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        for (const candidate of mimeCandidates) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            selectedMime = candidate;
            break;
          }
        }
      }

      videoChunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = selectedMime
          ? new MediaRecorder(recordingStream, { mimeType: selectedMime })
          : new MediaRecorder(recordingStream);
      } catch {
        // Fallback to video-only stream if combining audio track was rejected by MediaRecorder
        recorder = new MediaRecorder(videoStream);
      }

      videoMediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) videoChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || selectedMime || 'video/webm';
        const videoBlob = new Blob(videoChunksRef.current, { type: finalMime });
        const url = URL.createObjectURL(videoBlob);
        setVideoBlobUrl(url);

        if (videoAudioStreamRef.current) {
          videoAudioStreamRef.current.getTracks().forEach((t) => t.stop());
          videoAudioStreamRef.current = null;
        }
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach((t) => t.stop());
          videoStreamRef.current = null;
        }
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
        }
        setIsVideoPreviewActive(false);
        setIsRecordingVideo(false);
      };

      recorder.start(250);
    } catch (err) {
      console.warn('Video recording access denied:', err);
      setIsRecordingVideo(false);
      setCameraErrorMsg(
        isEn
          ? 'Could not start video recording. Please check camera permission.'
          : 'شروع فیلم‌برداری ممکن نشد. لطفاً دسترسی دوربین را بررسی کنید.'
      );
      openAndroidSettings('camera');
    }
  };

  const stopVideoRecording = () => {
    if (videoMediaRecorderRef.current && isRecordingVideo) {
      try {
        if (videoMediaRecorderRef.current.state !== 'inactive') {
          videoMediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      setIsRecordingVideo(false);
      setIsVideoPreviewActive(false);
    }
  };

  const toggleVideoCameraFacing = async () => {
    const nextFacing: 'environment' | 'user' = videoFacingMode === 'environment' ? 'user' : 'environment';
    setVideoFacingMode(nextFacing);
    if (isRecordingVideo) {
      // Restart video recording smoothly with the newly selected camera
      if (videoMediaRecorderRef.current) {
        videoMediaRecorderRef.current.onstop = null;
        try {
          if (videoMediaRecorderRef.current.state !== 'inactive') {
            videoMediaRecorderRef.current.stop();
          }
        } catch {
          // ignore
        }
      }
      await startVideoRecording(nextFacing);
    } else {
      setVideoBlobUrl(null);
      await startVideoLivePreview(nextFacing, true);
    }
  };

  // 3B. PHOTO CAPTURE (Strictly Rear Camera Only - 'environment')
  const startRearPhotoCamera = async (silent = false) => {
    setCameraErrorMsg(null);
    try {
      if (photoStreamRef.current) {
        photoStreamRef.current.getTracks().forEach((t) => t.stop());
        photoStreamRef.current = null;
      }
      const stream = await openCameraVideoStream('environment');
      photoStreamRef.current = stream;
      setPhotoDataUrl(null);
      setIsPhotoCameraActive(true);
      if (photoPreviewRef.current) {
        attachStreamToVideo(photoPreviewRef.current, stream);
      }
    } catch (err) {
      console.warn('Rear camera photo access denied:', err);
      setIsPhotoCameraActive(false);
      setCameraErrorMsg(
        isEn
          ? 'Rear camera preview could not be started. Please check camera permission.'
          : 'دسترسی به پیش‌نمایش دوربین پشتی ممکن نشد. لطفاً مجوز دوربین را بررسی کنید.'
      );
      if (!silent) {
        openAndroidSettings('camera');
      }
    }
  };

  const stopRearPhotoCamera = () => {
    if (photoStreamRef.current) {
      photoStreamRef.current.getTracks().forEach((t) => t.stop());
      photoStreamRef.current = null;
    }
    if (photoPreviewRef.current) {
      photoPreviewRef.current.srcObject = null;
    }
    setIsPhotoCameraActive(false);
  };

  const capturePhotoFromRearCamera = () => {
    const videoEl = photoPreviewRef.current;
    if (!videoEl) return;
    const width = videoEl.videoWidth || videoEl.clientWidth || 1280;
    const height = videoEl.videoHeight || videoEl.clientHeight || 720;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.88);
    setPhotoDataUrl(dataUrl);
    stopRearPhotoCamera();
  };

  // 4. DRAWING CANVAS LOGIC WITH SAMSUNG S PEN / STYLUS SUPPORT
  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#1c1917'; // stone-900 background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    if (activeTab === 'sketch' && canvasRef.current) {
      initCanvas();
    }
  }, [activeTab]);

  // Handle Samsung S Pen & Stylus Pointer Events
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Palm Rejection: If stylus/pen is present or touched, reject touch inputs from palm/fingers
    const isPen = e.pointerType === 'pen';
    setIsStylusActive(isPen);

    // If Samsung S Pen eraser button is held (buttons === 32 or button === 5)
    const isEraserButton = e.buttons === 32 || (e as any).button === 5;
    const currentMode = isEraserButton ? 'eraser' : penMode;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture pointer for smooth drawing outside canvas boundaries
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    lastPointRef.current = { x, y };

    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    setCurrentPressure(pressure);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);

    if (currentMode === 'eraser') {
      ctx.strokeStyle = '#1c1917'; // Canvas background color
      ctx.lineWidth = penSize * 5;
    } else if (currentMode === 'highlighter') {
      ctx.strokeStyle = penColor + '66'; // Translucent highlighter
      ctx.lineWidth = penSize * 4;
    } else {
      // Natural S Pen pressure-sensitive line width
      const dynamicWidth = isPen ? Math.max(1, penSize * pressure * 2.2) : penSize;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = dynamicWidth;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const isPen = e.pointerType === 'pen';
    setIsStylusActive(isPen);

    const isEraserButton = e.buttons === 32 || (e as any).button === 5;
    const currentMode = isEraserButton ? 'eraser' : penMode;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    setCurrentPressure(pressure);

    ctx.beginPath();
    if (lastPointRef.current) {
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    } else {
      ctx.moveTo(x, y);
    }

    if (currentMode === 'eraser') {
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = penSize * 5;
    } else if (currentMode === 'highlighter') {
      ctx.strokeStyle = penColor + '66';
      ctx.lineWidth = penSize * 4;
    } else {
      // Pressure-sensitive line width with smooth scaling
      const dynamicWidth = isPen ? Math.max(1, penSize * pressure * 2.2) : penSize;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = dynamicWidth;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPointRef.current = { x, y };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      setDrawingDataUrl(canvas.toDataURL('image/png'));
    }
  };

  const clearCanvas = () => {
    initCanvas();
    setDrawingDataUrl(null);
  };

  // Submit idea
  const handleSave = async () => {
    if (!title.trim()) {
      setShowValidationModal(true);
      return;
    }

    setValidationError(null);
    const finalTitle = title.trim();

    if (editingIdea && onUpdateIdea) {
      onUpdateIdea(editingIdea.id, {
        title: finalTitle,
        content: content.trim(),
        category,
        audioRecordUrl: audioBlobUrl || undefined,
        videoRecordUrl: videoBlobUrl || undefined,
        photoDataUrl: photoDataUrl || undefined,
        drawingDataUrl: drawingDataUrl || undefined,
      });
    } else {
      onSaveIdea({
        title: finalTitle,
        content: content.trim(),
        category,
        audioRecordUrl: audioBlobUrl || undefined,
        videoRecordUrl: videoBlobUrl || undefined,
        photoDataUrl: photoDataUrl || undefined,
        drawingDataUrl: drawingDataUrl || undefined,
        googleSynced: syncWithGoogle && !!googleToken,
      });
    }

    // Sync with Google Tasks if enabled
    if (syncWithGoogle && googleToken) {
      try {
        await syncToGoogleTasks({ title: `[ایده] ${finalTitle}`, description: content }, googleToken);
      } catch (err) {
        console.warn('Google tasks sync failed for idea:', err);
      }
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center items-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in overflow-hidden"
      style={{
        height: viewportHeight ? `${viewportHeight}px` : '100dvh',
        top: viewportOffsetTop ? `${viewportOffsetTop}px` : 0,
        bottom: 'auto',
      }}
    >
      <div 
        id="idea-capture-modal-panel"
        className="w-full max-w-2xl bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-150"
        style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '92dvh' }}
        dir={isEn ? 'ltr' : 'rtl'}
      >
        {/* Header */}
        <div className="shrink-0 px-2.5 sm:px-5 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/95">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Lightbulb className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-white">
              {editingIdea 
                ? (isEn ? 'Edit Idea' : 'ویرایش ایده') 
                : (isEn ? 'Capture Idea & Thoughts' : 'ثبت ایده و افکار لحظه‌ای')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
            title={isEn ? 'Close' : 'بستن'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 py-4 sm:p-5 space-y-4">
          {/* Required Field Validation Alert Banner */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Primary Title Field — Distinct & First */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-indigo-950/55 via-stone-900/95 to-stone-950 border-2 border-indigo-500/55 shadow-lg shadow-indigo-500/10 space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-1.5">
              <label className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F7941E] shadow-[0_0_8px_rgba(247,148,30,0.85)] shrink-0" />
                <span>{isEn ? 'Idea Title' : 'عنوان ایده یا فکر'}</span>
                <span className="text-[#F7941E] font-black text-base">*</span>
              </label>
              {isTitleVoiceTyping && (
                <span className="text-[11px] font-bold text-indigo-300">
                  {titleInterimTranscript ? `«${titleInterimTranscript}»` : (isEn ? 'Listening (stops in 5s)...' : 'منتظر صوت (توقف با ۵ ثانیه سکوت)...')}
                </span>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder={isEn ? 'e.g. Marketing campaign, Redesign idea...' : 'مثلاً: ایده راه‌اندازی کمپین بازاریابی، طراحی مجدد...'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={`w-full ${isEn ? 'pr-13 pl-4' : 'pl-13 pr-4'} py-3.5 rounded-2xl bg-stone-950 border-2 border-indigo-400/70 focus:border-[#F7941E] ring-2 ring-indigo-500/15 focus:ring-[#F7941E]/25 text-white placeholder-stone-400 text-base sm:text-lg font-extrabold outline-none transition-all shadow-inner`}
              />
              <button
                type="button"
                onClick={() => toggleTitleVoiceTyping()}
                className={`absolute ${isEn ? 'right-2' : 'left-2'} w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer ` + (isTitleVoiceTyping ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30' : 'bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 hover:text-white border border-indigo-400/40')}
                title={isTitleVoiceTyping ? (isEn ? 'Stop voice typing' : 'توقف ضبط گفتار عنوان') : (isEn ? 'Voice input' : 'تایپ صوتی عنوان ایده')}
              >
                {isTitleVoiceTyping ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
            {voiceErrorMsg && (
              <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-1.5 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                <span>{voiceErrorMsg}</span>
              </div>
            )}
          </div>

          {/* Category Tabs (similar to Occasion Types) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-300 block">
              {isEn ? 'Idea Category' : 'دسته‌بندی ایده'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                {
                  id: 'work' as Category,
                  labelFa: 'کاری',
                  labelEn: 'Work',
                  icon: Briefcase,
                  activeClass: 'bg-sky-500/20 border-sky-500 text-sky-300 shadow-sm shadow-sky-500/20',
                },
                {
                  id: 'family' as Category,
                  labelFa: 'خانواده',
                  labelEn: 'Family',
                  icon: Heart,
                  activeClass: 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm shadow-rose-500/20',
                },
                {
                  id: 'other' as Category,
                  labelFa: 'شخصی / سایر',
                  labelEn: 'Personal / Other',
                  icon: Tag,
                  activeClass: 'bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-sm shadow-indigo-500/20',
                },
              ]).map((cat) => {
                const IconComp = cat.icon;
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? cat.activeClass
                        : 'bg-stone-950 border-stone-800 text-stone-400 hover:text-stone-200 hover:border-stone-700'
                    }`}
                  >
                    <IconComp className="w-4 h-4 shrink-0" />
                    <span className="truncate">{isEn ? cat.labelEn : cat.labelFa}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode Switch Tabs - Only icons with header "امکانات ورود" */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-stone-300 block">
              {isEn ? 'Input options' : 'امکانات ورود'}
            </label>
            <div className="flex bg-stone-950 p-1 rounded-xl border border-stone-800">
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'text' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Text & Voice' : 'متن و تایپ صوتی'}
                aria-label={isEn ? 'Text & Voice' : 'متن و تایپ صوتی'}
              >
                <FileText className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('voice')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'voice' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Voice Memo' : 'ضبط صدا'}
                aria-label={isEn ? 'Voice Memo' : 'ضبط صدا'}
              >
                <Mic className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('photo')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'photo' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Take Photo (Rear Camera)' : 'عکس‌برداری (دوربین پشتی)'}
                aria-label={isEn ? 'Take Photo (Rear Camera)' : 'عکس‌برداری (دوربین پشتی)'}
              >
                <Camera className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('video')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'video' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Video' : 'ضبط ویدیو'}
                aria-label={isEn ? 'Video' : 'ضبط ویدیو'}
              >
                <Video className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sketch')}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'sketch' ? 'bg-indigo-500 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-900'
                }`}
                title={isEn ? 'Sketch' : 'رسم با قلم'}
                aria-label={isEn ? 'Sketch' : 'رسم با قلم'}
              >
                <PenTool className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* TAB 1: TEXT & VOICE TYPING */}
          {activeTab === 'text' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-stone-400">
                  {isEn ? 'Idea & notes description:' : 'توضیحات ایده و افکار:'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleVoiceTyping()}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isVoiceTyping
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-stone-800 hover:bg-stone-700 text-stone-300'
                    }`}
                  >
                    {isVoiceTyping ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-indigo-400" />}
                    <span>
                      {isVoiceTyping ? (
                        contentInterimTranscript ? (
                          <span className="text-indigo-200 font-medium">«{contentInterimTranscript}»</span>
                        ) : (
                          isEn ? 'Waiting (stops in 5s)' : 'منتظر صوت (خاموشی در ۵ ثانیه)'
                        )
                      ) : (
                        isEn ? 'Voice Typing' : 'شروع تایپ صوتی'
                      )}
                    </span>
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={isEn ? 'Write your thoughts, goals, or details here, or tap voice typing...' : 'افکار، اهداف یا جزئیات ایده‌تان را اینجا بنویسید یا دکمه تایپ صوتی را لمس کنید...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-sm focus:border-indigo-500 outline-none leading-relaxed"
              />
            </div>
          )}

          {/* TAB 2: AUDIO RECORDING */}
          {activeTab === 'voice' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center text-center space-y-4">
              <p className="text-xs text-stone-400">
                ایده صوتی خود را ضبط کنید تا بعداً با لمس دکمه پخش به آن گوش دهید:
              </p>

              {!isRecordingAudio ? (
                <button
                  type="button"
                  onClick={startAudioRecording}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-lg shadow-rose-600/30 transition-all hover:scale-105"
                >
                  <Mic className="w-5 h-5" />
                  <span>شروع ضبط صوت</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopAudioRecording}
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white font-black text-sm animate-pulse shadow-lg"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>توقف و ذخیره صدا</span>
                </button>
              )}

              {audioBlobUrl && (
                <div className="w-full pt-2 flex flex-col items-center gap-2 border-t border-stone-800">
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-4 h-4" /> فایل صوتی با موفقیت ضبط شد
                  </span>
                  <audio controls src={audioBlobUrl} className="w-full max-w-md h-10 rounded-lg" />
                </div>
              )}
            </div>
          )}

          {/* TAB 2B: REAR-CAMERA-ONLY PHOTO CAPTURE */}
          {activeTab === 'photo' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center space-y-3">
              <div className="w-full flex items-center justify-between text-xs text-stone-400 px-1">
                <span className="flex items-center gap-1.5 font-bold text-indigo-300">
                  <Camera className="w-4 h-4" />
                  <span>{isEn ? 'Photo Capture (Rear Camera Only)' : 'عکس‌برداری ایده (فقط با دوربین پشتی)'}</span>
                </span>
                {photoDataUrl && !isPhotoCameraActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoDataUrl(null);
                      startRearPhotoCamera(true);
                    }}
                    className="flex items-center gap-1 text-rose-400 hover:text-rose-300 text-[11px] font-bold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Delete Photo' : 'حذف عکس'}</span>
                  </button>
                )}
              </div>

              <div className="w-full max-w-sm aspect-video bg-black rounded-xl overflow-hidden border border-stone-800 relative flex items-center justify-center">
                <video
                  ref={setPhotoPreviewElement}
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  onCanPlay={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  className={`w-full h-full object-cover transition-opacity duration-150 ${
                    isPhotoCameraActive
                      ? 'opacity-100 relative z-10'
                      : 'opacity-0 pointer-events-none absolute inset-0'
                  }`}
                />

                {!isPhotoCameraActive && photoDataUrl && (
                  <img
                    src={photoDataUrl}
                    alt={isEn ? 'Captured idea photo' : 'عکس ثبت‌شده ایده'}
                    className="w-full h-full object-cover relative z-10"
                  />
                )}

                {!isPhotoCameraActive && !photoDataUrl && (
                  <div className="flex flex-col items-center text-stone-400 text-xs gap-2 p-4 text-center relative z-10">
                    <Camera className="w-8 h-8 text-indigo-400" />
                    <span>
                      {cameraErrorMsg ||
                        (isEn ? 'Rear camera preview' : 'پیش‌نمایش زنده دوربین پشتی جهت عکس‌برداری')}
                    </span>
                  </div>
                )}

                {isPhotoCameraActive && (
                  <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/65 border border-white/15 text-white text-[10px] font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{isEn ? 'Live Rear Camera' : 'پیش‌نمایش زنده دوربین پشتی'}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2.5 flex-wrap">
                {!isPhotoCameraActive ? (
                  <button
                    type="button"
                    onClick={() => startRearPhotoCamera(false)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>
                      {photoDataUrl
                        ? (isEn ? 'Retake Photo (Rear Camera)' : 'ثبت مجدد عکس با دوربین پشتی')
                        : (isEn ? 'Open Rear Camera' : 'باز کردن دوربین پشتی')}
                    </span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={capturePhotoFromRearCamera}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs shadow-lg shadow-emerald-500/25 transition-all cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>{isEn ? 'Take Photo' : 'ثبت عکس'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopRearPhotoCamera}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 font-bold text-xs transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>{isEn ? 'Close Camera' : 'بستن دوربین'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: VIDEO RECORDING (Live Viewfinder + Rear / Selfie Camera Switch) */}
          {activeTab === 'video' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center space-y-3">
              {/* Camera Selection Header */}
              <div className="w-full max-w-sm flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-300 flex items-center gap-1.5">
                  <Video className="w-4 h-4 text-indigo-400" />
                  <span>
                    {videoFacingMode === 'environment'
                      ? (isEn ? 'Rear Camera' : 'دوربین پشتی')
                      : (isEn ? 'Front Selfie Camera' : 'دوربین سلفی (جلو)')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={toggleVideoCameraFacing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-700 text-indigo-300 text-xs font-bold transition-all cursor-pointer"
                  title={isEn ? 'Switch between rear and selfie camera' : 'تغییر بین دوربین پشتی و دوربین سلفی'}
                >
                  <SwitchCamera className="w-4 h-4" />
                  <span>
                    {videoFacingMode === 'environment'
                      ? (isEn ? 'Switch to Selfie' : 'تغییر به دوربین سلفی')
                      : (isEn ? 'Switch to Rear Camera' : 'تغییر به دوربین پشتی')}
                  </span>
                </button>
              </div>

              <div className="w-full max-w-sm aspect-video bg-black rounded-xl overflow-hidden border border-stone-800 relative flex items-center justify-center">
                {/* Keep live video element rendered without display:none so WebView always decodes live frames */}
                <video
                  ref={setVideoPreviewElement}
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  onCanPlay={(e) => {
                    e.currentTarget.play().catch(() => {});
                  }}
                  className={`w-full h-full object-cover transition-opacity duration-150 ${
                    isRecordingVideo || isVideoPreviewActive
                      ? 'opacity-100 relative z-10'
                      : 'opacity-0 pointer-events-none absolute inset-0'
                  } ${videoFacingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                />

                {!isRecordingVideo && !isVideoPreviewActive && videoBlobUrl && (
                  <video src={videoBlobUrl} controls playsInline className="w-full h-full object-cover relative z-10" />
                )}

                {!isRecordingVideo && !isVideoPreviewActive && !videoBlobUrl && (
                  <div className="flex flex-col items-center text-stone-400 text-xs gap-2 p-4 text-center relative z-10">
                    <Video className="w-8 h-8 text-indigo-400" />
                    <span>
                      {cameraErrorMsg ||
                        (isEn ? 'Live Video Preview' : 'پیش‌نمایش زنده ویدیو هنگام فیلم‌برداری')}
                    </span>
                  </div>
                )}

                {isRecordingVideo ? (
                  <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold animate-pulse shadow-md">
                    <span className="w-2 h-2 rounded-full bg-white" />
                    <span>{isEn ? 'Recording Live' : 'در حال ضبط زنده'}</span>
                  </div>
                ) : (
                  isVideoPreviewActive && (
                    <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/65 border border-white/15 text-white text-[10px] font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{isEn ? 'Live Viewfinder Ready' : 'پیش‌نمایش زنده آماده ضبط'}</span>
                    </div>
                  )
                )}
              </div>

              <div className="flex items-center justify-center gap-2.5 flex-wrap">
                {!isRecordingVideo ? (
                  <>
                    {!isVideoPreviewActive && (
                      <button
                        type="button"
                        onClick={() => {
                          setVideoBlobUrl(null);
                          startVideoLivePreview(videoFacingMode, false);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold text-xs transition-all cursor-pointer"
                      >
                        <Camera className="w-4 h-4 text-indigo-400" />
                        <span>{isEn ? 'Open Live Preview' : 'باز کردن پیش‌نمایش زنده'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startVideoRecording()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>
                        {videoBlobUrl
                          ? (isEn ? 'Record New Video' : 'ضبط مجدد ویدیو')
                          : (isEn ? 'Start Video Recording' : 'شروع ضبط ویدیویی ایده')}
                      </span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={stopVideoRecording}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    <span>{isEn ? 'Stop Video Recording' : 'توقف و ذخیره ویدیو'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DRAWING / SKETCH CANVAS WITH SAMSUNG S PEN SUPPORT */}
          {activeTab === 'sketch' && (
            <div className="space-y-3">
              {/* Samsung S Pen / Stylus Status Banner */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-xs">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg flex items-center justify-center transition-colors ${
                    isStylusActive 
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-sm' 
                      : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                  }`}>
                    <PenTool className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-white">
                      <span>سیستم قلم هوشمند S Pen سامسونگ</span>
                      {isStylusActive ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500 text-stone-950 font-black animate-pulse">
                          S Pen فعال
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-800 text-stone-400 font-medium">
                          پشتیبانی از قلم و لمس
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-stone-400 block">
                      پشتیبانی از حساسیت فشار قلم (Pressure Sensitivity)، رد کف دست (Palm Rejection) و دکمه پاک‌کن
                    </span>
                  </div>
                </div>

                {/* S Pen Pressure Meter */}
                {isStylusActive && (
                  <div className="hidden sm:flex flex-col items-end gap-1">
                    <span className="text-[10px] text-stone-400">میزان فشار S Pen:</span>
                    <div className="w-20 h-1.5 bg-stone-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-sky-400 transition-all duration-75"
                        style={{ width: `${Math.round(currentPressure * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Mode & Tools Selector (Pen, Highlighter, Eraser) */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 bg-stone-900 p-1 rounded-xl border border-stone-800 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setPenMode('pen')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      penMode === 'pen'
                        ? 'bg-indigo-500 text-white font-bold shadow-sm'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>قلم S Pen</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPenMode('highlighter')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      penMode === 'highlighter'
                        ? 'bg-indigo-500 text-white font-bold shadow-sm'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>ماژیک هایلایت</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPenMode('eraser')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                      penMode === 'eraser'
                        ? 'bg-indigo-500 text-white font-bold shadow-sm'
                        : 'text-stone-400 hover:text-white'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>پاک‌کن</span>
                  </button>
                </div>

                {/* Color Palette (disabled in eraser mode) */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">رنگ:</span>
                  {['#818CF8', '#38bdf8', '#34d399', '#f87171', '#a855f7', '#ffffff'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={penMode === 'eraser'}
                      onClick={() => setPenColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        penColor === c && penMode !== 'eraser' ? 'scale-110 border-white' : 'border-transparent'
                      } ${penMode === 'eraser' ? 'opacity-40 cursor-not-allowed' : ''}`}
                      style={{ backgroundColor: c }}
                      title="انتخاب رنگ"
                    />
                  ))}
                </div>

                {/* Pen Size & Clear */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-400">ضخامت:</span>
                  <input
                    type="range"
                    min="1"
                    max="16"
                    value={penSize}
                    onChange={(e) => setPenSize(Number(e.target.value))}
                    className="w-20 accent-indigo-500 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="p-1.5 rounded-lg bg-stone-800 text-stone-400 hover:text-red-400 hover:bg-stone-700 text-xs transition-colors"
                    title="پاک کردن صفحه"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* S Pen Optimized HTML5 Canvas with Pointer Events */}
              <div className="relative border-2 border-stone-800 hover:border-stone-700 rounded-2xl overflow-hidden bg-stone-950 flex justify-center shadow-inner">
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={320}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  style={{ touchAction: 'none' }}
                  className="w-full h-64 cursor-crosshair touch-none select-none"
                />
              </div>
            </div>
          )}

          {/* Google Sync Option */}
          {googleToken && (
            <label className="flex items-center gap-2 pt-2 text-xs text-stone-300 cursor-pointer">
              <input
                type="checkbox"
                checked={syncWithGoogle}
                onChange={(e) => setSyncWithGoogle(e.target.checked)}
                className="rounded accent-indigo-500 w-4 h-4 cursor-pointer"
              />
              <span className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-sky-400" />
                {isEn ? 'Sync & Save to Google Tasks' : 'همگام‌سازی و ذخیره در Google Tasks'}
              </span>
            </label>
          )}
        </div>

        {/* Sticky Footer - Pinned directly above keyboard with min 48px buttons */}
        <div className="sticky bottom-0 z-20 shrink-0 px-3 sm:px-4 py-3 border-t border-stone-800 flex items-center justify-between bg-stone-900 shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] px-5 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-stone-300 hover:text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center border border-stone-700/60"
          >
            {isEn ? 'Cancel' : 'انصراف'}
          </button>
          <button
            id="save-idea-submit-btn"
            type="button"
            onClick={handleSave}
            className="btn-brand-submit min-h-[48px] flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all active:scale-95 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span className="font-black">
              {editingIdea 
                ? (isEn ? 'Save Changes' : 'ذخیره تغییرات') 
                : (isEn ? 'Save Idea' : 'ثبت ایده')}
            </span>
          </button>
        </div>
      </div>

      {/* Pop-up alert for missing required fields per user request */}
      <ValidationAlertModal
        isOpen={showValidationModal}
        onClose={() => setShowValidationModal(false)}
        title={isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری'}
        fieldName={isEn ? 'Idea Title' : 'عنوان ایده'}
        language={language}
      />
    </div>
  );
};
