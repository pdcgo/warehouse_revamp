import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

// The app's native Select, replacing Chakra's NativeSelect — a styled <select> with a chevron, for
// the simple enum pickers (a searchable, server-backed picker uses the Combobox primitive instead).
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "h-8 w-full cursor-pointer rounded-control border border-line-strong bg-surface pl-3 pr-8 text-sm text-fg outline-none transition-colors",
            "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      </div>
    );
  },
);
