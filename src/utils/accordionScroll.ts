/**
 * Utility to smoothly scroll the page or scrollable container when an accordion / collapsible menu is opened,
 * positioning the accordion header near the top of the viewport with a small portion (offsetTop) of the previous menu visible.
 */
export function scrollAccordionHeaderIntoView(targetEl: HTMLElement | null, offsetTop: number = 38): void {
  if (!targetEl) return;

  // Delay allows DOM expansion / animation to initiate
  setTimeout(() => {
    try {
      // Find nearest scrollable container
      let parent: HTMLElement | null = targetEl.parentElement;
      let scrollContainer: HTMLElement | null = null;

      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        const overflow = style.overflow + style.overflowY;
        if (/(auto|scroll)/.test(overflow) && parent.scrollHeight > parent.clientHeight) {
          scrollContainer = parent;
          break;
        }
        parent = parent.parentElement;
      }

      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const currentScrollTop = scrollContainer.scrollTop;
        const targetScrollTop = currentScrollTop + (targetRect.top - containerRect.top) - offsetTop;
        scrollContainer.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });
      } else {
        const targetRect = targetEl.getBoundingClientRect();
        const targetScrollTop = window.scrollY + targetRect.top - offsetTop;
        window.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });
      }
    } catch (err) {
      console.warn('Accordion scroll error:', err);
    }
  }, 100);
}
