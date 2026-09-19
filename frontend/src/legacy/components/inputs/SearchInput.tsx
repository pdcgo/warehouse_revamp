import { useEffect, useRef, useState } from "react";
import { CloseButton, Icon, Input, InputGroup } from "@chakra-ui/react";
import type { InputProps } from "@chakra-ui/react";
import { Search } from "lucide-react";

// How long to wait after the last keystroke before reporting the value.
//
// 250ms is the standard "they have stopped typing" window: short enough that the list feels
// responsive, long enough that a six-letter product name is ONE request rather than six. Without it
// every keystroke is a round trip, and with `staleTime: 0` every one of those also re-renders the
// table underneath.
const DEBOUNCE_MS = 250;

// SearchInput is the search box above a list: a magnifier, a debounced value, and a clear button
// that appears only when there is something to clear.
//
// ⚠ IT IS UNCONTROLLED-ISH ON PURPOSE. The typed text is local state and only the DEBOUNCED value
// reaches `onChange`. Making the caller own the text would put a network round trip between the
// keystroke and the character appearing, which on a slow connection drops characters — the classic
// laggy search box. The caller gets the settled value; the input stays instant.
export const description =
  "The list search box: magnifier, a 250ms-debounced value, and a clear button only while there is something to clear. The typed text is local so typing never waits on the network.";

export interface SearchInputProps extends Omit<InputProps, "onChange" | "value"> {
  value?: string;
  // Called with the DEBOUNCED value, not on every keystroke.
  onChange?(value: string): void;
  debounceMs?: number;
}

export function SearchInput({
  value = "",
  onChange,
  debounceMs = DEBOUNCE_MS,
  placeholder = "Search",
  ...rest
}: SearchInputProps) {
  const [text, setText] = useState(value);
  // Tracks what we last reported, so an echo of our own value back through `value` does not look
  // like an external change and reset what the user is mid-way through typing.
  const reported = useRef(value);

  // An EXTERNAL change still wins — a Clear-all button on the filter bar, a URL restore. The guard
  // is only against our own round trip.
  useEffect(() => {
    if (value !== reported.current) {
      reported.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === reported.current) return;

    const timer = setTimeout(() => {
      reported.current = text;
      onChange?.(text);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [text, debounceMs, onChange]);

  return (
    <InputGroup
      startElement={<Icon as={Search} boxSize="4" color="fg.muted" />}
      endElement={
        text ? (
          <CloseButton
            size="xs"
            variant="plain"
            aria-label="Clear search"
            data-testid="search-clear"
            onClick={() => {
              setText("");
              // Clearing reports IMMEDIATELY rather than after the debounce: it is a deliberate
              // action, not a pause in typing, and waiting makes the button feel broken.
              reported.current = "";
              onChange?.("");
            }}
          />
        ) : undefined
      }
    >
      <Input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        data-testid="search-input"
        {...rest}
      />
    </InputGroup>
  );
}
