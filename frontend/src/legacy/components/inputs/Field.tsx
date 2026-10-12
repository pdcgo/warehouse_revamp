import type { ReactNode } from "react";
import { Field as ChakraField } from "@chakra-ui/react";

// Field is the label/control/message wrapper every form control sits in.
//
// The rule it enforces is the one forms get wrong most often: AN ERROR REPLACES THE HINT, it does
// not stack with it. Showing both puts the instruction and the complaint side by side, and the
// reader has to work out which one is current — usually while already frustrated. The error is the
// more urgent message and it takes the slot.
//
// It uses Chakra's Field rather than a bare label so the wiring is real: the label is associated
// with the control by id, `required` marks it, and the error message is linked by
// `aria-describedby` and announced. A hand-rolled `<label><span>…</span>{children}</label>` looks
// identical and does none of that.
export const description =
  "The label/control/message wrapper for a form control. An error REPLACES the hint rather than stacking with it, and the label, required marker and message are properly associated with the control.";

export interface FieldProps {
  label?: string;
  required?: boolean;
  // Standing guidance — the format expected, the unit, what the field is for.
  hint?: ReactNode;
  // What is wrong right now. Present = the field is invalid, and this replaces the hint.
  error?: string;
  children: ReactNode;
}

export function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <ChakraField.Root invalid={Boolean(error)} required={required} data-testid="field">
      {label && (
        <ChakraField.Label>
          {label}
          {/* Chakra's own marker, so it is announced as "required" rather than read as an asterisk. */}
          <ChakraField.RequiredIndicator />
        </ChakraField.Label>
      )}

      {children}

      {error ? (
        <ChakraField.ErrorText data-testid="field-error">{error}</ChakraField.ErrorText>
      ) : (
        hint && <ChakraField.HelperText data-testid="field-hint">{hint}</ChakraField.HelperText>
      )}
    </ChakraField.Root>
  );
}
