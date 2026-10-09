import { Icon, Switch, Text } from "@chakra-ui/react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../i18n/language";
import { setColorMode, useColorMode } from "../lib/colorMode";

// THE TWO APP-WIDE PREFERENCES AS SWITCHES (owner, `the-more-sheet-switches-theme-and-language`, and on the desktop
// `the-account-menu-switches-theme-and-language`) — Tema off is light and on is dark, its thumb ☀ or ☾; Bahasa off is
// Indonesian and on is English, its thumb ID or EN. ONE component for both shells, so the phone's sheet and the
// desktop's account menu cannot draw them two ways.
//
// `face` is the desktop's use: the switch inside a menu item is a picture of the state, not a control — the ITEM is
// what a click (or Enter) toggles, so the switch takes no pointer and no focus of its own.
//
// ⚠ The thumb is WHITE in both modes, so its marks take fixed tones — a mode-following `fg.muted` or `brand.fg` turns
// pale in the dark and vanishes on white.

type Size = "md" | "lg";

const MARK = { md: { icon: "3", text: "2xs" }, lg: { icon: "4", text: "xs" } } as const;

export function ThemeSwitch({ size = "lg", face = false }: { size?: Size; face?: boolean }) {
  const { t } = useTranslation();
  const colorMode = useColorMode();

  return (
    <Switch.Root
      size={size}
      colorPalette="brand"
      checked={colorMode === "dark"}
      onCheckedChange={(e) => setColorMode(e.checked ? "dark" : "light")}
      readOnly={face}
      pointerEvents={face ? "none" : undefined}
      aria-hidden={face || undefined}
      data-testid={face ? undefined : "theme-switch"}
    >
      {!face && <Switch.HiddenInput aria-label={t("menu.theme")} />}
      <Switch.Control>
        <Switch.Thumb>
          <Switch.ThumbIndicator fallback={<Icon as={Sun} boxSize={MARK[size].icon} color="gray.600" />}>
            <Icon as={Moon} boxSize={MARK[size].icon} color="brand.solid" />
          </Switch.ThumbIndicator>
        </Switch.Thumb>
      </Switch.Control>
    </Switch.Root>
  );
}

export function LanguageSwitch({ size = "lg", face = false }: { size?: Size; face?: boolean }) {
  const { t } = useTranslation();
  const { lang, setLang } = useLanguage();

  return (
    <Switch.Root
      size={size}
      colorPalette="brand"
      checked={lang === "en"}
      onCheckedChange={(e) => setLang(e.checked ? "en" : "id")}
      readOnly={face}
      pointerEvents={face ? "none" : undefined}
      aria-hidden={face || undefined}
      data-testid={face ? undefined : "lang-switch"}
    >
      {!face && <Switch.HiddenInput aria-label={t("menu.language")} />}
      <Switch.Control>
        <Switch.Thumb>
          <Switch.ThumbIndicator
            fallback={
              <Text as="span" fontSize={MARK[size].text} fontWeight="bold" color="gray.600">
                ID
              </Text>
            }
          >
            <Text as="span" fontSize={MARK[size].text} fontWeight="bold" color="brand.solid">
              EN
            </Text>
          </Switch.ThumbIndicator>
        </Switch.Thumb>
      </Switch.Control>
    </Switch.Root>
  );
}
