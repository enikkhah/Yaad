import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, X, RefreshCw, Check, Smartphone, AlertCircle } from 'lucide-react';
import {
  openAndroidSettings,
  ensureNativeAndroidCameraPermission,
  markPermissionGranted,
} from '../utils/nativePermissions';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const attachStreamToVideoEl = useCallback((el: HTMLVideoElement | null, mediaStream: MediaStream | null) => {
    if (!el || !mediaStream) return;
    try {
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      if (el.srcObject !== mediaStream) {
        el.srcObject = mediaStream;
      }
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
      requestAnimationFrame(() => {
        if (el.srcObject === mediaStream && el.paused) {
          el.play().catch(() => {});
        }
      });
    } catch {
      // Ignore play race conditions
    }
  }, []);

  const setVideoElementRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node && streamRef.current) {
        attachStreamToVideoEl(node, streamRef.current);
      }
    },
    [attachStreamToVideoEl]
  );

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setErrorMsg(null);
    try {
      await ensureNativeAndroidCameraPermission(false);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('دوربین در این مرورگر پشتیبانی نمی‌شود');
      }

      let mediaStream: MediaStream | null = null;
      const constraintCandidates: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { exact: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        {
          video: { facingMode },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];

      for (const constraints of constraintCandidates) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
          if (mediaStream) break;
        } catch {
          // Try next fallback constraint
        }
      }

      if (!mediaStream) {
        throw new Error('Camera stream unavailable');
      }

      markPermissionGranted('camera');
      streamRef.current = mediaStream;
      if (videoRef.current) {
        attachStreamToVideoEl(videoRef.current, mediaStream);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setErrorMsg('دسترسی به دوربین ممکن نشد. لطفاً مجوز دسترسی به دوربین را تأیید کنید یا از آپلود فایل استفاده نمایید.');
    }
  }, [facingMode, stopCamera, attachStreamToVideoEl]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCapturedPhoto(null);
      setErrorMsg(null);
      return;
    }

    if (!capturedPhoto) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode, capturedPhoto, startCamera, stopCamera]);

  const toggleFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const takeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || video.clientWidth || 640;
    canvas.height = video.videoHeight || video.clientHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedPhoto(dataUrl);
    stopCamera();
  };

  const handleConfirm = () => {
    if (capturedPhoto) {
      onCapture(capturedPhoto);
      onClose();
    }
  };

  const retake = () => {
    setCapturedPhoto(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Camera className="w-5 h-5 text-indigo-400" />
            <span>عکسبرداری برای یادآور</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-stone-400 hover:text-white hover:bg-stone-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder or Preview */}
        <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
          {errorMsg ? (
            <div className="p-6 text-center text-rose-400 text-sm space-y-3 flex flex-col items-center justify-center">
              <div className="flex items-center gap-2 text-rose-300">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                <span className="font-bold">{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => openAndroidSettings('camera')}
                className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                <span>تنظیمات مجوز دوربین اندروید</span>
              </button>
            </div>
          ) : capturedPhoto ? (
            <img
              src={capturedPhoto}
              alt="عکس گرفته شده"
              className="w-full h-full object-cover"
            />
          ) : (
            <>
              <video
                ref={setVideoElementRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(e) => {
                  e.currentTarget.play().catch(() => {});
                }}
                onCanPlay={(e) => {
                  e.currentTarget.play().catch(() => {});
                }}
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />
              {/* Reticle guide */}
              <div className="absolute inset-8 border border-white/20 rounded-2xl pointer-events-none" />
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Controls */}
        <div className="p-4 bg-stone-950 flex items-center justify-between">
          {!capturedPhoto ? (
            <>
              <button
                type="button"
                onClick={toggleFacing}
                className="p-3 rounded-full bg-stone-800 text-stone-300 hover:text-white hover:bg-stone-700"
                title="تغییر دوربین جلو/عقب"
              >
                <RefreshCw className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={takeSnapshot}
                disabled={!!errorMsg}
                className="flex items-center justify-center w-16 h-16 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/40 font-bold active:scale-95 transition-transform"
                title="ثبت عکس"
              >
                <Camera className="w-7 h-7 text-white" />
              </button>

              <div className="w-11" />
            </>
          ) : (
            <div className="flex items-center justify-between w-full gap-3">
              <button
                type="button"
                onClick={retake}
                className="flex-1 py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium transition-colors"
              >
                عکس مجدد
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-colors shadow-lg shadow-indigo-600/30 cursor-pointer"
              >
                <Check className="w-4 h-4 text-white stroke-[2.5]" />
                <span className="text-white font-bold">تأیید و ضمیمه</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
