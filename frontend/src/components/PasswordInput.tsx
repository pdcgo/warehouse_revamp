import { useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field } from "./ui/Field";
import { IconButton } from "./ui/Button";

// PasswordInput is a password field with a show/hide toggle. It renders a plain <Input> (so it
// still consumes the surrounding Field's context — the label→control id wiring, `required`,
// aria-invalid — exactly as a bare `<Input type="password">` did) and lays the toggle button over
// it. Wrapping the Input in Chakra's InputGroup instead would break that Field association, so the
// button is positioned absolutely over a relative Box rather than injected as an input element.
// description documents this component in the shared-components gallery (/components). Every
// curated shared component carries one so the gallery reads like living documentation.
export const description = "A password field with a show/hide toggle. Drop-in for any masked input.";

export function PasswordInput({ className, style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative w-full">
      {/* Field.Input is the field-aware input (Ark's Field.Input): it reads the surrounding Field's
          context for the control id / required / aria-invalid wiring, which is the whole reason the
          label associates with it. */}
      <Field.Input
        type={visible ? "text" : "password"}
        {...props}
        className={className}
        // paddingInlineEnd leaves room for the toggle so long values don't run under it. It comes
        // after the spread so a caller can't accidentally reclaim that space.
        style={{ ...style, paddingInlineEnd: "2.5rem" }}
      />
      <IconButton
        // type="button": inside a form a bare <button> defaults to submit — a show/hide toggle
        // must never submit the form it lives in.
        type="button"
        size="xs"
        variant="ghost"
        aria-label={visible ? "Hide password" : "Show password"}
        // Not a tab stop: tabbing a form should move field-to-field, not into the toggle.
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1 top-1/2 -translate-y-1/2"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconButton>
    </div>
  );
}
