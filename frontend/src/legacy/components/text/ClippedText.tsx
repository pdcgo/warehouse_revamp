import { useCallback, useEffect, useRef, useState } from "react";
import { Text, type TextProps } from "@chakra-ui/react";
import { Tooltip } from "../feedback/Tooltip";

// ClippedText is text that truncates, and shows a tooltip with the full value ONLY when it is
// actually truncated.
//
// The "only when" is the entire component. A tooltip on every cell is noise — it fires on the way
// to somewhere else and tells the reader what they can already see. A tooltip on nothing is worse:
// a truncated product name with no way to read it means opening the detail page to answer "which
// variant is this?". So the component measures: `scrollWidth > clientWidth` (or the height
// equivalent for a clamped multi-line block) and attaches a tip only if the text really doesn't fit.
//
// The measurement is re-run on RESIZE, because the answer changes with the column width — a name
// that fits on a desktop table is clipped the moment the sidebar opens or the window narrows, and a
// component that measured once at mount would silently stop offering the tooltip exactly when it
// became necessary.
export const description =
  "Truncating text that shows a tooltip with the full value only when it is genuinely clipped — measured, and re-measured on resize.";

export interface ClippedTextProps extends TextProps {
  // Override the tip text. Defaults to the rendered text content, which is what you want unless the
  // visible form is abbreviated and the tip should carry the long form.
  tooltip?: string;
  placement?: "top" | "bottom" | "left" | "right";
}

export function ClippedText({
  tooltip,
  placement = "top",
  children,
  lineClamp,
  ...rest
}: ClippedTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // Width for single-line truncation, height for a `lineClamp` block. Checking both means one
    // component covers the ellipsis case and the multi-line clamp case without a mode prop.
    setClipped(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
  }, []);

  useEffect(() => {
    measure();

    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    // Observing the element itself, not the window: a table column can change width while the
    // window does not (a sidebar opening, a neighbouring column growing).
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, children]);

  const text = (
    <Text
      ref={ref}
      truncate={lineClamp === undefined}
      lineClamp={lineClamp}
      data-testid="clipped-text"
      data-clipped={clipped ? "true" : "false"}
      {...rest}
    >
      {children}
    </Text>
  );

  // Tooltip renders the child bare when content is empty, so the un-clipped case costs nothing.
  return (
    <Tooltip
      content={clipped ? (tooltip ?? (typeof children === "string" ? children : undefined)) : undefined}
      placement={placement}
    >
      {text}
    </Tooltip>
  );
}
