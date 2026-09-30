import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, Keyboard } from 'lucide-react';

interface WheelPickerProps {
  items: Array<{ value: number; label: string }>;
  selectedValue: number;
  onChange: (value: number) => void;
  label?: string;
  itemHeight?: number;
  visibleCount?: number;
  min?: number;
  max?: number;
}

export const WheelPicker: React.FC<WheelPickerProps> = ({
  items,
  selectedValue,
  onChange,
  label,
  itemHeight = 88,
  visibleCount = 3,
  min = 0,
  max = 59,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);
  const isProgrammaticScrollRef = useRef(false);
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [typedInput, setTypedInput] = useState(selectedValue.toString().padStart(2, '0'));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedIndex = items.findIndex((item) => item.value === selectedValue);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;

  // Scroll to index with high precision
  const scrollToIndex = useCallback(
    (index: number, smooth = true) => {
      const el = containerRef.current;
      if (!el) return;
      isProgrammaticScrollRef.current = true;
      const targetScrollTop = index * itemHeight;

      if (smooth) {
        el.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      } else {
        el.scrollTop = targetScrollTop;
      }

      // Reset programmatic flag after smooth transition completes
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, smooth ? 250 : 20);
    },
    [itemHeight]
  );

  // Sync scroll position when selectedValue changes externally
  useEffect(() => {
    if (!isScrollingRef.current && !isTypingMode) {
      scrollToIndex(currentIndex, false);
    }
  }, [currentIndex, isTypingMode, scrollToIndex]);

  // Focus input when typing mode enabled
  useEffect(() => {
    if (isTypingMode) {
      setTypedInput(selectedValue.toString().padStart(2, '0'));
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isTypingMode, selectedValue]);

  // Handle user rolling / scrolling with active tracking and smooth snap
  const handleScroll = () => {
    if (isProgrammaticScrollRef.current) return;

    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    const el = containerRef.current;
    if (el) {
      const scrollTop = el.scrollTop;
      const nearestIndex = Math.round(scrollTop / itemHeight);
      const clampedIndex = Math.max(0, Math.min(items.length - 1, nearestIndex));
      if (items[clampedIndex] && items[clampedIndex].value !== selectedValue) {
        onChange(items[clampedIndex].value);
      }
    }

    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      const currentEl = containerRef.current;
      if (!currentEl) return;

      const scrollTop = currentEl.scrollTop;
      const targetIndex = Math.round(scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(items.length - 1, targetIndex));

      if (items[clamped] && items[clamped].value !== selectedValue) {
        onChange(items[clamped].value);
      }
      scrollToIndex(clamped, true);
    }, 100);
  };

  const handleStep = (direction: 'up' | 'down') => {
    let nextIdx = currentIndex + (direction === 'up' ? -1 : 1);
    if (nextIdx < 0) nextIdx = items.length - 1;
    if (nextIdx >= items.length) nextIdx = 0;
    onChange(items[nextIdx].value);
    scrollToIndex(nextIdx, true);
  };

  // Submit typed number
  const handleTypedSubmit = () => {
    const parsed = parseInt(typedInput, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
      const newIdx = items.findIndex((it) => it.value === clamped);
      if (newIdx >= 0) {
        setTimeout(() => scrollToIndex(newIdx, false), 50);
      }
    }
    setIsTypingMode(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTypedSubmit();
    } else if (e.key === 'Escape') {
      setIsTypingMode(false);
    }
  };

  const totalHeight = itemHeight * visibleCount;
  const paddingY = itemHeight * Math.floor(visibleCount / 2);

  return (
    <div className="flex flex-col items-center select-none w-full px-0 mx-0">
      {/* Header Label and Quick Type Button */}
      <div className="w-full flex items-center justify-between px-1 mb-1.5">
        {label && (
          <span className="text-xs sm:text-sm font-bold text-stone-200">{label}</span>
        )}
        <button
          type="button"
          onClick={() => {
            if (isTypingMode) {
              handleTypedSubmit();
            } else {
              setIsTypingMode(true);
            }
          }}
          className={`p-1 rounded-lg text-xs flex items-center gap-1 transition-all cursor-pointer ${
            isTypingMode
              ? 'bg-teal-500/20 text-teal-300 font-bold border border-teal-500/30'
              : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
          }`}
          title="تایپ مستقیم عدد"
        >
          <Keyboard className="w-3.5 h-3.5" />
          <span className="text-[10px] hidden sm:inline">
            {isTypingMode ? 'بستن' : 'تایپ'}
          </span>
        </button>
      </div>

      {/* Up Button */}
      <button
        type="button"
        onClick={() => handleStep('up')}
        className="w-full py-2.5 flex items-center justify-center text-teal-300 hover:text-white active:scale-95 transition-colors rounded-t-2xl bg-stone-900 hover:bg-stone-800 border-t border-x border-teal-500/30 shadow-sm"
      >
        <ChevronUp className="w-5 h-5" />
      </button>

      {/* Main Wheel Cylinder Area */}
      <div 
        onDoubleClick={() => setIsTypingMode(true)}
        className="relative w-full overflow-hidden bg-stone-950 border-x border-teal-500/30 shadow-inner group cursor-pointer"
      >
        {/* Top Fade Gradient */}
        <div className="absolute top-0 inset-x-0 h-10 bg-gradient-to-b from-stone-950 via-stone-950/70 to-transparent pointer-events-none z-10" />

        {/* Center Target Selection Highlight Bar */}
        <div
          className="absolute inset-x-0 border-y border-teal-500/40 bg-teal-500/10 pointer-events-none z-0"
          style={{
            top: paddingY,
            height: itemHeight,
          }}
        />

        {/* Direct typing overlay input: No checkmark button, auto-submits on blur or clicking outside */}
        {isTypingMode ? (
          <div 
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-stone-950/95 backdrop-blur-md p-2"
            onClick={handleTypedSubmit}
          >
            <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="number"
                min={min}
                max={max}
                value={typedInput}
                onChange={(e) => {
                  setTypedInput(e.target.value);
                  const parsed = parseInt(e.target.value, 10);
                  if (!isNaN(parsed) && parsed >= min && parsed <= max) {
                    onChange(parsed);
                  }
                }}
                onBlur={handleTypedSubmit}
                onKeyDown={handleKeyDown}
                className="w-24 sm:w-28 text-center py-1.5 text-5xl sm:text-6xl font-mono font-black text-white bg-stone-900 border-2 border-teal-500 rounded-2xl focus:outline-none leading-none shadow-lg shadow-teal-500/20"
              />
            </div>
          </div>
        ) : null}

        {/* Scrollable List with Smooth Rolling and Large Top/Bottom Numbers */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            height: totalHeight,
            paddingTop: paddingY,
            paddingBottom: paddingY,
            scrollSnapType: 'y mandatory',
            scrollBehavior: 'smooth',
          }}
          className="overflow-y-auto no-scrollbar relative w-full touch-pan-y"
        >
          {items.map((item, idx) => {
            const isSelected = item.value === selectedValue;
            const diff = Math.abs(idx - currentIndex);
            
            // Scaled so numbers above and below are visibly large (طلب کاربر: اعداد بالا و پایین در رول فونت بزرگتری داشته باشند)
            // Center is dominant (text-6xl/7xl), adjacent numbers are text-4xl/5xl
            const scale = isSelected ? 1 : Math.max(0.85, 1 - diff * 0.12);
            const opacity = isSelected ? 1 : Math.max(0.4, 0.75 - diff * 0.25);

            return (
              <div
                key={item.value}
                onClick={() => {
                  onChange(item.value);
                  scrollToIndex(idx, true);
                }}
                style={{
                  height: itemHeight,
                  scrollSnapAlign: 'center',
                  transform: `scale(${scale})`,
                  opacity,
                }}
                className={`flex items-center justify-center cursor-pointer transition-all duration-150 font-mono tracking-tight select-none w-full ${
                  isSelected
                    ? 'text-white font-black text-6xl sm:text-7xl md:text-8xl leading-none drop-shadow-md'
                    : 'text-stone-300 font-extrabold text-4xl sm:text-5xl hover:text-white'
                }`}
              >
                {/* 2-digit format */}
                {item.label}
              </div>
            );
          })}
        </div>

        {/* Bottom Fade Gradient */}
        <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-stone-950 via-stone-950/70 to-transparent pointer-events-none z-10" />
      </div>

      {/* Down Button */}
      <button
        type="button"
        onClick={() => handleStep('down')}
        className="w-full py-2.5 flex items-center justify-center text-teal-300 hover:text-white active:scale-95 transition-colors rounded-b-2xl bg-stone-900 hover:bg-stone-800 border-b border-x border-teal-500/30 shadow-sm"
      >
        <ChevronDown className="w-5 h-5" />
      </button>
    </div>
  );
};
