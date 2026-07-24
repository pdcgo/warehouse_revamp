import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

// The app's Button, replacing Chakra's. Same call surface the code already uses: `variant`,
// `colorPalette`, `size`, `loading`. Tailwind-styled on semantic <button>. Palette classes are
// written as LITERAL strings in static maps because Tailwind's JIT can't see `bg-${p}-600`.
export type ButtonVariant = "solid" | "outline" | "ghost" | "subtle" | "plain";
export type ButtonPalette = "brand" | "red" | "green" | "orange" | "purple" | "blue" | "gray";
export type ButtonSize = "xs" | "sm" | "md";

const SIZE: Record<ButtonSize, string> = {
  xs: "h-7 gap-1 px-2 text-xs",
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-9 gap-2 px-4 text-sm",
};

const ICON_SIZE: Record<ButtonSize, string> = { xs: "size-7", sm: "size-8", md: "size-9" };

const SOLID: Record<ButtonPalette, string> = {
  brand: "bg-brand-600 text-white hover:bg-brand-700",
  red: "bg-red-600 text-white hover:bg-red-700",
  green: "bg-green-600 text-white hover:bg-green-700",
  orange: "bg-orange-500 text-white hover:bg-orange-600",
  purple: "bg-purple-600 text-white hover:bg-purple-700",
  blue: "bg-blue-600 text-white hover:bg-blue-700",
  gray: "bg-gray-600 text-white hover:bg-gray-700",
};

const SUBTLE: Record<ButtonPalette, string> = {
  brand: "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900",
  red: "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900",
  green: "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900",
  orange: "bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-950 dark:text-orange-300 dark:hover:bg-orange-900",
  purple: "bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900",
  blue: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900",
  gray: "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
};

const GHOST: Record<ButtonPalette, string> = {
  brand: "text-accent-fg hover:bg-accent-soft",
  red: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950",
  green: "text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950",
  orange: "text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-950",
  purple: "text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950",
  blue: "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950",
  gray: "text-fg-muted hover:bg-surface-2 hover:text-fg",
};

// Outline is the app's neutral secondary (Cancel, etc.); only red tints, for a destructive-secondary.
const OUTLINE: Record<ButtonPalette, string> = {
  brand: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  gray: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  green: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  orange: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  purple: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  blue: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  red: "border border-red-300 bg-surface text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
};

function variantClasses(variant: ButtonVariant, palette: ButtonPalette): string {
  switch (variant) {
    case "solid":
      return SOLID[palette];
    case "subtle":
      return SUBTLE[palette];
    case "ghost":
      return GHOST[palette];
    case "outline":
      return OUTLINE[palette];
    case "plain":
      return "text-current hover:opacity-80";
  }
}

const BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  colorPalette?: ButtonPalette;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "solid", colorPalette = "brand", size = "sm", loading = false, type = "button", disabled, className, children, ...rest },
  ref,
) {
  return (
    // Default type="button" (as Chakra did): a native <button> inside a <form> is type="submit"
    // otherwise, so any non-submit button (a picker trigger, a Cancel) would submit the form on click.
    <button
      ref={ref}
      type={type}
      className={cn(BASE, SIZE[size], variantClasses(variant, colorPalette), className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  colorPalette?: ButtonPalette;
  size?: ButtonSize;
  "aria-label": string;
  children?: ReactNode;
}

// A square button for a single icon. Defaults to the ghost look most row/toolbar actions use.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", colorPalette = "gray", size = "sm", type = "button", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-control transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
        ICON_SIZE[size],
        variantClasses(variant, colorPalette),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
