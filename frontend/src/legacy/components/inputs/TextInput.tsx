import { Input, Textarea as ChakraTextarea } from "@chakra-ui/react";
import type { InputProps, TextareaProps } from "@chakra-ui/react";

// TextInput is a text field that reports its VALUE rather than an event, and knows what Enter means.
//
// Both are small, and both remove a mistake that keeps happening:
//
//  1. `onChange(value)` NOT `onChange(event)`. Every call site was writing `e.target.value`, and the
//     ones that forgot stored a SyntheticEvent in state — which renders as nothing and only fails at
//     submit time, where the error names the RPC rather than the field.
//  2. `onEnter` IS EXPLICIT. Enter in a text field is a real interaction here: the scanner is a
//     keyboard that types a barcode and presses Enter, so half the fields in the picking and
//     receiving screens need to act on it. Left to a hand-written keydown handler it gets written
//     three ways, and the one that forgets `preventDefault` submits the surrounding form instead.
export const description =
  "A text field that reports its VALUE (not the event) and takes an explicit `onEnter` — which matters because a barcode scanner is a keyboard that types and then presses Enter.";

export interface TextInputProps extends Omit<InputProps, "onChange" | "value"> {
  value?: string;
  onChange?(value: string): void;
  // Fired on Enter. The keypress is consumed, so it never also submits the surrounding form.
  onEnter?(value: string): void;
}

export function TextInput({ value, onChange, onEnter, onKeyDown, ...rest }: TextInputProps) {
  return (
    <Input
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) {
          // Without this the scanner's Enter submits the form the field happens to be in — which on
          // a receiving screen means posting a half-filled record on every scan.
          e.preventDefault();
          onEnter(e.currentTarget.value);
        }

        onKeyDown?.(e);
      }}
      data-testid="text-input"
      {...rest}
    />
  );
}

// Textarea is the multi-line form, with the same value-not-event contract.
//
// It does not auto-grow. These are notes and reasons — a damage description, why a count was
// adjusted — and a box that resizes as you type shifts everything below it mid-sentence. A fixed
// box that scrolls keeps the form still.
export const textareaDescription =
  "The multi-line field, same value-not-event contract. Fixed height on purpose: an auto-growing box shifts the rest of the form while you are still typing.";

export interface AppTextareaProps extends Omit<TextareaProps, "onChange" | "value"> {
  value?: string;
  onChange?(value: string): void;
}

export function Textarea({ value, onChange, ...rest }: AppTextareaProps) {
  return (
    <ChakraTextarea
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      data-testid="textarea"
      {...rest}
    />
  );
}
