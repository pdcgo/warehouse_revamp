import type { ReactNode } from "react";
import { Checkbox as ArkCheckbox } from "@ark-ui/react";
import { Check, Minus } from "lucide-react";
import { cn } from "./cn";

// The app's Checkbox, replacing Chakra's — a styled Ark UI Checkbox (a visually-hidden native input
// under a styled control), so it's keyboard- and form-friendly. Supports the indeterminate state for
// a select-all header.
export interface CheckboxProps {
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  children,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <ArkCheckbox.Root
      checked={checked}
      onCheckedChange={(e) => onCheckedChange?.(e.checked === true)}
      disabled={disabled}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-sm text-fg data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60",
        className,
      )}
      {...rest}
    >
      <ArkCheckbox.Control className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface text-white transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent">
        <ArkCheckbox.Indicator>
          <Check className="size-3" />
        </ArkCheckbox.Indicator>
        <ArkCheckbox.Indicator indeterminate>
          <Minus className="size-3" />
        </ArkCheckbox.Indicator>
      </ArkCheckbox.Control>
      {children != null && <ArkCheckbox.Label>{children}</ArkCheckbox.Label>}
      <ArkCheckbox.HiddenInput />
    </ArkCheckbox.Root>
  );
}
