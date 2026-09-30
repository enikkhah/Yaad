import React from 'react';

interface NixieTubeProps {
  digit: string;
  size?: 'sm' | 'md' | 'lg';
}

export const NixieTube: React.FC<NixieTubeProps> = ({ digit, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-7 h-12 text-xl',
    md: 'w-8 sm:w-10 md:w-11 h-14 sm:h-17 md:h-19 text-2xl sm:text-3xl md:text-4xl',
    lg: 'w-10 sm:w-12 md:w-14 h-18 sm:h-21 md:h-24 text-3xl sm:text-4xl md:text-5xl',
  }[size];

  return (
    <div className="flex flex-col items-center">
      {/* Glass Vacuum Tube Cylinder with Nixie Gas Discharge Glow */}
      <div
        className={`relative ${sizeClasses} rounded-t-2xl rounded-b-md flex items-center justify-center overflow-hidden select-none border border-amber-600/40 shadow-[0_0_15px_rgba(255,100,0,0.35),inset_0_0_12px_rgba(255,80,0,0.25)]`}
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, #1e0901 0%, #100400 70%, #080200 100%)',
        }}
      >
        {/* Subtle Anode Metal Mesh / Grid inside tube */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255,180,100,0.4) 1px, transparent 1px)',
            backgroundSize: '4px 4px',
          }}
        />

        {/* Faint unlit filament wire ghost (the iconic Nixie stacked cathode look) */}
        <span
          className="absolute font-mono font-bold text-amber-950/30 select-none pointer-events-none transform scale-95"
          style={{
            filter: 'blur(0.5px)',
          }}
          aria-hidden="true"
        >
          8
        </span>

        {/* Active Energized Neon Filament Digit */}
        <span
          className="relative z-10 font-mono font-black tracking-tight"
          style={{
            color: '#fff5ea',
            textShadow: `
              0 0 2px #fff3cc,
              0 0 5px #ffb300,
              0 0 10px #ff6600,
              0 0 18px #ff3700,
              0 0 28px #e62200,
              0 0 40px rgba(255, 50, 0, 0.7)
            `,
          }}
        >
          {digit}
        </span>

        {/* Glass reflection highlight on left curvature */}
        <div
          className="absolute inset-y-0 left-0 w-1.5 sm:w-2 pointer-events-none opacity-40 rounded-tl-2xl"
          style={{
            background:
              'linear-gradient(to right, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 60%, transparent 100%)',
          }}
        />

        {/* Glass dome top highlight */}
        <div
          className="absolute top-0 inset-x-1.5 h-1.5 sm:h-2 pointer-events-none opacity-30 rounded-t-full"
          style={{
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.7) 0%, transparent 80%)',
          }}
        />

        {/* Internal gas discharge orange ionization haze */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25 mix-blend-screen"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(255,102,0,0.8) 0%, rgba(255,51,0,0.3) 60%, transparent 100%)',
          }}
        />
      </div>

      {/* Brass / Copper Tube Base Collar */}
      <div className="w-[108%] h-2 sm:h-2.5 bg-gradient-to-r from-amber-900 via-amber-600 to-amber-950 rounded-b-md border-t border-amber-500/60 shadow-[0_2px_4px_rgba(0,0,0,0.9)] -mt-0.5 z-10" />
    </div>
  );
};

interface NixieColonProps {
  size?: 'sm' | 'md' | 'lg';
}

export const NixieColon: React.FC<NixieColonProps> = ({ size = 'md' }) => {
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : size === 'lg' ? 'w-2.5 h-2.5' : 'w-2 h-2';

  return (
    <div className="flex flex-col items-center justify-center gap-2 sm:gap-2.5 px-1 sm:px-1.5 select-none self-center">
      <div
        className={`${dotSize} rounded-full bg-amber-200 animate-pulse`}
        style={{
          boxShadow: `
            0 0 3px #fff,
            0 0 6px #ff9900,
            0 0 12px #ff4400,
            0 0 20px rgba(255, 60, 0, 0.8)
          `,
        }}
      />
      <div
        className={`${dotSize} rounded-full bg-amber-200 animate-pulse`}
        style={{
          boxShadow: `
            0 0 3px #fff,
            0 0 6px #ff9900,
            0 0 12px #ff4400,
            0 0 20px rgba(255, 60, 0, 0.8)
          `,
        }}
      />
    </div>
  );
};

interface NixieClockProps {
  hours: number | string;
  minutes: number | string;
  seconds?: number | string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const NixieClock: React.FC<NixieClockProps> = ({
  hours,
  minutes,
  seconds,
  size = 'md',
  className = '',
}) => {
  const hStr = hours.toString().padStart(2, '0');
  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds !== undefined ? seconds.toString().padStart(2, '0') : undefined;

  return (
    <div
      dir="ltr"
      className={`inline-flex items-center gap-1 sm:gap-1.5 p-2 sm:p-2.5 rounded-2xl bg-black/95 border-2 border-stone-800/90 shadow-[inset_0_4px_12px_rgba(0,0,0,0.9),0_0_20px_rgba(255,80,0,0.2)] ${className}`}
    >
      {/* Hours Tubes */}
      <div className="flex items-center gap-1">
        <NixieTube digit={hStr[0]} size={size} />
        <NixieTube digit={hStr[1]} size={size} />
      </div>

      {/* Nixie Neon Colon */}
      <NixieColon size={size} />

      {/* Minutes Tubes */}
      <div className="flex items-center gap-1">
        <NixieTube digit={mStr[0]} size={size} />
        <NixieTube digit={mStr[1]} size={size} />
      </div>

      {/* Seconds Tubes (optional / if provided) */}
      {sStr !== undefined && (
        <>
          <NixieColon size={size} />
          <div className="flex items-center gap-1">
            <NixieTube digit={sStr[0]} size={size === 'lg' ? 'md' : size} />
            <NixieTube digit={sStr[1]} size={size === 'lg' ? 'md' : size} />
          </div>
        </>
      )}
    </div>
  );
};
