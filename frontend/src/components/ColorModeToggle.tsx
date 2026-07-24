import { IconButton, Icon } from "@chakra-ui/react";
import { Moon, Sun } from "lucide-react";
import { useColorMode, toggleColorMode } from "../lib/colorMode";

export const description =
  "The light/dark toggle. A single icon button that flips the app's color mode — system preference by default, the choice remembered.";

// ColorModeToggle flips the whole app between light and dark (#213). The icon shows the mode you would
// switch TO, the way the mocks' own toggle does: a moon in light mode, a sun in dark.
export function ColorModeToggle() {
  const mode = useColorMode();
  const next = mode === "dark" ? "light" : "dark";

  return (
    <IconButton
      size="xs"
      variant="ghost"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      data-testid="color-mode-toggle"
      onClick={toggleColorMode}
    >
      <Icon as={mode === "dark" ? Sun : Moon} boxSize="4" />
    </IconButton>
  );
}
