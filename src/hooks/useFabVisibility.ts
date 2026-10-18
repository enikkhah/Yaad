import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';

export interface UseFabVisibilityOptions {
  /**
   * Minimal scroll distance (in px) before triggering slide-aside.
   * Prevents micro-movements or accidental taps from hiding the FAB.
   * @default 6
   */
  threshold?: number;

  /**
   * Time in milliseconds of inactivity before the FAB springs back to its original position.
   * @default 380
   */
  settleDelay?: number;

  /**
   * If true (e.g. when menu or modal is open), prevents hiding the FAB.
   * @default false
   */
  isMenuOpen?: boolean;

  /**
   * Distance in pixels to slide to the side, leaving a subtle round arc peeking out.
   * @default 40
   */
  slideDistance?: number;

  /**
   * Base distance from screen right edge in pixels.
   * @default 20
   */
  baseRightOffset?: number;
}

export interface UseFabVisibilityReturn {
  /** Whether the FAB is currently sliding aside */
  isFabHidden: boolean;
  /** Scroll direction: 'up' | 'down' | 'idle' */
  scrollDirection: 'up' | 'down' | 'idle';
  /** Whether the viewport is at the top of the scrollable document */
  isAtTop: boolean;
  /** Whether the viewport is at the bottom of the scrollable document */
  isAtBottom: boolean;
  /** Manually restore the FAB to its exact original position */
  resetFabPosition: () => void;
  /** Dynamically computed inline style for the FAB container */
  fabContainerStyle: CSSProperties;
  /** Class names for smooth spring transitions and positioning */
  fabContainerClassName: string;
}

/**
 * Custom React Hook for intelligent FAB (Floating Action Button) visibility & edge management.
 * Tracks scroll velocity and page boundaries (top, bottom, nested containers),
 * smoothly sliding the FAB aside during motion and returning it with exact precision
 * to its original coordinates upon complete scroll stop.
 */
export function useFabVisibility(options: UseFabVisibilityOptions = {}): UseFabVisibilityReturn {
  const {
    threshold = 6,
    settleDelay = 380,
    isMenuOpen = false,
    slideDistance = 40,
    baseRightOffset = 20,
  } = options;

  const [isFabHidden, setIsFabHidden] = useState(false);
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down' | 'idle'>('idle');
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(false);

  const lastScrollYRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rAFRef = useRef<number | null>(null);
  const isMenuOpenRef = useRef(isMenuOpen);

  useEffect(() => {
    isMenuOpenRef.current = isMenuOpen;
    if (isMenuOpen) {
      setIsFabHidden(false);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    }
  }, [isMenuOpen]);

  // Forces immediate restoration to original position
  const resetFabPosition = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setIsFabHidden(false);
    setScrollDirection('idle');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    lastScrollYRef.current = window.scrollY || document.documentElement.scrollTop || 0;

    const evaluateScroll = () => {
      if (isMenuOpenRef.current) return;

      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const windowHeight = window.innerHeight;
      const documentHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.body.clientHeight,
        document.documentElement.clientHeight
      );

      // Boundary calculations
      const atTop = currentScrollY <= 8;
      const atBottom = currentScrollY + windowHeight >= documentHeight - 12;

      setIsAtTop(atTop);
      setIsAtBottom(atBottom);

      const deltaY = currentScrollY - lastScrollYRef.current;
      const absDelta = Math.abs(deltaY);

      // Only trigger if movement exceeds threshold to avoid accidental micro-jitters
      if (absDelta >= threshold) {
        setScrollDirection(deltaY > 0 ? 'down' : 'up');
        setIsFabHidden(true);
      }

      lastScrollYRef.current = currentScrollY;

      // Clear existing settled timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Settle detection: Upon complete stop, return FAB exactly to original position
      debounceTimerRef.current = setTimeout(() => {
        setIsFabHidden(false);
        setScrollDirection('idle');
      }, settleDelay);
    };

    const handleScrollEvent = () => {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
      }
      rAFRef.current = requestAnimationFrame(evaluateScroll);
    };

    // Attach passive listeners on window, document (capture for internal containers), touchmove, and wheel
    window.addEventListener('scroll', handleScrollEvent, { passive: true });
    document.addEventListener('scroll', handleScrollEvent, { passive: true, capture: true });
    window.addEventListener('touchmove', handleScrollEvent, { passive: true });
    window.addEventListener('wheel', handleScrollEvent, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScrollEvent);
      document.removeEventListener('scroll', handleScrollEvent, true);
      window.removeEventListener('touchmove', handleScrollEvent);
      window.removeEventListener('wheel', handleScrollEvent);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
      }
    };
  }, [threshold, settleDelay]);

  // Compute exact position and smooth spring transform
  const shouldSlide = isFabHidden && !isMenuOpen;

  const fabContainerStyle: CSSProperties = {
    right: `${baseRightOffset}px`,
    left: 'auto',
    transform: shouldSlide ? `translateX(${slideDistance}px)` : 'translateX(0px)',
    transition: 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease-out',
    opacity: shouldSlide ? 0.88 : 1,
    willChange: 'transform, opacity',
  };

  const fabContainerClassName = `fixed bottom-20 sm:bottom-22 z-40 flex items-center pointer-events-auto select-none ${
    shouldSlide ? 'hover:translate-x-0 hover:opacity-100' : ''
  }`;

  return {
    isFabHidden: shouldSlide,
    scrollDirection,
    isAtTop,
    isAtBottom,
    resetFabPosition,
    fabContainerStyle,
    fabContainerClassName,
  };
}
