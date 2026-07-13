import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

// The design system lives HERE, and only here.
//
// Two things are centralised on purpose:
//
//  1. DENSITY. Form controls default to "sm" so buttons/inputs match dense tables and nav.
//     Set once — do NOT sprinkle size="sm" across the app. Explicit sizes (e.g. size="xs"
//     on a table row action) still override. An operator console lives or dies on how much
//     is visible at a glance; this is the single knob for that.
//
//  2. SPACING SCALE. Semantic spacing tokens (field/card/section/page) are the only spacing
//     the app should reference. Retune the whole app's density by editing them here.
//
// NOTE: the accent ramp below is a placeholder. No brand/visual identity has been chosen for
// this system yet — see plans/plan.md.
const customConfig = defineConfig({
  theme: {
    // Cast to any: Chakra's generic recipe types only type `colorPalette` in defaultVariants
    // (they can't infer per-recipe variant keys from a partial override). The runtime merge
    // into the base recipe is unaffected.
    recipes: {
      button: { defaultVariants: { size: "sm" } },
      input: { defaultVariants: { size: "sm" } },
      textarea: { defaultVariants: { size: "sm" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    slotRecipes: {
      select: { defaultVariants: { size: "sm" } },
      combobox: { defaultVariants: { size: "sm" } },
      nativeSelect: { defaultVariants: { size: "sm" } },
      status: { defaultVariants: { size: "sm" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    tokens: {
      colors: {
        brand: {
          50: { value: "#f5f3ff" },
          100: { value: "#ede9fe" },
          200: { value: "#ddd6fe" },
          300: { value: "#c4b5fd" },
          400: { value: "#a78bfa" },
          500: { value: "#8b5cf6" },
          600: { value: "#7c3aed" },
          700: { value: "#6d28d9" },
          800: { value: "#5b21b6" },
          900: { value: "#4c1d95" },
          950: { value: "#2e1065" },
        },
      },
    },
    semanticTokens: {
      // Virtual tokens that colorPalette="brand" resolves on every Chakra component.
      colors: {
        brand: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brand.700}", _dark: "{colors.brand.300}" } },
          subtle: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.900}" } },
          muted: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.800}" } },
          emphasized: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.700}" } },
          solid: { value: { _light: "{colors.brand.600}", _dark: "{colors.brand.600}" } },
          focusRing: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.500}" } },
          border: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
        },
      },
      // The app's spacing scale — the one place to retune density.
      spacing: {
        field: { value: "{spacing.2}" }, //  8px — label ↔ value gap (tightest)
        card: { value: "{spacing.3}" }, // 12px — card padding, form fields, section-title mb
        section: { value: "{spacing.4}" }, // 16px — between sections / stacked cards
        page: { value: "{spacing.5}" }, // 20px — outer content gutter
      },
    },
  },
  globalCss: {
    "html, body": {
      bg: "white",
      color: "gray.900",
    },
  },
});

export const system = createSystem(defaultConfig, customConfig);
