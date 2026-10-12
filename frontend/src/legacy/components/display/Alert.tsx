import { useState, type ElementType, type ReactNode } from "react";
import { Alert as ChakraAlert, CloseButton, Icon } from "@chakra-ui/react";
import { palette, type Tone } from "../tone";

// Alert is an inline message about the thing the reader is looking at — not a toast.
//
// The distinction matters and is easy to get wrong: a TOAST is for the outcome of something you just
// did ("Product saved"), appears somewhere else on screen, and leaves. An ALERT is a persistent fact
// about the content it sits above ("This team has no warehouse assigned", "3 of these rows failed to
// import"). Toasting a persistent condition means it disappears before it is acted on, and the
// reader has no way to get it back.
//
// `closable` is therefore opt-in, not the default: most alerts here describe a condition that is
// still true after you dismiss them, and a dismissable warning about unpaid invoices is a warning
// that gets dismissed.
export const description =
  "An inline, persistent message about the content it sits above — as opposed to a toast, which reports what you just did and then leaves.";

export interface AlertProps extends Omit<ChakraAlert.RootProps, "title" | "status" | "colorPalette"> {
  tone?: Tone;
  title?: string;
  // A lucide component. Falls back to Chakra's per-status icon.
  icon?: ElementType;
  // Offer a dismiss. Off by default — see above.
  closable?: boolean;
  onClose?: () => void;
  children?: ReactNode;
}

// Chakra's Alert takes a `status`, which drives its default icon and its ARIA role. Mapping the
// tone onto it means an error alert is announced as an error, not merely coloured like one.
function statusFor(tone: Tone | undefined): "info" | "warning" | "success" | "error" | "neutral" {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

export function Alert({ tone = "info", title, icon, closable, onClose, children, ...rest }: AlertProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <ChakraAlert.Root
      status={statusFor(tone)}
      colorPalette={palette(tone, "info")}
      data-testid="alert"
      data-tone={tone}
      // Spread LAST so a caller can override the test id — these are used inside pages that need to
      // name their own alert ("login-error"), and a component that swallows unknown props forces
      // every such caller to wrap it in a div just to be addressable.
      {...rest}
    >
      <ChakraAlert.Indicator>{icon && <Icon as={icon} />}</ChakraAlert.Indicator>

      <ChakraAlert.Content>
        {title && <ChakraAlert.Title>{title}</ChakraAlert.Title>}
        {children && <ChakraAlert.Description>{children}</ChakraAlert.Description>}
      </ChakraAlert.Content>

      {closable && (
        <CloseButton
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          aria-label="Dismiss"
          data-testid="alert-close"
          onClick={() => {
            setDismissed(true);
            onClose?.();
          }}
        />
      )}
    </ChakraAlert.Root>
  );
}
