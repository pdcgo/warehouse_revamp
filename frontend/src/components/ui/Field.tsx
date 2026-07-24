import { Field as ArkField } from "@ark-ui/react";
import { cn } from "./cn";

// The app's Field, replacing Chakra's — a styled re-export of Ark UI's Field (same Zag machine), so
// the label↔input id wiring, aria-invalid/aria-describedby, required and error-text plumbing come for
// free. Same part names as Chakra (Root/Label/Input/Textarea/HelperText/ErrorText), so migrating a
// form is an import swap; the input inside becomes Field.Input to keep the aria wiring.
const inputClasses =
  "h-8 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 data-[invalid]:border-red-500 data-[invalid]:focus-visible:ring-red-500";

function Root({ className, ...p }: ArkField.RootProps) {
  return <ArkField.Root className={cn("flex flex-col gap-1.5", className)} {...p} />;
}
function Label({ className, ...p }: ArkField.LabelProps) {
  return <ArkField.Label className={cn("text-sm font-medium text-fg", className)} {...p} />;
}
function Input({ className, ...p }: ArkField.InputProps) {
  return <ArkField.Input className={cn(inputClasses, className)} {...p} />;
}
function Textarea({ className, ...p }: ArkField.TextareaProps) {
  return (
    <ArkField.Textarea
      className={cn(inputClasses, "h-auto min-h-16 py-2 leading-relaxed", className)}
      {...p}
    />
  );
}
function HelperText({ className, ...p }: ArkField.HelperTextProps) {
  return <ArkField.HelperText className={cn("text-xs text-fg-subtle", className)} {...p} />;
}
function ErrorText({ className, ...p }: ArkField.ErrorTextProps) {
  return (
    <ArkField.ErrorText className={cn("text-xs text-red-600 dark:text-red-400", className)} {...p} />
  );
}
function RequiredIndicator({ className, ...p }: ArkField.RequiredIndicatorProps) {
  return <ArkField.RequiredIndicator className={cn("text-red-600", className)} {...p} />;
}

export const Field = { Root, Label, Input, Textarea, HelperText, ErrorText, RequiredIndicator };
