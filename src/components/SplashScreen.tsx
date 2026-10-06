import React, { useState, useEffect, useRef } from 'react';
import { APP_VERSION } from '../utils/version';
import { toPersianDigits } from '../utils/jalali';
import { AppLanguage } from '../utils/i18n';

interface SplashScreenProps {
  onStartExit?: () => void;
  onFinish?: () => void;
  matteDelayMs?: number;
  logoDisplayMs?: number;
  fadeOutMs?: number;
  language?: AppLanguage;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onStartExit,
  onFinish,
  matteDelayMs = 0,
  logoDisplayMs = 1400,
  fadeOutMs = 350,
  language = 'fa',
}) => {
  const isEn = language === 'en';
  const [containerOpacity, setContainerOpacity] = useState<'opacity-100' | 'opacity-0'>('opacity-100');
  const [logoVisible, setLogoVisible] = useState(true);

  const onStartExitRef = useRef(onStartExit);
  onStartExitRef.current = onStartExit;

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    // Display glowing splash branding for ~1400ms, then trigger fade-out
    const exitStartTime = matteDelayMs + logoDisplayMs;
    const exitTimer = setTimeout(() => {
      setContainerOpacity('opacity-0');
      setLogoVisible(false);
      if (onStartExitRef.current) {
        onStartExitRef.current();
      }
    }, exitStartTime);

    // Complete and unmount splash screen after fade-out finishes
    const totalDuration = exitStartTime + fadeOutMs;
    const finishTimer = setTimeout(() => {
      if (onFinishRef.current) {
        onFinishRef.current();
      }
    }, totalDuration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(finishTimer);
    };
  }, [matteDelayMs, logoDisplayMs, fadeOutMs]);

  const handleDismiss = () => {
    if (onStartExitRef.current) onStartExitRef.current();
    if (onFinishRef.current) onFinishRef.current();
  };

  return (
    <div
      onClick={handleDismiss}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-stone-950 text-white cursor-pointer select-none transition-opacity ease-in-out ${containerOpacity}`}
      style={{
        transitionDuration: `${fadeOutMs}ms`,
        background: 'radial-gradient(ellipse at 50% 45%, #1c1917 0%, #0c0a09 60%, #000000 100%)',
      }}
      title={isEn ? 'Tap to enter quickly' : 'برای ورود سریع لمس کنید'}
    >
      {/* Ambient background glow */}
      <div 
        className={`absolute w-80 h-80 rounded-full bg-amber-500/20 blur-3xl pointer-events-none transition-opacity duration-500 ${
          logoVisible ? 'opacity-100' : 'opacity-0'
        }`} 
      />

      {/* Centered Glowing Branding without the first square icon */}
      <div
        className={`relative flex flex-col items-center transition-all duration-300 ease-out transform ${
          logoVisible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1'
        }`}
      >
        {/* App Title "YAAD" with luminous glowing text */}
        <h1
          className="text-5xl sm:text-6xl font-black tracking-widest text-amber-300 font-sans"
          style={{
            textShadow: '0 0 25px rgba(245, 158, 11, 0.7), 0 0 50px rgba(245, 158, 11, 0.4), 0 2px 10px rgba(0,0,0,0.9)',
          }}
        >
          YAAD
        </h1>

        {/* Subtitle */}
        <p className="mt-2 text-xs sm:text-sm text-stone-300 font-bold tracking-wide">
          {isEn ? 'Smart Reminder & Time Assistant' : 'یادآور هوشمند و دستیار زمان'}
        </p>

        {/* App Version under YAAD logo per user request */}
        <div className="mt-2.5 px-3 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono font-bold tracking-wider shadow-sm">
          {isEn ? `v${APP_VERSION}` : `نسخه ${toPersianDigits(APP_VERSION)} (v${APP_VERSION})`}
        </div>

        {/* Luminous Pulsing Indicator */}
        <div className="mt-8 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping opacity-85 shadow-[0_0_10px_#f59e0b]" />
          <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
          <span className="w-2 h-2 rounded-full bg-amber-500/70" />
        </div>
      </div>
    </div>
  );
};
