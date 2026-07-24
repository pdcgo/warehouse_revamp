import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

// The app's text Input, replacing Chakra's. Semantic <input>, sized to the old `sm` control default,
// styled with the token utilities. forwardRef so react-hook-form / focus management can reach it.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-fg transition-colors",
          "placeholder:text-fg-subtle outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...rest}
      />
    );
  },
);
