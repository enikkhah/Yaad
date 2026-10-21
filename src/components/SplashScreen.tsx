import React, { useState, useEffect, useRef } from 'react';
import { APP_VERSION } from '../utils/version';
import { AppLanguage } from '../utils/i18n';
import transparentLogo from '../assets/images/logo-transparent.png';

interface SplashScreenProps {
  onStartExit?: () => void;
  onFinish?: () => void;
  totalDurationMs?: number;
  fadeOutMs?: number;
  language?: AppLanguage;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onStartExit,
  onFinish,
  totalDurationMs = 2400,
  fadeOutMs = 500,
  language = 'fa',
}) => {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const onStartExitRef = useRef(onStartExit);
  onStartExitRef.current = onStartExit;

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const isEn = language === 'en';

  useEffect(() => {
    // Maximum 2.5 seconds (2500ms) per user requirement
    const safeDuration = Math.min(totalDurationMs, 2500);
    const fadeOutStartTime = Math.max(0, safeDuration - fadeOutMs);

    const exitTimer = setTimeout(() => {
      setIsFadingOut(true);
      if (onStartExitRef.current) {
        onStartExitRef.current();
      }
    }, fadeOutStartTime);

    const finishTimer = setTimeout(() => {
      if (onFinishRef.current) {
        onFinishRef.current();
      }
    }, safeDuration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(finishTimer);
    };
  }, [totalDurationMs, fadeOutMs]);

  const handleDismiss = () => {
    setIsFadingOut(true);
    if (onStartExitRef.current) onStartExitRef.current();
    setTimeout(() => {
      if (onFinishRef.current) onFinishRef.current();
    }, 250);
  };

  return (
    <div
      onClick={handleDismiss}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden transition-opacity ease-in-out p-4 ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        transitionDuration: `${fadeOutMs}ms`,
        background: 'radial-gradient(ellipse at 50% 48%, #0f2140 0%, #071124 48%, #020612 100%)',
        willChange: 'opacity',
      }}
      title="YAAD"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <style>{`
        @keyframes splashPinDropAndGlow {
          0% {
            opacity: 0;
            transform: translate3d(0, -34px, 0) scale(0.48);
            filter: drop-shadow(0 0 0px rgba(246, 165, 47, 0));
          }
          42% {
            opacity: 1;
            transform: translate3d(0, 5px, 0) scale(1.04);
            filter: drop-shadow(0 6px 26px rgba(246, 165, 47, 0.58));
          }
          68% {
            opacity: 1;
            transform: translate3d(0, -4px, 0) scale(0.98);
            filter: drop-shadow(0 8px 22px rgba(246, 165, 47, 0.48));
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0px, 0) scale(1.05);
            filter: drop-shadow(0 10px 34px rgba(246, 165, 47, 0.72));
          }
        }
        @keyframes splashRadarRing {
          0% {
            opacity: 0.65;
            transform: scale(0.55);
          }
          100% {
            opacity: 0;
            transform: scale(1.9);
          }
        }
        @keyframes splashTitleReveal {
          0% {
            opacity: 0;
            transform: translate3d(0, 10px, 0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }
        .animate-splash-pin {
          will-change: transform, opacity, filter;
          animation: splashPinDropAndGlow 1.85s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .animate-splash-radar-1 {
          will-change: transform, opacity;
          animation: splashRadarRing 1.75s cubic-bezier(0.22, 1, 0.36, 1) 0.28s infinite;
        }
        .animate-splash-radar-2 {
          will-change: transform, opacity;
          animation: splashRadarRing 1.75s cubic-bezier(0.22, 1, 0.36, 1) 0.72s infinite;
        }
        .animate-splash-meta {
          will-change: transform, opacity;
          animation: splashTitleReveal 0.85s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
        }
      `}</style>

      {/* Ambient radial lighting without any dark box */}
      <div
        className={`absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-blue-600/20 via-sky-500/15 to-amber-400/25 blur-3xl pointer-events-none transition-opacity ease-in-out ${
          isFadingOut ? 'opacity-0 duration-500' : 'opacity-100 duration-700'
        }`}
      />

      {/* Transparent New Logo (No background box) with Smooth Pin Drop & Radar Pulse Animation */}
      <div className="relative flex flex-col items-center justify-center">
        <div className="relative flex items-center justify-center w-36 h-36 sm:w-44 sm:h-44">
          {/* App-themed Location & Time Radar Ripple Rings */}
          <div className="absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 border-amber-400/40 pointer-events-none animate-splash-radar-1" />
          <div className="absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full border border-sky-400/35 pointer-events-none animate-splash-radar-2" />

          {/* New Resized Transparent Icon Image */}
          <img
            src={transparentLogo}
            alt="YAAD"
            className="relative w-32 h-32 sm:w-40 sm:h-40 object-contain select-none pointer-events-none animate-splash-pin"
            draggable={false}
          />
        </div>

        {/* App Title and English Version Badge (Dimensions and font unchanged) */}
        <div className="mt-3 sm:mt-4 flex flex-col items-center gap-1.5 text-center animate-splash-meta">
          <span className="text-base sm:text-lg font-black text-white tracking-wider drop-shadow-sm">
            {isEn ? 'YAAD' : 'یاد • YAAD'}
          </span>
          <span
            dir="ltr"
            className="inline-flex items-center gap-1 px-3.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-400/35 text-indigo-200 font-mono text-xs sm:text-sm font-bold shadow-sm tracking-wide"
          >
            Version {APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
};
