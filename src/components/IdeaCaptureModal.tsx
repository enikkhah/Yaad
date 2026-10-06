import React, { useState, useRef, useEffect } from 'react';
import { IdeaNote, Category } from '../types';
import { 
  Lightbulb, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  PenTool, 
  Trash2, 
  Save, 
  X, 
  Play, 
  Square, 
  Check, 
  Sparkles, 
  Cloud,
  FileText,
  Clock,
  RotateCcw,
  Smartphone,
  AlertCircle
} from 'lucide-react';
import { formatJalaliFull } from '../utils/jalali';
import { syncToGoogleTasks } from '../utils/googleSync';
import { ValidationAlertModal } from './ValidationAlertModal';
import { AppLanguage } from '../utils/i18n';
import { requestMicrophonePermission } from '../utils/nativePermissions';

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
  const [activeTab, setActiveTab] = useState<'text' | 'voice' | 'video' | 'sketch'>('text');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Virtual keyboard tracking: keeps footer button pinned directly above virtual keyboard
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
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
  const speechRecognitionRef = useRef<any>(null);
  const shouldKeepContentListeningRef = useRef<boolean>(false);
  const baseContentTextRef = useRef<string>('');
  const sessionFinalContentTextRef = useRef<string>('');
  const contentSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const contentSpeechStartTimeRef = useRef<number>(0);
  const contentLastSpeechTimeRef = useRef<number>(0);

  // Voice typing for title
  const [isTitleVoiceTyping, setIsTitleVoiceTyping] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'fa' | 'en'>(language === 'en' ? 'en' : 'fa');
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const titleSpeechRecognitionRef = useRef<any>(null);
  const shouldKeepTitleListeningRef = useRef<boolean>(false);
  const baseTitleTextRef = useRef<string>('');
  const sessionFinalTitleTextRef = useRef<string>('');
  const titleSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const titleSpeechStartTimeRef = useRef<number>(0);
  const titleLastSpeechTimeRef = useRef<number>(0);

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Video recording state
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const videoMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  // Drawing Canvas state with Samsung S Pen & Stylus Support
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [penColor, setPenColor] = useState('#f59e0b');
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
        setDrawingDataUrl(editingIdea.drawingDataUrl || null);
      } else {
        setTitle('');
        setContent('');
        setCategory('work');
        setAudioBlobUrl(null);
        setVideoBlobUrl(null);
        setDrawingDataUrl(null);
      }
      setIsVoiceTyping(false);
      setIsRecordingAudio(false);
      setIsRecordingVideo(false);
      setValidationError(null);
    }
  }, [isOpen, editingIdea]);

  // Clean up streams & speech on close
  useEffect(() => {
    if (!isOpen) {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      shouldKeepContentListeningRef.current = false;
      shouldKeepTitleListeningRef.current = false;
      if (contentSilenceTimerRef.current) clearTimeout(contentSilenceTimerRef.current);
      if (titleSilenceTimerRef.current) clearTimeout(titleSilenceTimerRef.current);
      setIsVoiceTyping(false);
      setIsTitleVoiceTyping(false);
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.abort(); } catch {}
        speechRecognitionRef.current = null;
      }
      if (titleSpeechRecognitionRef.current) {
        try { titleSpeechRecognitionRef.current.abort(); } catch {}
        titleSpeechRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current && isRecordingAudio) {
        mediaRecorderRef.current.stop();
      }
    }
  }, [isOpen]);

  // 0. VOICE TYPING FOR TITLE (تبدیل گفتار به متن برای عنوان ایده)
  const toggleTitleVoiceTyping = async (forcedLang?: 'fa' | 'en') => {
    setVoiceErrorMsg(null);
    if (isTitleVoiceTyping) {
      shouldKeepTitleListeningRef.current = false;
      if (titleSilenceTimerRef.current) {
        clearTimeout(titleSilenceTimerRef.current);
        titleSilenceTimerRef.current = null;
      }
      try {
        titleSpeechRecognitionRef.current?.abort();
      } catch {
        // Ignore
      }
      titleSpeechRecognitionRef.current = null;
      setIsTitleVoiceTyping(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceErrorMsg(isEn ? 'Speech recognition not supported on this device.' : 'تبدیل گفتار به متن در این دستگاه در دسترس نیست.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    const micGranted = await requestMicrophonePermission();
    if (!micGranted) {
      setVoiceErrorMsg(isEn ? 'Microphone permission denied.' : 'دسترسی به میکروفون مجاز نیست. لطفاً در تنظیمات دستگاه اجازه دسترسی دهید.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepTitleListeningRef.current = true;
      baseTitleTextRef.current = title.trim();
      sessionFinalTitleTextRef.current = '';
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
          try {
            titleSpeechRecognitionRef.current?.abort();
          } catch {
            // Ignore
          }
          titleSpeechRecognitionRef.current = null;
          setIsTitleVoiceTyping(false);
        }, durationMs);
      };

      resetTitleSilenceTimer(5000);

      const createAndRunTitleRec = () => {
        if (!shouldKeepTitleListeningRef.current) return;

        const now = Date.now();
        const refTime = titleLastSpeechTimeRef.current || titleSpeechStartTimeRef.current;
        if (now - refTime >= 4900) {
          shouldKeepTitleListeningRef.current = false;
          setIsTitleVoiceTyping(false);
          return;
        }

        try {
          const recognition = new SpeechRecognition();
          recognition.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          recognition.continuous = true;
          recognition.interimResults = true;

          recognition.onstart = () => {
            setIsTitleVoiceTyping(true);
          };

          recognition.onresult = (event: any) => {
            let currentFinal = '';
            let currentInterim = '';

            for (let i = 0; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                currentFinal += res[0].transcript + ' ';
              } else {
                currentInterim += res[0].transcript;
              }
            }

            sessionFinalTitleTextRef.current = currentFinal.trim();
            const speechPart = [sessionFinalTitleTextRef.current, currentInterim].filter(Boolean).join(' ').trim();
            const combined = [baseTitleTextRef.current, speechPart].filter(Boolean).join(' ').trim();

            if (combined) {
              titleLastSpeechTimeRef.current = Date.now();
              setTitle(combined);
            }

            resetTitleSilenceTimer(5000);
          };

          recognition.onerror = (e: any) => {
            if (e.error === 'no-speech') {
              const now = Date.now();
              const refTime = titleLastSpeechTimeRef.current || titleSpeechStartTimeRef.current;
              if (now - refTime >= 4800) {
                shouldKeepTitleListeningRef.current = false;
                setIsTitleVoiceTyping(false);
              }
              return;
            }
            if (e.error === 'not-allowed') {
              shouldKeepTitleListeningRef.current = false;
              setIsTitleVoiceTyping(false);
              return;
            }
          };

          recognition.onend = () => {
            if (!shouldKeepTitleListeningRef.current) {
              setIsTitleVoiceTyping(false);
              return;
            }

            const now = Date.now();
            const refTime = titleLastSpeechTimeRef.current || titleSpeechStartTimeRef.current;
            if (now - refTime >= 4800) {
              shouldKeepTitleListeningRef.current = false;
              setIsTitleVoiceTyping(false);
              return;
            }

            if (sessionFinalTitleTextRef.current) {
              baseTitleTextRef.current = [baseTitleTextRef.current, sessionFinalTitleTextRef.current].filter(Boolean).join(' ').trim();
              sessionFinalTitleTextRef.current = '';
            }

            setTimeout(() => {
              if (shouldKeepTitleListeningRef.current) {
                createAndRunTitleRec();
              }
            }, 80);
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
      try {
        speechRecognitionRef.current?.abort();
      } catch {
        // Ignore
      }
      speechRecognitionRef.current = null;
      setIsVoiceTyping(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceErrorMsg(isEn ? 'Speech recognition not supported on this device.' : 'تبدیل گفتار به متن در این دستگاه در دسترس نیست.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    const micGranted = await requestMicrophonePermission();
    if (!micGranted) {
      setVoiceErrorMsg(isEn ? 'Microphone permission denied.' : 'دسترسی به میکروفون مجاز نیست. لطفاً در تنظیمات دستگاه اجازه دسترسی دهید.');
      setTimeout(() => setVoiceErrorMsg(null), 4000);
      return;
    }

    try {
      const activeLang = forcedLang || voiceLang;
      shouldKeepContentListeningRef.current = true;
      baseContentTextRef.current = content.trim();
      sessionFinalContentTextRef.current = '';
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
          try {
            speechRecognitionRef.current?.abort();
          } catch {
            // Ignore
          }
          speechRecognitionRef.current = null;
          setIsVoiceTyping(false);
        }, durationMs);
      };

      resetContentSilenceTimer(5000);

      const createAndRunContentRec = () => {
        if (!shouldKeepContentListeningRef.current) return;

        const now = Date.now();
        const refTime = contentLastSpeechTimeRef.current || contentSpeechStartTimeRef.current;
        if (now - refTime >= 4900) {
          shouldKeepContentListeningRef.current = false;
          setIsVoiceTyping(false);
          return;
        }

        try {
          const recognition = new SpeechRecognition();
          recognition.lang = activeLang === 'en' ? 'en-US' : 'fa-IR';
          recognition.continuous = true;
          recognition.interimResults = true;

          recognition.onstart = () => {
            setIsVoiceTyping(true);
          };

          recognition.onresult = (event: any) => {
            let currentFinal = '';
            let currentInterim = '';

            for (let i = 0; i < event.results.length; ++i) {
              const res = event.results[i];
              if (res.isFinal) {
                currentFinal += res[0].transcript + ' ';
              } else {
                currentInterim += res[0].transcript;
              }
            }

            sessionFinalContentTextRef.current = currentFinal.trim();
            const speechPart = [sessionFinalContentTextRef.current, currentInterim].filter(Boolean).join(' ').trim();
            const combined = [baseContentTextRef.current, speechPart].filter(Boolean).join(' ').trim();

            if (combined) {
              contentLastSpeechTimeRef.current = Date.now();
              setContent(combined);
            }

            resetContentSilenceTimer(5000);
          };

          recognition.onerror = (e: any) => {
            if (e.error === 'no-speech') {
              const now = Date.now();
              const refTime = contentLastSpeechTimeRef.current || contentSpeechStartTimeRef.current;
              if (now - refTime >= 4800) {
                shouldKeepContentListeningRef.current = false;
                setIsVoiceTyping(false);
              }
              return;
            }
            if (e.error === 'not-allowed') {
              shouldKeepContentListeningRef.current = false;
              setIsVoiceTyping(false);
              return;
            }
          };

          recognition.onend = () => {
            if (!shouldKeepContentListeningRef.current) {
              setIsVoiceTyping(false);
              return;
            }

            const now = Date.now();
            const refTime = contentLastSpeechTimeRef.current || contentSpeechStartTimeRef.current;
            if (now - refTime >= 4800) {
              shouldKeepContentListeningRef.current = false;
              setIsVoiceTyping(false);
              return;
            }

            if (sessionFinalContentTextRef.current) {
              baseContentTextRef.current = [baseContentTextRef.current, sessionFinalContentTextRef.current].filter(Boolean).join(' ').trim();
              sessionFinalContentTextRef.current = '';
            }

            setTimeout(() => {
              if (shouldKeepContentListeningRef.current) {
                createAndRunContentRec();
              }
            }, 80);
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
      alert('دسترسی به میکروفون امکان‌پذیر نیست.');
    }
  };

  const stopAudioRecording = () => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
    }
  };

  // 3. VIDEO MEMO RECORDING
  const startVideoRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      videoStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play();
      }

      videoChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      videoMediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) videoChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const videoBlob = new Blob(videoChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(videoBlob);
        setVideoBlobUrl(url);
        stream.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      };

      recorder.start();
      setIsRecordingVideo(true);
    } catch (err) {
      alert('دسترسی به دوربین و میکروفون برای ضبط ویدیو امکان‌پذیر نشد.');
    }
  };

  const stopVideoRecording = () => {
    if (videoMediaRecorderRef.current && isRecordingVideo) {
      videoMediaRecorderRef.current.stop();
      setIsRecordingVideo(false);
    }
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
        drawingDataUrl: drawingDataUrl || undefined,
      });
    } else {
      onSaveIdea({
        title: finalTitle,
        content: content.trim(),
        category,
        audioRecordUrl: audioBlobUrl || undefined,
        videoRecordUrl: videoBlobUrl || undefined,
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
      style={{ height: viewportHeight ? `${viewportHeight}px` : '100dvh' }}
    >
      <div 
        id="idea-capture-modal-panel"
        className="w-full max-w-2xl bg-stone-900 border border-stone-800 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-150"
        style={{ maxHeight: viewportHeight ? `${viewportHeight}px` : '92dvh' }}
        dir={isEn ? 'ltr' : 'rtl'}
      >
        {/* Header */}
        <div className="px-2.5 sm:px-5 py-3.5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
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
        <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:p-5 space-y-4">
          {/* Required Field Validation Alert Banner */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Title & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-stone-300">
                  {isEn ? 'Idea Title' : 'عنوان ایده یا فکر'}
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = voiceLang === 'fa' ? 'en' : 'fa';
                      setVoiceLang(next);
                      if (isTitleVoiceTyping) {
                        toggleTitleVoiceTyping();
                        setTimeout(() => toggleTitleVoiceTyping(next), 100);
                      }
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                      voiceLang === 'fa'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                    }`}
                  >
                    {voiceLang === 'fa' ? 'فارسی' : 'English'}
                  </button>
                  <span className="text-[11px] text-stone-400">
                    {isTitleVoiceTyping ? (isEn ? 'Stops in 5s' : 'توقف با ۵ثانیه سکوت') : (isEn ? 'Type or speech' : 'تایپ یا صوت')}
                  </span>
                </div>
              </div>
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. Marketing campaign, Redesign idea...' : 'مثلاً: ایده راه‌اندازی کمپین بازاریابی، طراحی مجدد...'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={`w-full ${isEn ? 'pr-11 pl-3.5' : 'pl-11 pr-3.5'} py-2.5 rounded-xl bg-stone-950 border border-stone-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-stone-100 text-sm outline-none`}
                />
                <button
                  type="button"
                  onClick={() => toggleTitleVoiceTyping()}
                  className={`absolute ${isEn ? 'right-2' : 'left-2'} p-1.5 rounded-lg transition-all cursor-pointer ` + (isTitleVoiceTyping ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30' : 'text-stone-400 hover:text-amber-400 hover:bg-stone-800')}
                  title={isTitleVoiceTyping ? (isEn ? 'Stop voice typing' : 'توقف ضبط گفتار عنوان') : (isEn ? 'Voice input' : 'تایپ صوتی عنوان ایده')}
                >
                  {isTitleVoiceTyping ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              </div>
              {voiceErrorMsg && (
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-1.5 animate-in fade-in">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                  <span>{voiceErrorMsg}</span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-stone-300">
                {isEn ? 'Category' : 'دسته‌بندی'}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full px-3 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-sm focus:border-amber-500 outline-none"
              >
                <option value="work">{isEn ? 'Work' : 'کاری (Work)'}</option>
                <option value="family">{isEn ? 'Family' : 'خانواده (Family)'}</option>
                <option value="other">{isEn ? 'Personal / Other' : 'شخصی / سایر'}</option>
              </select>
            </div>
          </div>

          {/* Mode Switch Tabs */}
          <div className="flex bg-stone-950 p-1 rounded-xl border border-stone-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('text')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                activeTab === 'text' ? 'bg-amber-500 text-stone-950 font-bold' : 'text-stone-400 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>{isEn ? 'Text & Voice' : 'متن و تایپ صوتی'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('voice')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                activeTab === 'voice' ? 'bg-amber-500 text-stone-950 font-bold' : 'text-stone-400 hover:text-white'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>{isEn ? 'Voice Memo' : 'ضبط صدا'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('video')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                activeTab === 'video' ? 'bg-amber-500 text-stone-950 font-bold' : 'text-stone-400 hover:text-white'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>{isEn ? 'Video' : 'ضبط ویدیو'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sketch')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-medium transition-all cursor-pointer ${
                activeTab === 'sketch' ? 'bg-amber-500 text-stone-950 font-bold' : 'text-stone-400 hover:text-white'
              }`}
            >
              <PenTool className="w-4 h-4" />
              <span>{isEn ? 'Sketch' : 'رسم با قلم'}</span>
            </button>
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
                    onClick={() => {
                      const next = voiceLang === 'fa' ? 'en' : 'fa';
                      setVoiceLang(next);
                      if (isVoiceTyping) {
                        toggleVoiceTyping();
                        setTimeout(() => toggleVoiceTyping(next), 100);
                      }
                    }}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      voiceLang === 'fa'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                    }`}
                    title={isEn ? 'Toggle speech language' : 'تغییر زبان گفتار'}
                  >
                    {voiceLang === 'fa' ? 'زبان صوت: فارسی' : 'Voice: English'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleVoiceTyping()}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isVoiceTyping
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-stone-800 hover:bg-stone-700 text-stone-300'
                    }`}
                  >
                    {isVoiceTyping ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-amber-400" />}
                    <span>{isVoiceTyping ? (isEn ? 'Waiting (stops in 5s)' : 'منتظر صوت (خاموشی در ۵ ثانیه)') : (isEn ? 'Voice Typing' : 'شروع تایپ صوتی')}</span>
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={isEn ? 'Write your thoughts, goals, or details here, or tap voice typing...' : 'افکار، اهداف یا جزئیات ایده‌تان را اینجا بنویسید یا دکمه تایپ صوتی را لمس کنید...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-800 text-stone-100 text-sm focus:border-amber-500 outline-none leading-relaxed"
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
                  className="flex items-center gap-2 px-5 py-3 rounded-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-sm animate-pulse shadow-lg"
                >
                  <Square className="w-4 h-4 fill-stone-950" />
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

          {/* TAB 3: VIDEO RECORDING */}
          {activeTab === 'video' && (
            <div className="p-4 rounded-xl bg-stone-950 border border-stone-800 flex flex-col items-center justify-center space-y-3">
              <div className="w-full max-w-sm aspect-video bg-stone-900 rounded-xl overflow-hidden border border-stone-800 relative flex items-center justify-center">
                {isRecordingVideo ? (
                  <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                ) : videoBlobUrl ? (
                  <video src={videoBlobUrl} controls className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-stone-500 text-xs">
                    <Video className="w-8 h-8 mb-1" />
                    <span>پیش‌نمایش ویدیو</span>
                  </div>
                )}

                {isRecordingVideo && (
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-white" />
                    <span>در حال ضبط</span>
                  </div>
                )}
              </div>

              {!isRecordingVideo ? (
                <button
                  type="button"
                  onClick={startVideoRecording}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-stone-950 font-bold text-xs shadow-md"
                >
                  <Video className="w-4 h-4" />
                  <span>شروع ضبط ویدیویی ایده</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopVideoRecording}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white font-bold text-xs"
                >
                  <Square className="w-4 h-4" />
                  <span>توقف ضبط ویدیو</span>
                </button>
              )}
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
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
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
                        ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
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
                        ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
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
                        ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
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
                  {['#f59e0b', '#38bdf8', '#34d399', '#f87171', '#a855f7', '#ffffff'].map((c) => (
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
                    className="w-20 accent-amber-500 cursor-pointer"
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
                className="rounded accent-amber-500 w-4 h-4 cursor-pointer"
              />
              <span className="flex items-center gap-1.5">
                <Cloud className="w-4 h-4 text-sky-400" />
                {isEn ? 'Sync & Save to Google Tasks' : 'همگام‌سازی و ذخیره در Google Tasks'}
              </span>
            </label>
          )}
        </div>

        {/* Sticky Footer - Pinned directly above keyboard */}
        <div className="sticky bottom-0 z-20 shrink-0 px-2.5 sm:px-5 py-3 border-t border-stone-800 flex items-center justify-between bg-stone-900/95 backdrop-blur shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-stone-400 hover:text-white text-xs font-medium cursor-pointer"
          >
            {isEn ? 'Cancel' : 'انصراف'}
          </button>
          <button
            id="save-idea-submit-btn"
            type="button"
            onClick={handleSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer ${
              !title.trim()
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                : 'bg-stone-950 border-2 border-yellow-400 text-yellow-300 font-black shadow-lg shadow-yellow-500/20'
            }`}
          >
            <Save className={`w-4 h-4 ${!title.trim() ? 'text-amber-300' : 'text-yellow-300'}`} />
            <span className={!title.trim() ? 'text-amber-300 font-bold' : 'text-yellow-300 font-black'}>
              {editingIdea 
                ? (isEn ? 'Save Changes' : 'ذخیره تغییرات ایده') 
                : (isEn ? 'Save Idea' : 'ثبت نهایی ایده')}
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
