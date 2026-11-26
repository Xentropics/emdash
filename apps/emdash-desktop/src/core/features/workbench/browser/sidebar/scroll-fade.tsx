import { useEffect, useState, type RefObject } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';

/**
 * Fades the bottom edge of a scroll area into the sidebar background while
 * there is more to scroll to. Place it after the scroll area, inside a
 * `relative` parent.
 */
export function SidebarScrollFade({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setVisible(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    // The content can grow or shrink without a scroll (rows added, folded, resized).
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [scrollRef]);

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-b from-transparent to-(--em-surface) transition-opacity duration-150',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    />
  );
}
