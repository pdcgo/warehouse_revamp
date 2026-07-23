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
// The neutral + brand palette, radii, shadows and type below are the mock token set (#213), promoted
// here so the real Chakra screens inherit the look the mocks agreed. The mock-var → token mapping is
// documented in plans/design-tokens.md — keep the two in sync.
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
      // The heading scale, lifted from the mocks (#213). A Chakra `Heading size="md"` resolves to
      // `textStyle="md"` = 16px/600 by default — too small; the mocks set the page title at 22px/700
      // and a section title at 15px/650. Overriding the size VARIANTS (not the shared `md`/`sm`
      // textStyles) keeps the change scoped to Headings, which is exactly the 96 that use it.
      heading: {
        sizes: {
          // Section / card title — `.card-title` / `.sec-title` in the mocks.
          sm: { fontSize: "0.9375rem", lineHeight: "1.35", fontWeight: "600" }, // 15px
          // The PAGE title — `.page-head h1`. The dominant heading in the app.
          md: { fontSize: "1.375rem", lineHeight: "1.2", fontWeight: "700" }, // 22px
          // The rare larger page title.
          lg: { fontSize: "1.625rem", lineHeight: "1.2", fontWeight: "700" }, // 26px
        },
      },
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
      // The mock's system font stack (#213) — one stack, both platforms.
      fonts: {
        body: {
          value:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        },
        heading: {
          value:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        },
      },
      // The mock corner radii (#213): controls 8px (--radius-sm), cards 12px (--radius).
      radii: {
        control: { value: "0.5rem" }, //  8px
        card: { value: "0.75rem" }, // 12px
      },
    },
    semanticTokens: {
      // The mock's palette (#213), promoted to Chakra's neutral semantic roles so every component
      // inherits the agreed look — and so BOTH color modes render (the `.dark` class flips them).
      colors: {
        // Virtual tokens that colorPalette="brand" resolves on every Chakra component. The ramp is a
        // placeholder identity (plans/plan.md); violet is the agreed WORKING accent, reconciled to the
        // mock's --accent (solid), --accent-soft (subtle) and --accent-fg (fg) in both modes.
        brand: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brand.700}", _dark: "{colors.brand.300}" } },
          subtle: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
          muted: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.800}" } },
          emphasized: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.700}" } },
          solid: { value: { _light: "{colors.brand.600}", _dark: "{colors.brand.500}" } },
          focusRing: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.500}" } },
          border: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
        },
        // Surfaces — page → card → inset. `--bg` / `--surface` / `--surface-2`.
        bg: {
          DEFAULT: { value: { _light: "#f6f7f9", _dark: "#0c0e12" } },
          subtle: { value: { _light: "#ffffff", _dark: "#161a20" } },
          muted: { value: { _light: "#f9fafb", _dark: "#1b2027" } },
        },
        // Hairlines. `--border` / `--border-strong`.
        border: {
          DEFAULT: { value: { _light: "#e4e7ec", _dark: "#262b33" } },
          emphasized: { value: { _light: "#d0d5dd", _dark: "#333a44" } },
        },
        // Text — primary → muted → subtle. `--fg` / `--fg-muted` / `--fg-subtle`.
        fg: {
          DEFAULT: { value: { _light: "#101828", _dark: "#f0f2f5" } },
          muted: { value: { _light: "#667085", _dark: "#98a2b3" } },
          subtle: { value: { _light: "#98a2b3", _dark: "#667085" } },
        },
      },
      // Cards and controls pick up the mock radii through Chakra's l2/l3 aliases (l2 = controls,
      // l3 = containers), so buttons/inputs round to 8px and cards to 12px app-wide.
      radii: {
        l2: { value: "{radii.control}" },
        l3: { value: "{radii.card}" },
      },
      // The mock's soft two-layer elevation. `sm` is what cards reach for.
      shadows: {
        xs: { value: "0 1px 2px rgba(16,24,40,.06)" },
        sm: { value: "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)" },
      },
      // The app's spacing scale — the one place to retune density.
      spacing: {
        field: { value: "{spacing.2}" }, //  8px — label ↔ value gap (tightest)
        card: { value: "{spacing.3}" }, // 12px — card padding, form fields, section-title mb
        section: { value: "{spacing.4}" }, // 16px — between sections / stacked cards
        page: { value: "{spacing.5}" }, // 20px — outer content gutter
      },
    },
    // The mock's typographic ROLES, formalized as named textStyles (#213). A screen reaches for
    // `textStyle="label"` rather than restating `fontSize`/`weight`/`letterSpacing`, so the type
    // scale lives in ONE place the way the palette and spacing do. The heading scale is on the
    // `heading` recipe above (it is what `Heading size=…` resolves through); these cover the roles
    // Chakra has no component for.
    textStyles: {
      // The ubiquitous uppercase micro-label over a value — `.stat-label` / `.m-label` / `.nav-label`
      // / `thead th`. Overrides Chakra's built-in `label` (which is a plain 14px/medium).
      label: {
        value: {
          fontSize: "0.6875rem", // 11px
          lineHeight: "1.3",
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        },
      },
      // The page-head subtitle and the many muted captions under a value — `.page-head p` / `.m-sub`
      // / `.stat-sub` / `.user-role`.
      caption: { value: { fontSize: "0.75rem", lineHeight: "1.35" } }, // 12px
      // The big number on a stat tile — `.stat-value`. Tabular so a column of them lines up.
      statValue: {
        value: { fontSize: "1.3125rem", lineHeight: "1.2", fontWeight: "650", fontVariantNumeric: "tabular-nums" }, // 21px
      },
      // Tabular numerics for money and counts — columns line up digit-for-digit.
      numeric: { value: { fontVariantNumeric: "tabular-nums" } },
    },
  },
  globalCss: {
    // Drive the page off the SEMANTIC tokens, not a hardcoded white/gray (#213). The old value pinned
    // the app to light and defeated dark mode outright; these two flip with the `.dark` class.
    "html, body": {
      bg: "bg",
      color: "fg",
      fontSize: "sm", // 14px base, the mock's body size — without rescaling the rem spacing scale.
    },
  },
});

export const system = createSystem(defaultConfig, customConfig);
