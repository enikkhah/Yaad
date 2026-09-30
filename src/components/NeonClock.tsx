import React from 'react';

interface NeonClockProps {
  hours: number | string;
  minutes: number | string;
  seconds?: number | string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  color?: 'amber' | 'cyan' | 'magenta' | 'green';
  className?: string;
}

export const NeonClock: React.FC<NeonClockProps> = ({
  hours,
  minutes,
  seconds,
  size = 'md',
  color = 'amber',
  className = '',
}) => {
  const hStr = hours.toString().padStart(2, '0');
  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds !== undefined ? seconds.toString().padStart(2, '0') : undefined;

  // Neon theme color definitions with intense multi-layer tube glow
  const colorMap = {
    amber: {
      textCore: '#fffdf5',
      primaryGlow: '#ffb703',
      outerGlow: '#fb8500',
      borderGlow: 'rgba(251, 133, 0, 0.4)',
      boxShadow: '0 0 25px rgba(255, 183, 3, 0.25), inset 0 0 15px rgba(251, 133, 0, 0.15)',
      colonGlow: '0 0 4px #fff, 0 0 10px #ffb703, 0 0 20px #fb8500',
      textShadow: `
        0 0 2px #ffffff,
        0 0 5px #ffffff,
        0 0 10px #ffb703,
        0 0 20px #ffb703,
        0 0 35px #fb8500,
        0 0 55px #fb8500,
        0 0 75px #d90429
      `,
      secShadow: `
        0 0 2px #ffffff,
        0 0 6px #ffb703,
        0 0 14px #fb8500,
        0 0 25px #fb8500
      `,
    },
    cyan: {
      textCore: '#f0feff',
      primaryGlow: '#00f5d4',
      outerGlow: '#00bbf9',
      borderGlow: 'rgba(0, 245, 212, 0.4)',
      boxShadow: '0 0 25px rgba(0, 245, 212, 0.25), inset 0 0 15px rgba(0, 187, 249, 0.15)',
      colonGlow: '0 0 4px #fff, 0 0 10px #00f5d4, 0 0 20px #00bbf9',
      textShadow: `
        0 0 2px #ffffff,
        0 0 5px #ffffff,
        0 0 10px #00f5d4,
        0 0 20px #00f5d4,
        0 0 35px #00bbf9,
        0 0 55px #00bbf9,
        0 0 75px #0077b6
      `,
      secShadow: `
        0 0 2px #ffffff,
        0 0 6px #00f5d4,
        0 0 14px #00bbf9,
        0 0 25px #00bbf9
      `,
    },
    magenta: {
      textCore: '#fff5fb',
      primaryGlow: '#f72585',
      outerGlow: '#b5179e',
      borderGlow: 'rgba(247, 37, 133, 0.4)',
      boxShadow: '0 0 25px rgba(247, 37, 133, 0.25), inset 0 0 15px rgba(181, 23, 158, 0.15)',
      colonGlow: '0 0 4px #fff, 0 0 10px #f72585, 0 0 20px #b5179e',
      textShadow: `
        0 0 2px #ffffff,
        0 0 5px #ffffff,
        0 0 10px #f72585,
        0 0 20px #f72585,
        0 0 35px #b5179e,
        0 0 55px #7209b7,
        0 0 75px #4361ee
      `,
      secShadow: `
        0 0 2px #ffffff,
        0 0 6px #f72585,
        0 0 14px #b5179e,
        0 0 25px #7209b7
      `,
    },
    green: {
      textCore: '#f5fff7',
      primaryGlow: '#06d6a0',
      outerGlow: '#05b583',
      borderGlow: 'rgba(6, 214, 160, 0.4)',
      boxShadow: '0 0 25px rgba(6, 214, 160, 0.25), inset 0 0 15px rgba(5, 181, 131, 0.15)',
      colonGlow: '0 0 4px #fff, 0 0 10px #06d6a0, 0 0 20px #05b583',
      textShadow: `
        0 0 2px #ffffff,
        0 0 5px #ffffff,
        0 0 10px #06d6a0,
        0 0 20px #06d6a0,
        0 0 35px #05b583,
        0 0 55px #05b583,
        0 0 75px #048a64
      `,
      secShadow: `
        0 0 2px #ffffff,
        0 0 6px #06d6a0,
        0 0 14px #05b583,
        0 0 25px #05b583
      `,
    },
  }[color];

  const sizeClasses = {
    xs: {
      wrap: 'px-2 sm:px-2.5 py-1 rounded-lg',
      mainText: 'text-base sm:text-lg',
      secText: 'text-xs sm:text-sm',
      dot: 'w-1 h-1',
    },
    sm: {
      wrap: 'px-3 py-1.5 rounded-xl',
      mainText: 'text-xl sm:text-2xl',
      secText: 'text-sm sm:text-base',
      dot: 'w-1 h-1 sm:w-1.5 sm:h-1.5',
    },
    md: {
      wrap: 'px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-2xl',
      mainText: 'text-2xl sm:text-3xl md:text-4xl',
      secText: 'text-base sm:text-lg md:text-xl',
      dot: 'w-1.5 h-1.5 sm:w-2 sm:h-2',
    },
    lg: {
      wrap: 'px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-3xl',
      mainText: 'text-3xl sm:text-4xl md:text-5xl',
      secText: 'text-lg sm:text-xl md:text-2xl',
      dot: 'w-2 h-2 sm:w-2.5 sm:h-2.5',
    },
  }[size];

  return (
    <div
      dir="ltr"
      className={`relative inline-flex items-center gap-1.5 sm:gap-2.5 select-none bg-stone-950/95 border border-amber-500/30 overflow-hidden font-mono tracking-wider tabular-nums ${sizeClasses.wrap} ${className}`}
      style={{
        boxShadow: colorMap.boxShadow,
        borderColor: colorMap.borderGlow,
      }}
    >
      {/* Acrylic Glass Plate reflections & Neon Tube glow ambiance */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20 mix-blend-screen"
        style={{
          background: `radial-gradient(ellipse at 50% 50%, ${colorMap.primaryGlow} 0%, transparent 80%)`,
        }}
      />
      <div 
        className="absolute top-0 inset-x-0 h-1/2 pointer-events-none opacity-10"
        style={{
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.7) 0%, transparent 100%)',
        }}
      />

      {/* HOURS - Neon Glowing Glass Tube Digits */}
      <div className="relative flex items-center">
        <span
          className={`font-black ${sizeClasses.mainText} transition-all duration-75`}
          style={{
            color: colorMap.textCore,
            textShadow: colorMap.textShadow,
          }}
        >
          {hStr}
        </span>
      </div>

      {/* NEON PULSING COLON */}
      <div className="flex flex-col gap-1.5 sm:gap-2 px-0.5 sm:px-1 self-center">
        <span
          className={`${sizeClasses.dot} rounded-full bg-white animate-pulse`}
          style={{
            boxShadow: colorMap.colonGlow,
          }}
        />
        <span
          className={`${sizeClasses.dot} rounded-full bg-white animate-pulse`}
          style={{
            boxShadow: colorMap.colonGlow,
          }}
        />
      </div>

      {/* MINUTES - Neon Glowing Glass Tube Digits */}
      <div className="relative flex items-center">
        <span
          className={`font-black ${sizeClasses.mainText} transition-all duration-75`}
          style={{
            color: colorMap.textCore,
            textShadow: colorMap.textShadow,
          }}
        >
          {mStr}
        </span>
      </div>

      {/* SECONDS (if available) - Neon tube glow */}
      {sStr !== undefined && (
        <>
          <div className="flex flex-col gap-1 sm:gap-1.5 px-0.5 self-center opacity-80">
            <span
              className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-white"
              style={{ boxShadow: colorMap.colonGlow }}
            />
            <span
              className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-white"
              style={{ boxShadow: colorMap.colonGlow }}
            />
          </div>
          <div className="relative flex items-center">
            <span
              className={`font-black ${sizeClasses.secText} transition-all duration-75 opacity-95`}
              style={{
                color: colorMap.textCore,
                textShadow: colorMap.secShadow,
              }}
            >
              {sStr}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
