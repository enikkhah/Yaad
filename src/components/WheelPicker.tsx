import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Keyboard } from 'lucide-react';

interface WheelPickerProps {
  items?: Array<{ value: number; label: string }>;
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
  const programmaticTimerRef = useRef<any>(null);
  const hasInitializedScrollRef = useRef(false);
  const lastEmittedValueRef = useRef<number>(selectedValue);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [isTypingMode, setIsTypingMode] = useState(false);
  const [typedInput, setTypedInput] = useState(selectedValue.toString().padStart(2, '0'));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const itemsSignature = items && items.length > 0 ? `${items.length}:${items[0].value}:${items[items.length - 1].value}` : '';

  const effectiveItems = useMemo(() => {
    if (items && items.length > 0) return items;
    const count = Math.max(1, max - min + 1);
    return Array.from({ length: count }, (_, i) => {
      const val = min + i;
      return {
        value: val,
        label: val.toString().padStart(2, '0'),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSignature, min, max]);

  const itemCount = effectiveItems.length;

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
          key: `${c}-${effectiveItems[i].value}`,
          value: effectiveItems[i].value,
          label: effectiveItems[i].label,
          originalIndex: i,
          globalIndex: c * itemCount + i,
        });
      }
    }
    return list;
  }, [effectiveItems, itemCount]);

  // Find index in items for the currently selected value
  const selectedOriginalIndex = useMemo(() => {
    const idx = effectiveItems.findIndex((it) => it.value === selectedValue);
    return idx >= 0 ? idx : 0;
  }, [effectiveItems, selectedValue]);

  // Scroll to a specific global index in the repeated list
  const scrollToGlobalIndex = useCallback(
    (globalIdx: number, smooth = true) => {
      const el = containerRef.current;
      if (!el) return;
      isProgrammaticScrollRef.current = true;
      if (programmaticTimerRef.current) {
        clearTimeout(programmaticTimerRef.current);
      }
      const targetScrollTop = globalIdx * itemHeight;

      if (smooth) {
        el.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      } else {
        el.scrollTop = targetScrollTop;
      }

      programmaticTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, smooth ? 280 : 50);
    },
    [itemHeight]
  );

  // Center scroll on selectedValue upon mount or when changed externally (e.g. +2m / +5m preset or editing reminder)
  useEffect(() => {
    if (isTypingMode) return;
    const isInitial = !hasInitializedScrollRef.current;
    const isExternalChange = selectedValue !== lastEmittedValueRef.current;

    if (isInitial || (!isScrollingRef.current && isExternalChange)) {
      hasInitializedScrollRef.current = true;
      lastEmittedValueRef.current = selectedValue;
      const targetGlobalIndex = MID_CYCLE * itemCount + selectedOriginalIndex;
      scrollToGlobalIndex(targetGlobalIndex, false);
      // Double-check after layout paint to guarantee exact centering inside modals
      const rafId = requestAnimationFrame(() => {
        if (!isScrollingRef.current && containerRef.current) {
          isProgrammaticScrollRef.current = true;
          containerRef.current.scrollTop = targetGlobalIndex * itemHeight;
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 40);
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [selectedValue, selectedOriginalIndex, itemCount, itemHeight, isTypingMode, scrollToGlobalIndex]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (scrollDebounceTimerRef.current) clearTimeout(scrollDebounceTimerRef.current);
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    };
  }, []);

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
      const targetItem = effectiveItems[wrappedIndex];

      if (targetItem && targetItem.value !== lastEmittedValueRef.current) {
        lastEmittedValueRef.current = targetItem.value;
        onChangeRef.current(targetItem.value);
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
      const targetItem = effectiveItems[wrappedIndex];

      if (targetItem && targetItem.value !== lastEmittedValueRef.current) {
        lastEmittedValueRef.current = targetItem.value;
        onChangeRef.current(targetItem.value);
      }

      // If user has scrolled far up into cycle 0/1 or far down into cycle 5/6, silently re-center
      if (nearestGlobalIndex < 2 * itemCount || nearestGlobalIndex >= 5 * itemCount) {
        const normalizedIndex = MID_CYCLE * itemCount + wrappedIndex;
        scrollToGlobalIndex(normalizedIndex, false);
      } else {
        const exactTop = nearestGlobalIndex * itemHeight;
        if (Math.abs(currentEl.scrollTop - exactTop) > 1) {
          scrollToGlobalIndex(nearestGlobalIndex, true);
        }
      }
    }, 110);
  };

  // Submit direct typed number
  const handleTypedSubmit = () => {
    const parsed = parseInt(typedInput, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      lastEmittedValueRef.current = clamped;
      onChangeRef.current(clamped);
      const newOrigIdx = effectiveItems.findIndex((it) => it.value === clamped);
      if (newOrigIdx >= 0) {
        const targetGlobalIdx = MID_CYCLE * itemCount + newOrigIdx;
        setTimeout(() => scrollToGlobalIndex(targetGlobalIdx, false), 30);
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

  const totalHeight = Math.round(itemHeight * visibleCount);
  const paddingY = Math.max(0, Math.round((totalHeight - itemHeight) / 2));

  return (
    <div className="flex flex-col items-center select-none w-full px-0 mx-0">
      {/* Header Label and Quick Type Button (only rendered if label is explicitly provided) */}
      {label ? (
        <div className="w-full flex items-center justify-between px-1 mb-1.5">
          <span className="text-xs sm:text-sm font-bold text-stone-200">{label}</span>
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
      ) : null}

      {/* Main Wheel Cylinder Area (Arrows removed, rounded cylinder with top/bottom fade) */}
      <div 
        onDoubleClick={() => setIsTypingMode(true)}
        className="relative w-full overflow-hidden bg-stone-950 rounded-2xl border border-teal-500/35 shadow-inner group cursor-pointer"
        style={{ height: totalHeight }}
      >
        {/* Quick Keyboard Direct Typing Icon at top corner */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isTypingMode) {
              handleTypedSubmit();
            } else {
              setIsTypingMode(true);
            }
          }}
          className={`absolute top-1.5 right-1.5 z-20 p-1 rounded-md transition-colors cursor-pointer ${
            isTypingMode ? 'bg-teal-500/30 text-teal-200' : 'text-stone-500 hover:text-teal-300 opacity-60 hover:opacity-100'
          }`}
          title="تایپ مستقیم عدد"
        >
          <Keyboard className="w-3 h-3" />
        </button>

        {/* Top Fade Gradient (subtle so half-number at top remains visible) */}
        <div className="absolute top-0 inset-x-0 h-3 bg-gradient-to-b from-stone-950/85 to-transparent pointer-events-none z-10" />

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
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-stone-950/95 backdrop-blur-md p-1"
            onClick={handleTypedSubmit}
          >
            <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
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
                className="w-16 text-center py-0.5 text-2xl sm:text-3xl font-mono font-black text-white bg-stone-900 border-2 border-teal-500 rounded-xl focus:outline-none leading-none shadow-md shadow-teal-500/20"
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
          }}
          className="overflow-y-auto no-scrollbar relative w-full touch-pan-y"
        >
          {repeatedItems.map((item) => {
            const isSelected = item.value === selectedValue;

            return (
              <div
                key={item.key}
                onClick={() => {
                  lastEmittedValueRef.current = item.value;
                  onChangeRef.current(item.value);
                  scrollToGlobalIndex(item.globalIndex, true);
                }}
                style={{
                  height: itemHeight,
                  scrollSnapAlign: 'center',
                }}
                className={`flex items-center justify-center cursor-pointer transition-all duration-150 font-mono tracking-tight select-none w-full ${
                  isSelected
                    ? 'text-white font-black text-2xl sm:text-3xl leading-none drop-shadow-md scale-100 opacity-100'
                    : 'text-stone-400 hover:text-stone-200 font-bold text-base sm:text-lg scale-95 opacity-65'
                }`}
              >
                {item.label}
              </div>
            );
          })}
        </div>

        {/* Bottom Fade Gradient (subtle so half-number at bottom remains visible) */}
        <div className="absolute bottom-0 inset-x-0 h-3 bg-gradient-to-t from-stone-950/85 to-transparent pointer-events-none z-10" />
      </div>
    </div>
  );
};
