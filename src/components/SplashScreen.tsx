import React, { useState, useEffect, useRef } from 'react';
import { APP_VERSION } from '../utils/version';
import { AppLanguage } from '../utils/i18n';

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
  totalDurationMs = 1950,
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
    const safeDuration = Math.min(totalDurationMs, 2000);
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
        @keyframes splashLogoZoomInSmooth {
          0% {
            opacity: 0;
            transform: scale(0.45) translate3d(0, 10px, 0);
            filter: drop-shadow(0 0 0px rgba(245, 166, 35, 0));
          }
          45% {
            opacity: 1;
            transform: scale(1.0) translate3d(0, 0px, 0);
            filter: drop-shadow(0 0 24px rgba(245, 166, 35, 0.5));
          }
          100% {
            opacity: 1;
            transform: scale(1.08) translate3d(0, -2px, 0);
            filter: drop-shadow(0 0 34px rgba(245, 166, 35, 0.68));
          }
        }
        @keyframes splashClockHandSweep {
          0% {
            transform: rotate(-135deg);
          }
          65% {
            transform: rotate(4deg);
          }
          100% {
            transform: rotate(0deg);
          }
        }
        @keyframes splashRadarRing {
          0% {
            opacity: 0.6;
            transform: scale(0.6);
          }
          100% {
            opacity: 0;
            transform: scale(1.85);
          }
        }
        .animate-splash-zoom-in {
          will-change: transform, opacity, filter;
          animation: splashLogoZoomInSmooth 1.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .animate-splash-hand {
          transform-origin: 100px 82px;
          will-change: transform;
          animation: splashClockHandSweep 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both;
        }
        .animate-splash-radar-1 {
          will-change: transform, opacity;
          animation: splashRadarRing 1.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s infinite;
        }
        .animate-splash-radar-2 {
          will-change: transform, opacity;
          animation: splashRadarRing 1.5s cubic-bezier(0.22, 1, 0.36, 1) 0.5s infinite;
        }
      `}</style>

      {/* Ambient radial lighting without any dark box */}
      <div
        className={`absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-blue-600/20 via-sky-500/15 to-amber-400/25 blur-3xl pointer-events-none transition-opacity ease-in-out ${
          isFadingOut ? 'opacity-0 duration-500' : 'opacity-100 duration-700'
        }`}
      />

      {/* Transparent Animated Logo (No black background box) with Smooth Zoom-In effect */}
      <div className="relative flex flex-col items-center justify-center animate-splash-zoom-in">
        <div className="relative flex items-center justify-center w-32 h-32 sm:w-40 sm:h-40">
          {/* App-themed Location & Time Radar Ripple Rings */}
          <div className="absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 border-amber-400/40 pointer-events-none animate-splash-radar-1" />
          <div className="absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full border border-sky-400/35 pointer-events-none animate-splash-radar-2" />

          {/* Pure Transparent Vector Logo: Location Pin + Animated Clock Hands */}
          <svg
            viewBox="0 0 200 200"
            className="relative w-28 h-28 sm:w-36 sm:h-36 overflow-visible"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Location Pin Outline */}
            <path
              d="M100 24C64.6538 24 36 52.6538 36 88C36 128.5 100 180 100 180C100 180 164 128.5 164 88C164 52.6538 135.346 24 100 24Z"
              stroke="#F5A623"
              strokeWidth="17"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Fixed 12-o'clock Hour Hand */}
            <line
              x1="100"
              y1="82"
              x2="100"
              y2="52"
              stroke="#F5A623"
              strokeWidth="16"
              strokeLinecap="round"
            />
            {/* Sweeping Minute Hand (animates clockwise to 4 o'clock) */}
            <g className="animate-splash-hand">
              <line
                x1="100"
                y1="82"
                x2="126"
                y2="98"
                stroke="#F5A623"
                strokeWidth="16"
                strokeLinecap="round"
              />
            </g>
            {/* Center Clock Pivot Dot */}
            <circle cx="100" cy="82" r="8" fill="#F5A623" />
          </svg>
        </div>

        {/* App Title and English Version Badge */}
        <div className="mt-3 sm:mt-4 flex flex-col items-center gap-1.5 text-center">
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
