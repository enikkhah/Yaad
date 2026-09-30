import React from 'react';

interface SevenSegmentDigitProps {
  digit: string;
  className?: string;
  color?: string;
  inactiveColor?: string;
}

// 7-segment definitions (a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left, g=middle)
const SEGMENTS_MAP: Record<string, string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'd', 'e', 'g'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['b', 'c', 'f', 'g'],
  '5': ['a', 'c', 'd', 'f', 'g'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

export const SevenSegmentDigit: React.FC<SevenSegmentDigitProps> = ({
  digit,
  className = 'w-5 h-9 sm:w-6 sm:h-11 md:w-7 md:h-12',
  color = 'currentColor', // inherits from parent or CSS 4 color
  inactiveColor = '#292524', // stone-800 faint ghost segment
}) => {
  const activeSegments = new Set(SEGMENTS_MAP[digit] || []);

  const getFill = (seg: string) => (activeSegments.has(seg) ? color : inactiveColor);
  const getFilter = (seg: string) =>
    activeSegments.has(seg) ? 'drop-shadow(0px 0px 2px currentColor)' : undefined;

  return (
    <svg
      viewBox="0 0 28 48"
      className={`${className} shrink-0 select-none transition-all duration-100`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* a - Top */}
      <polygon
        points="5,3 23,3 20,6 8,6"
        fill={getFill('a')}
        style={{ filter: getFilter('a') }}
      />
      {/* b - Top Right */}
      <polygon
        points="25,4 25,22 22,20 22,7"
        fill={getFill('b')}
        style={{ filter: getFilter('b') }}
      />
      {/* c - Bottom Right */}
      <polygon
        points="25,26 25,44 22,41 22,28"
        fill={getFill('c')}
        style={{ filter: getFilter('c') }}
      />
      {/* d - Bottom */}
      <polygon
        points="5,45 23,45 20,42 8,42"
        fill={getFill('d')}
        style={{ filter: getFilter('d') }}
      />
      {/* e - Bottom Left */}
      <polygon
        points="3,26 3,44 6,41 6,28"
        fill={getFill('e')}
        style={{ filter: getFilter('e') }}
      />
      {/* f - Top Left */}
      <polygon
        points="3,4 3,22 6,20 6,7"
        fill={getFill('f')}
        style={{ filter: getFilter('f') }}
      />
      {/* g - Middle */}
      <polygon
        points="6,24 8,22 20,22 22,24 20,26 8,26"
        fill={getFill('g')}
        style={{ filter: getFilter('g') }}
      />
    </svg>
  );
};

interface SevenSegmentClockProps {
  hours: number | string;
  minutes: number | string;
  seconds?: number | string;
  size?: 'md' | 'lg' | 'xl';
}

export const SevenSegmentClock: React.FC<SevenSegmentClockProps> = ({
  hours,
  minutes,
  seconds,
  size = 'lg',
}) => {
  const hStr = hours.toString().padStart(2, '0');
  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds !== undefined ? seconds.toString().padStart(2, '0') : undefined;

  const digitClass =
    size === 'xl'
      ? 'w-6 h-11 sm:w-7 sm:h-13 md:w-8 md:h-15'
      : size === 'lg'
      ? 'w-5 h-9 sm:w-6 sm:h-11 md:w-6.5 md:h-12'
      : 'w-4 h-7 sm:w-5 sm:h-9';

  const secDigitClass =
    size === 'xl'
      ? 'w-4.5 h-8 sm:w-5 sm:h-9 md:w-6 md:h-11'
      : size === 'lg'
      ? 'w-3.5 h-6.5 sm:w-4.5 sm:h-8 md:w-5 md:h-9'
      : 'w-3 h-5 sm:w-3.5 sm:h-6';

  return (
    <div
      dir="ltr"
      style={{ color: '#d21ccf' }}
      className="inline-flex items-center gap-1 sm:gap-1.5 bg-stone-950/95 border border-amber-500/40 rounded-2xl px-3 py-1.5 sm:px-4 sm:py-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8),0_0_15px_rgba(245,158,11,0.2)]"
    >
      {/* Hours */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        <SevenSegmentDigit digit={hStr[0]} className={digitClass} />
        <SevenSegmentDigit digit={hStr[1]} className={digitClass} />
      </div>

      {/* Pulsing Colon */}
      <div className="flex flex-col gap-1.5 sm:gap-2 px-0.5 sm:px-1">
        <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-current animate-pulse shadow-[0_0_6px_currentColor]" />
        <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-current animate-pulse shadow-[0_0_6px_currentColor]" />
      </div>

      {/* Minutes */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        <SevenSegmentDigit digit={mStr[0]} className={digitClass} />
        <SevenSegmentDigit digit={mStr[1]} className={digitClass} />
      </div>

      {/* Seconds (if provided) */}
      {sStr !== undefined && (
        <>
          <div className="flex flex-col gap-1 sm:gap-1.5 px-0.5 opacity-70">
            <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-current" />
            <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-current" />
          </div>
          <div className="flex items-center gap-0.5 opacity-90">
            <SevenSegmentDigit digit={sStr[0]} className={secDigitClass} color="currentColor" />
            <SevenSegmentDigit digit={sStr[1]} className={secDigitClass} color="currentColor" />
          </div>
        </>
      )}
    </div>
  );
};
