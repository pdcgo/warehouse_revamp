import { useEffect, useState } from "react";

// A STICKY BOX NEVER RUNS PAST THE WINDOW'S FOOT (owner, on Product Discover: *"filternya tenggelam di bawah, kudu scroll
// produk"*; and on Cetak Label: *"scrollbarnya settingnya seperti di product discover, heightnya menyesuaikan"*).
//
// A sticky box taller than the window keeps its foot below the fold — what is at the bottom of it is reached only by
// scrolling the page beside it. So the box ends a gutter above the window's bottom WHEREVER IT STANDS — lower at rest,
// under the page's title, and taller once it sticks — re-measured on every scroll and resize. The gutter is the box's
// own sticky `top`, so it has the same margin below as above once it sticks. What overflows scrolls INSIDE the box.
//
// A fixed `100dvh` cap is not enough: at rest the box starts well down the page, and its last part is still off screen.
//
// ⚠ ONLY WHILE `active` — a box that is `static` on a narrow screen (the column stacked over the page) is given no
// height at all: it is as tall as it is, and the page scrolls it.
//
// A CALLBACK REF, so a box that mounts late — after the page's first load — is still measured. The listener is captured
// on `window`, so it hears whichever scroller is moving (sticky-sticks-to-the-window).
export function useFitToWindow<T extends HTMLElement>(active = true) {
  const [el, setEl] = useState<T | null>(null);

  useEffect(() => {
    if (!el) return;
    if (!active) {
      el.style.maxHeight = "";
      return;
    }

    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const gutter = parseFloat(getComputedStyle(el).top) || 0;
        // ⚠ Never measured from ABOVE the gutter. At the page's end the box's container runs out and pushes it up past
        // its sticky top; measured from there it would grow, lengthen the page, and be pushed again.
        const top = Math.max(gutter, el.getBoundingClientRect().top);
        // Never below a usable height, however low the box starts.
        el.style.maxHeight = `${Math.max(240, window.innerHeight - top - gutter)}px`;
      });
    };

    fit();
    window.addEventListener("scroll", fit, { capture: true, passive: true });
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", fit, { capture: true });
      window.removeEventListener("resize", fit);
      el.style.maxHeight = "";
    };
  }, [el, active]);

  return setEl;
}
