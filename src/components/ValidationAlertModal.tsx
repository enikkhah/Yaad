import React, { useEffect, useState, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ValidationAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  fieldName?: string;
  durationMs?: number;
  language?: 'fa' | 'en';
}

/**
 * Fading Popup Alert (کادر اخطار محوشونده)
 * The entire card stays visible for 3 seconds, then smoothly fades out completely and closes.
 */
export const ValidationAlertModal: React.FC<ValidationAlertModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  fieldName,
  durationMs = 3000,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const defaultTitle = isEn ? 'Required Field Missing' : 'تکمیل فیلد اجباری';
  const displayTitle = title || defaultTitle;
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [progress, setProgress] = useState(100);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) {
      setIsFadingOut(false);
      setProgress(100);
      return;
    }

    setIsFadingOut(false);
    setProgress(100);

    const startTime = Date.now();
    const fadeOutDelay = Math.max(1000, durationMs - 400);

    // Smooth countdown progress bar
    const progressInterval = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingPct = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remainingPct);
    }, 30);

    // Trigger smooth fade-out transition for the ENTIRE card
    const fadeTimer = window.setTimeout(() => {
      setIsFadingOut(true);
    }, fadeOutDelay);

    // Trigger complete unmount after 3 seconds
    const closeTimer = window.setTimeout(() => {
      clearInterval(progressInterval);
      onCloseRef.current();
    }, durationMs);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(fadeTimer);
      clearTimeout(closeTimer);
    };
  }, [isOpen, durationMs]);

  if (!isOpen) return null;

  const handleManualClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFadingOut(true);
    setTimeout(() => {
      onCloseRef.current();
    }, 200);
  };

  return (
    <div 
      className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[300] w-[92%] max-w-md pointer-events-none select-none"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Entire box container fades out smoothly as a whole */}
      <div
        onClick={handleManualClose}
        className={`pointer-events-auto relative overflow-hidden rounded-2xl bg-stone-900 border-2 border-amber-500 shadow-2xl shadow-amber-950/80 backdrop-blur-md cursor-pointer transition-all duration-400 ease-in-out transform ${
          isFadingOut
            ? 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
            : 'opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-top-4'
        }`}
        style={{
          boxShadow: isFadingOut ? 'none' : '0 10px 30px -5px rgba(245, 158, 11, 0.35)',
        }}
      >
        {/* Ambient background glow */}
        <div className={`absolute top-0 ${isEn ? 'left-0' : 'right-0'} w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none`} />

        <div className="relative p-3.5 sm:p-4 flex items-start gap-3">
          {/* Solid warning icon */}
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-400 flex items-center justify-center flex-shrink-0 shadow-md shadow-amber-500/15">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>

          {/* Alert Content */}
          <div className="flex-1 min-w-0 pr-0.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs sm:text-sm font-black text-amber-300">
                {displayTitle}
              </h4>
              <span className="text-[10px] text-amber-400/90 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                {isEn ? 'Auto-dismiss' : 'محو خودکار'}
              </span>
            </div>

            <p className="mt-1 text-xs text-stone-200 leading-relaxed font-medium">
              {message ? (
                message
              ) : fieldName ? (
                isEn ? (
                  <>
                    Required field <strong className="text-amber-400 font-bold underline decoration-amber-500/60">"{fieldName}"</strong> cannot be empty. Please fill it in.
                  </>
                ) : (
                  <>
                    فیلد اجباری <strong className="text-amber-400 font-bold underline decoration-amber-500/60">«{fieldName}»</strong> پر نشده است. لطفاً آن را وارد فرمایید.
                  </>
                )
              ) : (
                isEn ? 'Please complete the required fields.' : 'لطفاً فیلدهای اجباری مشخص‌شده را تکمیل فرمایید.'
              )}
            </p>
          </div>

          {/* Quick Manual Dismiss Button */}
          <button
            type="button"
            onClick={handleManualClose}
            className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800/80 transition-colors flex-shrink-0 cursor-pointer"
            title={isEn ? 'Close' : 'بستن'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3-Second Fading Progress Countdown Bar */}
        <div className="w-full bg-stone-800 h-1">
          <div
            className="h-full bg-gradient-to-l from-amber-400 to-amber-500 transition-all duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};
