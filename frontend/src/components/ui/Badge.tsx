import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

// The app's Badge, replacing Chakra's. `colorPalette` + `variant` (subtle default), Tailwind-styled.
// Static literal palette maps (JIT can't see interpolated class names). Dark-aware via the `dark:`
// variant, which resolves to the [data-theme="dark"] custom variant (src/index.css).
export type BadgePalette =
  | "brand"
  | "red"
  | "green"
  | "orange"
  | "purple"
  | "blue"
  | "pink"
  | "teal"
  | "cyan"
  | "yellow"
  | "gray";
export type BadgeVariant = "subtle" | "solid" | "outline";

const SUBTLE: Record<BadgePalette, string> = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  green: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  purple: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  pink: "bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  yellow: "bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  gray: "bg-surface-2 text-fg-muted",
};

const SOLID: Record<BadgePalette, string> = {
  brand: "bg-brand-600 text-white",
  red: "bg-red-600 text-white",
  green: "bg-green-600 text-white",
  orange: "bg-orange-500 text-white",
  purple: "bg-purple-600 text-white",
  blue: "bg-blue-600 text-white",
  pink: "bg-pink-600 text-white",
  teal: "bg-teal-600 text-white",
  cyan: "bg-cyan-600 text-white",
  yellow: "bg-yellow-500 text-white",
  gray: "bg-gray-600 text-white",
};

const OUTLINE: Record<BadgePalette, string> = {
  brand: "border border-brand-200 text-brand-700 dark:border-brand-800 dark:text-brand-300",
  red: "border border-red-200 text-red-700 dark:border-red-800 dark:text-red-300",
  green: "border border-green-200 text-green-700 dark:border-green-800 dark:text-green-300",
  orange: "border border-orange-200 text-orange-700 dark:border-orange-800 dark:text-orange-300",
  purple: "border border-purple-200 text-purple-700 dark:border-purple-800 dark:text-purple-300",
  blue: "border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300",
  pink: "border border-pink-200 text-pink-700 dark:border-pink-800 dark:text-pink-300",
  teal: "border border-teal-200 text-teal-700 dark:border-teal-800 dark:text-teal-300",
  cyan: "border border-cyan-200 text-cyan-700 dark:border-cyan-800 dark:text-cyan-300",
  yellow: "border border-yellow-200 text-yellow-800 dark:border-yellow-800 dark:text-yellow-300",
  gray: "border border-line text-fg-muted",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  colorPalette?: BadgePalette;
  variant?: BadgeVariant;
  children?: ReactNode;
}

export function Badge({
  colorPalette = "gray",
  variant = "subtle",
  className,
  children,
  ...rest
}: BadgeProps) {
  const palette =
    variant === "solid" ? SOLID[colorPalette] : variant === "outline" ? OUTLINE[colorPalette] : SUBTLE[colorPalette];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        palette,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
