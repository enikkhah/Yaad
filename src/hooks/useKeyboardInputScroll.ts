import { useEffect, useState } from 'react';

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export function isTextEntryElement(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type) && !el.disabled && !el.readOnly;
  }
  if (el.isContentEditable) return true;
  return false;
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Scrolls the active text input or textarea so that it is clearly visible
 * above the virtual keyboard and not obscured by sticky headers or footers.
 */
export function scrollInputAboveKeyboard(targetEl: HTMLElement, smooth: boolean = true): void {
  if (!targetEl || !document.body.contains(targetEl)) return;

  const vv = window.visualViewport;
  const vvTop = vv ? vv.offsetTop : 0;
  const vvHeight = vv ? vv.height : window.innerHeight;
  const vvBottom = vvTop + vvHeight;

  const scrollContainer = findScrollableAncestor(targetEl);

  if (scrollContainer) {
    // Ensure the scroll container has ample bottom padding while keyboard is active
    // so even inputs at the very bottom of a form can scroll well above the keyboard.
    if (!scrollContainer.dataset.origPaddingBottom) {
      scrollContainer.dataset.origPaddingBottom = scrollContainer.style.paddingBottom || '';
    }
    scrollContainer.style.paddingBottom = '180px';

    const containerRect = scrollContainer.getBoundingClientRect();

    // Check for sticky header inside the modal / container
    let safeTop = Math.max(vvTop + 10, containerRect.top + 10);
    const modalRoot = scrollContainer.parentElement;
    if (modalRoot) {
      const stickyHeaders = modalRoot.querySelectorAll<HTMLElement>('.sticky.top-0, [class*="sticky"][class*="top-0"]');
      stickyHeaders.forEach((hdr) => {
        if (hdr !== scrollContainer && !scrollContainer.contains(hdr)) {
          const r = hdr.getBoundingClientRect();
          if (r.height > 0 && r.bottom > safeTop && r.bottom < vvBottom - 80) {
            safeTop = Math.max(safeTop, r.bottom + 8);
          }
        }
      });
    }

    // Check for sticky bottom footer inside the modal / form
    let safeBottom = Math.min(vvBottom - 14, containerRect.bottom - 14);
    if (modalRoot) {
      const stickyFooters = modalRoot.querySelectorAll<HTMLElement>('.sticky.bottom-0, [class*="sticky"][class*="bottom-0"]');
      stickyFooters.forEach((ftr) => {
        const r = ftr.getBoundingClientRect();
        if (r.height > 0 && r.top > safeTop + 60 && r.top <= vvBottom + 4) {
          safeBottom = Math.min(safeBottom, r.top - 12);
        }
      });
    }

    const inputRect = targetEl.getBoundingClientRect();
    // Include room above the input for its label
    const desiredTop = inputRect.top - 26;
    const desiredBottom = inputRect.bottom + 14;

    if (desiredBottom > safeBottom || desiredTop < safeTop) {
      const visibleBandHeight = Math.max(80, safeBottom - safeTop);
      // Place the input roughly 30% down from safeTop (or right above safeBottom if tall)
      const idealTop = safeTop + Math.min(36, visibleBandHeight * 0.22);
      const deltaY = inputRect.top - idealTop;
      const nextScrollTop = Math.max(0, scrollContainer.scrollTop + deltaY);

      scrollContainer.scrollTo({
        top: nextScrollTop,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    return;
  }

  // Main window / document scrolling
  if (!document.body.dataset.origPaddingBottom) {
    document.body.dataset.origPaddingBottom = document.body.style.paddingBottom || '';
  }
  document.body.style.paddingBottom = '220px';

  let safeTop = vvTop + 12;
  const stickyTopBars = document.querySelectorAll<HTMLElement>(
    'header.sticky, [class*="sticky"][class*="top-"]'
  );
  stickyTopBars.forEach((bar) => {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.top >= vvTop - 10 && r.bottom < vvBottom - 100) {
      safeTop = Math.max(safeTop, r.bottom + 10);
    }
  });

  const safeBottom = vvBottom - 18;
  const inputRect = targetEl.getBoundingClientRect();
  const desiredTop = inputRect.top - 28;
  const desiredBottom = inputRect.bottom + 16;

  if (desiredBottom > safeBottom || desiredTop < safeTop) {
    const visibleBandHeight = Math.max(80, safeBottom - safeTop);
    const idealTop = safeTop + Math.min(38, visibleBandHeight * 0.25);
    const deltaY = inputRect.top - idealTop;
    const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;

    window.scrollTo({
      top: Math.max(0, currentScrollY + deltaY),
      behavior: smooth ? 'smooth' : 'auto',
    });
  }
}

function restoreTemporaryScrollPadding(): void {
  const paddedContainers = document.querySelectorAll<HTMLElement>('[data-orig-padding-bottom]');
  paddedContainers.forEach((el) => {
    el.style.paddingBottom = el.dataset.origPaddingBottom || '';
    delete el.dataset.origPaddingBottom;
  });
}

/**
 * Global hook mounted once at App root.
 * Ensures that whenever any input or textarea is focused or typed into anywhere in the app,
 * it stays in clear view above the virtual keyboard.
 */
export function useKeyboardInputScroll(): boolean {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timers: number[] = [];
    const clearScheduledTimers = () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers = [];
    };

    const scheduleInputVisibilityCheck = (el: HTMLElement) => {
      clearScheduledTimers();
      // Immediate + staggered checks as the mobile virtual keyboard animates open
      [20, 120, 260, 420].forEach((delay, idx) => {
        const id = window.setTimeout(() => {
          if (document.activeElement === el) {
            scrollInputAboveKeyboard(el, idx > 0);
          }
        }, delay);
        timers.push(id);
      });
    };

    const updateViewportMetrics = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : window.innerHeight;
      const offsetTop = vv ? vv.offsetTop : 0;
      const keyboardHeight = Math.max(0, window.innerHeight - height - offsetTop);

      const activeEl = document.activeElement;
      const textFocused = isTextEntryElement(activeEl);
      const shrinkDetected = keyboardHeight > 110 || height < window.innerHeight * 0.82;
      const kbOpen = textFocused && (shrinkDetected || window.innerWidth < 900);

      setIsKeyboardOpen(kbOpen);

      if (kbOpen) {
        document.documentElement.setAttribute('data-keyboard-open', 'true');
      } else {
        document.documentElement.removeAttribute('data-keyboard-open');
      }

      if (textFocused && activeEl instanceof HTMLElement) {
        scrollInputAboveKeyboard(activeEl, false);
      } else if (!textFocused) {
        restoreTemporaryScrollPadding();
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (isTextEntryElement(target)) {
        if (window.innerWidth < 900) {
          setIsKeyboardOpen(true);
          document.documentElement.setAttribute('data-keyboard-open', 'true');
        }
        scheduleInputVisibilityCheck(target);
      }
    };

    const handleFocusOut = () => {
      const cleanupId = window.setTimeout(() => {
        if (!isTextEntryElement(document.activeElement)) {
          setIsKeyboardOpen(false);
          document.documentElement.removeAttribute('data-keyboard-open');
          restoreTemporaryScrollPadding();
        }
      }, 100);
      timers.push(cleanupId);
    };

    const handleInput = (e: Event) => {
      const target = e.target as Element | null;
      if (isTextEntryElement(target)) {
        scrollInputAboveKeyboard(target, true);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (isTextEntryElement(target) && document.activeElement === target) {
        scheduleInputVisibilityCheck(target);
      }
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('click', handleClick, true);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportMetrics);
      window.visualViewport.addEventListener('scroll', updateViewportMetrics);
    }
    window.addEventListener('resize', updateViewportMetrics);

    return () => {
      clearScheduledTimers();
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('click', handleClick, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewportMetrics);
        window.visualViewport.removeEventListener('scroll', updateViewportMetrics);
      }
      window.removeEventListener('resize', updateViewportMetrics);
      document.documentElement.removeAttribute('data-keyboard-open');
      restoreTemporaryScrollPadding();
    };
  }, []);

  return isKeyboardOpen;
}
