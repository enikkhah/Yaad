import React, { useState, useEffect, useRef } from 'react';
import appIcon from '../assets/images/icon.png';
import { APP_VERSION } from '../utils/version';
import { toPersianDigits } from '../utils/jalali';
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
  totalDurationMs = 2000,
  fadeOutMs = 700,
  language = 'fa',
}) => {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const onStartExitRef = useRef(onStartExit);
  onStartExitRef.current = onStartExit;

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const isEn = language === 'en';

  useEffect(() => {
    // Start the fade out effect so that it completes at exactly 2 seconds (totalDurationMs)
    const fadeOutStartTime = Math.max(0, totalDurationMs - fadeOutMs);

    const exitTimer = setTimeout(() => {
      setIsFadingOut(true);
      if (onStartExitRef.current) {
        onStartExitRef.current();
      }
    }, fadeOutStartTime);

    // Complete splash screen and unmount at totalDurationMs (2 seconds)
    const finishTimer = setTimeout(() => {
      if (onFinishRef.current) {
        onFinishRef.current();
      }
    }, totalDurationMs);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(finishTimer);
    };
  }, [totalDurationMs, fadeOutMs]);

  const handleDismiss = () => {
    setIsFadingOut(true);
    if (onStartExitRef.current) onStartExitRef.current();
    if (onFinishRef.current) onFinishRef.current();
  };

  return (
    <div
      onClick={handleDismiss}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden transition-all ease-in-out p-4 ${
        isFadingOut ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{
        transitionDuration: `${fadeOutMs}ms`,
        background: 'radial-gradient(ellipse at 50% 50%, #0c1a32 0%, #060d1b 45%, #020612 100%)',
      }}
      title="YAAD"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Dynamic ambient radial lighting matching the icon palette */}
      <div
        className={`absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-blue-600/25 via-sky-500/20 to-amber-400/20 blur-3xl pointer-events-none transition-opacity ${
          isFadingOut ? 'opacity-0 duration-700' : 'opacity-100 duration-1000'
        }`}
      />

      {/* Main App Logo with smooth entrance and 2-second fade-out */}
      <div
        className={`relative flex flex-col items-center justify-center transition-all duration-700 ease-out transform ${
          isFadingOut ? 'opacity-0 scale-95 translate-y-1' : 'opacity-100 scale-100 translate-y-0'
        }`}
      >
        <div className="relative">
          {/* Subtle outer glow ring */}
          <div className="absolute -inset-1 rounded-[1.8rem] sm:rounded-[2.2rem] bg-gradient-to-tr from-blue-500/30 to-amber-400/30 blur-md opacity-75" />
          
          <img
            src={appIcon}
            alt="YAAD"
            className="relative w-28 h-28 sm:w-36 sm:h-36 md:w-40 md:h-40 object-contain rounded-[1.6rem] sm:rounded-[2rem] shadow-2xl drop-shadow-[0_12px_30px_rgba(15,55,160,0.55)] transition-transform duration-500 hover:scale-105"
            draggable={false}
          />
        </div>

        {/* Dynamic App Title and Project Version below the logo */}
        <div className="mt-4 sm:mt-5 flex flex-col items-center gap-1.5 text-center">
          <span className="text-base sm:text-lg font-black text-white tracking-wider drop-shadow-sm">
            {isEn ? 'YAAD' : 'یاد • YAAD'}
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs sm:text-sm font-bold shadow-sm">
            {isEn ? `v${APP_VERSION}` : `نسخه ${toPersianDigits(APP_VERSION)}`}
          </span>
        </div>
      </div>
    </div>
  );
};
