import { useState } from "react";
import { Box, Icon, IconButton, Input } from "@chakra-ui/react";
import type { InputProps } from "@chakra-ui/react";
import { Eye, EyeOff } from "lucide-react";

// PasswordInput is a password field with a show/hide toggle. It renders a plain <Input> (so it
// still consumes the surrounding Field's context — the label→control id wiring, `required`,
// aria-invalid — exactly as a bare `<Input type="password">` did) and lays the toggle button over
// it. Wrapping the Input in Chakra's InputGroup instead would break that Field association, so the
// button is positioned absolutely over a relative Box rather than injected as an input element.
export function PasswordInput(props: InputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <Box position="relative" w="full">
      {/* pe leaves room for the toggle so long values don't run under it. It comes after the
          spread so a caller can't accidentally reclaim that space. */}
      <Input type={visible ? "text" : "password"} {...props} pe="2.5rem" />
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
        position="absolute"
        top="50%"
        insetEnd="1"
        transform="translateY(-50%)"
      >
        {visible ? <Icon as={EyeOff} boxSize="4" /> : <Icon as={Eye} boxSize="4" />}
      </IconButton>
    </Box>
  );
}
