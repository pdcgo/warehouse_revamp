import { useLayoutEffect, useState } from "react";

// THE SIZE AN ELEMENT HAS, kept current — for a layout that answers to the room its COLUMN has, not the window's: a
// line card beside a side column is far narrower than the screen it is on, so a viewport breakpoint picks the wrong
// arrangement. A CSS container query would say this in the stylesheet; the app's emotion/stylis (4.2) does not pass
// `@container` through, so it is measured. The height serves a sticky header that a jump has to clear.
//
// Returns a CALLBACK ref, so an element that mounts late (after a loading state) is still observed, and its size in
// px — 0 until it is measured, which happens before the first paint.
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { width: number; height: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return [setEl, size];
}

/** The width alone — see `useElementSize`. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [ref, size] = useElementSize<T>();
  return [ref, size.width];
}
