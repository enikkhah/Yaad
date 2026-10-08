import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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

const CYCLE_COUNT = 7;
const MID_CYCLE = 3;

export const WheelPicker: React.FC<WheelPickerProps> = ({
  items,
  selectedValue,
  onChange,
  label,
  itemHeight = 76,
  visibleCount = 3,
  min = 0,
  max = 59,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isScrollingRef = useRef(false);
  const scrollDebounceTimerRef = useRef<any>(null);
  const isProgrammaticScrollRef = useRef(false);
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [typedInput, setTypedInput] = useState(selectedValue.toString().padStart(2, '0'));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const itemCount = items.length;

  // Generate cyclical repeated items for seamless infinite wheel rolling
  const repeatedItems = useMemo(() => {
    const list: Array<{
      key: string;
      value: number;
      label: string;
      originalIndex: number;
      globalIndex: number;
    }> = [];

    for (let c = 0; c < CYCLE_COUNT; c++) {
      for (let i = 0; i < itemCount; i++) {
        list.push({
          key: `${c}-${items[i].value}`,
          value: items[i].value,
          label: items[i].label,
          originalIndex: i,
          globalIndex: c * itemCount + i,
        });
      }
    }
    return list;
  }, [items, itemCount]);

  // Find index in items for the currently selected value
  const selectedOriginalIndex = useMemo(() => {
    const idx = items.findIndex((it) => it.value === selectedValue);
    return idx >= 0 ? idx : 0;
  }, [items, selectedValue]);

  // Scroll to a specific global index in the repeated list
  const scrollToGlobalIndex = useCallback(
    (globalIdx: number, smooth = true) => {
      const el = containerRef.current;
      if (!el) return;
      isProgrammaticScrollRef.current = true;
      const targetScrollTop = globalIdx * itemHeight;

      if (smooth) {
        el.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      } else {
        el.scrollTop = targetScrollTop;
      }

      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, smooth ? 260 : 20);
    },
    [itemHeight]
  );

  // Center scroll on selectedValue upon mount or when changed externally
  useEffect(() => {
    if (!isScrollingRef.current && !isTypingMode) {
      const targetGlobalIndex = MID_CYCLE * itemCount + selectedOriginalIndex;
      scrollToGlobalIndex(targetGlobalIndex, false);
    }
  }, [selectedOriginalIndex, itemCount, isTypingMode, scrollToGlobalIndex]);

  // Handle typing mode autofocus
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

  // Rolling / scrolling handler with cyclical wrap
  const handleScroll = () => {
    if (isProgrammaticScrollRef.current) return;

    isScrollingRef.current = true;
    if (scrollDebounceTimerRef.current) {
      clearTimeout(scrollDebounceTimerRef.current);
    }

    const el = containerRef.current;
    if (el) {
      const scrollTop = el.scrollTop;
      const nearestGlobalIndex = Math.round(scrollTop / itemHeight);
      const wrappedIndex = ((nearestGlobalIndex % itemCount) + itemCount) % itemCount;
      const targetItem = items[wrappedIndex];

      if (targetItem && targetItem.value !== selectedValue) {
        onChange(targetItem.value);
      }
    }

    // When scrolling stops, snap to exact item and silently normalize to center cycle if near edges
    scrollDebounceTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      const currentEl = containerRef.current;
      if (!currentEl) return;

      const scrollTop = currentEl.scrollTop;
      const nearestGlobalIndex = Math.round(scrollTop / itemHeight);
      const wrappedIndex = ((nearestGlobalIndex % itemCount) + itemCount) % itemCount;
      const targetItem = items[wrappedIndex];

      if (targetItem && targetItem.value !== selectedValue) {
        onChange(targetItem.value);
      }

      // If user has scrolled far up into cycle 0 or far down into cycle 6, silently re-center
      if (nearestGlobalIndex < 2 * itemCount || nearestGlobalIndex >= 5 * itemCount) {
        const normalizedIndex = MID_CYCLE * itemCount + wrappedIndex;
        isProgrammaticScrollRef.current = true;
        currentEl.scrollTop = normalizedIndex * itemHeight;
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 30);
      } else {
        // Snap smoothly to nearest index
        scrollToGlobalIndex(nearestGlobalIndex, true);
      }
    }, 120);
  };

  // Step up (previous number) or down (next number) with seamless circular wrap
  const handleStep = (direction: 'up' | 'down') => {
    const el = containerRef.current;
    const currentScrollTop = el ? el.scrollTop : (MID_CYCLE * itemCount + selectedOriginalIndex) * itemHeight;
    const currentGlobalIndex = Math.round(currentScrollTop / itemHeight);
    
    const delta = direction === 'up' ? -1 : 1;
    const nextGlobalIndex = currentGlobalIndex + delta;
    const nextWrappedIndex = ((nextGlobalIndex % itemCount) + itemCount) % itemCount;
    const nextItem = items[nextWrappedIndex];

    if (nextItem) {
      onChange(nextItem.value);
      scrollToGlobalIndex(nextGlobalIndex, true);
    }
  };

  // Submit direct typed number
  const handleTypedSubmit = () => {
    const parsed = parseInt(typedInput, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
      const newOrigIdx = items.findIndex((it) => it.value === clamped);
      if (newOrigIdx >= 0) {
        const targetGlobalIdx = MID_CYCLE * itemCount + newOrigIdx;
        setTimeout(() => scrollToGlobalIndex(targetGlobalIdx, false), 40);
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
          title="تایپ مستقیم عدد با کیبورد"
        >
          <Keyboard className="w-3.5 h-3.5" />
          <span className="text-[10px] hidden sm:inline">
            {isTypingMode ? 'بستن' : 'تایپ'}
          </span>
        </button>
      </div>

      {/* Up Button - Steps to previous number (e.g. 00 -> 23 or 00 -> 59 seamlessly) */}
      <button
        type="button"
        onClick={() => handleStep('up')}
        className="w-full py-2.5 flex items-center justify-center text-teal-300 hover:text-white active:scale-95 transition-colors rounded-t-2xl bg-stone-900 hover:bg-stone-800 border-t border-x border-teal-500/30 shadow-sm cursor-pointer"
        aria-label="عدد قبلی"
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

        {/* Direct typing overlay input: auto-submits on blur or clicking outside */}
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

        {/* Scrollable List with Smooth Infinite Looped Rolling */}
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
          {repeatedItems.map((item) => {
            const isSelected = item.value === selectedValue;

            return (
              <div
                key={item.key}
                onClick={() => {
                  onChange(item.value);
                  scrollToGlobalIndex(item.globalIndex, true);
                }}
                style={{
                  height: itemHeight,
                  scrollSnapAlign: 'center',
                }}
                className={`flex items-center justify-center cursor-pointer transition-all duration-150 font-mono tracking-tight select-none w-full ${
                  isSelected
                    ? 'text-white font-black text-5xl sm:text-6xl md:text-7xl leading-none drop-shadow-md scale-100 opacity-100'
                    : 'text-stone-400 hover:text-stone-200 font-extrabold text-3xl sm:text-4xl scale-90 opacity-60'
                }`}
              >
                {item.label}
              </div>
            );
          })}
        </div>

        {/* Bottom Fade Gradient */}
        <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-stone-950 via-stone-950/70 to-transparent pointer-events-none z-10" />
      </div>

      {/* Down Button - Steps to next number (e.g. 23 -> 00 or 59 -> 00 seamlessly) */}
      <button
        type="button"
        onClick={() => handleStep('down')}
        className="w-full py-2.5 flex items-center justify-center text-teal-300 hover:text-white active:scale-95 transition-colors rounded-b-2xl bg-stone-900 hover:bg-stone-800 border-b border-x border-teal-500/30 shadow-sm cursor-pointer"
        aria-label="عدد بعدی"
      >
        <ChevronDown className="w-5 h-5" />
      </button>
    </div>
  );
};
