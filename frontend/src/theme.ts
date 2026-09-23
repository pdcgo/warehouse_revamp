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
// The radii, shadows and type below are the mock token set (#213), promoted here so the real Chakra
// screens inherit the look the mocks agreed. The palette is the owner's Tailwind set — see THE PALETTE.

// ── THE PALETTE ─────────────────────────────────────────────────────────────────────────────────
//
// Seven TONES, each one a Tailwind colour (owner):
//
//   tone      Tailwind   colorPalette
//   main      rose       brand      the app's own accent — buttons, spinners, the active nav item
//   primary   indigo     primary
//   success   emerald    success
//   warning   amber      warning
//   info      sky        info
//   error     red        error
//   plain     gray       gray       Chakra's default palette — every component not given one
//
// ⚠ A STATUS IS WRITTEN AS ITS ROLE, NEVER AS A HUE: `colorPalette="success"`, `color="warning.fg"`.
// Hue names (green, orange, blue, purple, …) are for CATEGORICAL colour only — a courier, a
// marketplace, a team type — where the colour tells things apart rather than saying good or bad.
// That is what makes retuning "warning" one edit here instead of a grep across the app.
//
// The values are Tailwind v3's hex, not v4's oklch: v3 is what the mocks' Tailwind CDN renders and
// what Chakra's own hue ramps already copy for 50–900, and a hex renders the same on every display.
type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;

const TAILWIND = {
  rose: {
    50: "#fff1f2", 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e",
    600: "#e11d48", 700: "#be123c", 800: "#9f1239", 900: "#881337", 950: "#4c0519",
  },
  indigo: {
    50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1",
    600: "#4f46e5", 700: "#4338ca", 800: "#3730a3", 900: "#312e81", 950: "#1e1b4b",
  },
  emerald: {
    50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981",
    600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22",
  },
  amber: {
    50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b",
    600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03",
  },
  sky: {
    50: "#f0f9ff", 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9",
    600: "#0284c7", 700: "#0369a1", 800: "#075985", 900: "#0c4a6e", 950: "#082f49",
  },
  red: {
    50: "#fef2f2", 100: "#fee2e2", 200: "#fecaca", 300: "#fca5a5", 400: "#f87171", 500: "#ef4444",
    600: "#dc2626", 700: "#b91c1c", 800: "#991b1b", 900: "#7f1d1d", 950: "#450a0a",
  },
  // Replaces Chakra's own `gray` (a zinc), so everything drawn in the default palette is Tailwind gray.
  gray: {
    50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280",
    600: "#4b5563", 700: "#374151", 800: "#1f2937", 900: "#111827", 950: "#030712",
  },
} satisfies Record<string, Ramp>;

// A ramp as Chakra color tokens — `{ 50: { value: "#…" }, … }`.
function rampTokens(ramp: Ramp) {
  return Object.fromEntries(Object.entries(ramp).map(([step, hex]) => [step, { value: hex }]));
}

// One step of a ramp in light mode, another in dark.
function shade(ramp: string, light: number, dark: number) {
  return { value: { _light: `{colors.${ramp}.${light}}`, _dark: `{colors.${ramp}.${dark}}` } };
}

// The eight virtual tokens `colorPalette="<role>"` resolves on every Chakra component, on the same
// steps Chakra uses for its own palettes. `overrides` is for the roles that genuinely differ.
function rolePalette(ramp: string, overrides: Record<string, { value: unknown }> = {}) {
  return {
    contrast: { value: { _light: "white", _dark: "white" } },
    fg: shade(ramp, 700, 300),
    subtle: shade(ramp, 100, 900),
    muted: shade(ramp, 200, 800),
    emphasized: shade(ramp, 300, 700),
    solid: shade(ramp, 600, 600),
    focusRing: shade(ramp, 500, 500),
    border: shade(ramp, 500, 400),
    ...overrides,
  };
}

// ── MARKETPLACE COLOURS ─────────────────────────────────────────────────────────────────────────
//
// Each marketplace's BRAND colour (the owner's reference hex), adapted to this UI per colour mode —
// a tinted background under a darker text in light mode, a sunk background under a lighter text in
// dark mode — and tuned in a Storybook colour lab. MarketplaceBadge is the only reader; a marketplace
// is CATEGORICAL colour (it tells storefronts apart), so it is named for the storefront, not for a
// role or a hue.
//
//   reference   light bg / text      dark bg / text
//   Lazada     #046BD2   #e1edfa / #0356a8   #0d2f57 / #75aee6
//   Shopee     #EE4D2D   #fdeae6 / #be3e24   #4f2729 / #f69d8c
//   Tokopedia  #00AA5B   #e0f5eb / #008849   #0c4136 / #73d0a5   ⚠ light text is 4.0:1, under 4.5
//   TikTok     #000000   #e5e7eb / #000000   #e5e7eb / #000000   black cannot sink into a dark
//                                                                 surface — a light chip in both modes
//   Blibli     #0091C4   #e0f2f8 / #00749d   #0c3a53 / #73c3df
//   Bukalapak  #E31F52   #fce4ea / #b61942   #4c1a33 / #f084a0
//   Others     plain     gray.100 / gray.700  gray.800 / gray.300
//
// PENDING — Mengantar (#2E47BA): not in the Marketplace enum, and whether it is a marketplace or a
// shipping service is undecided. Its lab values, for when it lands: light #e6e9f7 / #253995, dark
// #192550 / #8c9ad9.
function marketplaceColour(light: [string, string], dark: [string, string]) {
  return {
    bg: { value: { _light: light[0], _dark: dark[0] } },
    fg: { value: { _light: light[1], _dark: dark[1] } },
  };
}

// ── TEAM TYPE COLOURS ───────────────────────────────────────────────────────────────────────────
//
// One Tailwind colour per team type (owner), tuned in a Storybook colour lab. A team type is shown two
// ways — the type BADGE and the initials AVATAR — tinted one step apart, so each has three values per
// mode: `badge` (background), `avatar` (background) and `fg` (the text on both). TeamTypeBadge
// (components/badges) is the only reader.
//
//   Tailwind   light badge / avatar / text     dark badge / avatar / text
//   Warehouse  amber   100 / 200 / 700   #fef3c7 #fde68a #b45309   900 / 800 / 300   #78350f #92400e #fcd34d
//   Selling    indigo  100 / 200 / 700   #e0e7ff #c7d2fe #4338ca   900 / 800 / 300   #312e81 #3730a3 #a5b4fc
//   Root       green   100 / 200 / 700   #dcfce7 #bbf7d0 #15803d   900 / 800 / 300   #14532d #166534 #86efac
//   Admin      red     100 / 200 / 700   #fee2e2 #fecaca #b91c1c   900 / 800 / 300   #7f1d1d #991b1b #fca5a5
//   (unknown)  gray    100 / 200 / 700   #f3f4f6 #e5e7eb #374151   800 / 700 / 300   #1f2937 #374151 #d1d5db
//
// ⚠ Below 4.5:1 on the AVATAR (larger, bolder initials, so it reads better than the ratio says):
// Warehouse 4.0 and Root 4.1 in light mode, Admin 4.4 in dark mode. Every badge clears 4.5.
function teamTypeColour(light: [string, string, string], dark: [string, string, string]) {
  return {
    badge: { value: { _light: light[0], _dark: dark[0] } },
    avatar: { value: { _light: light[1], _dark: dark[1] } },
    fg: { value: { _light: light[2], _dark: dark[2] } },
  };
}

// The system stack — the mock's original typeface (#213), now the FALLBACK under Lato. It is what
// renders offline and for the instant before the web font arrives (`display=swap`). Exported so the
// Storybook "Font" toolbar can switch back to it for a before/after comparison.
export const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Lato is loaded by a Google Fonts <link> in `index.html` (the app) and `.storybook/preview-head.html`
// (Storybook) — keep the two in step. The URL carries weights 100/300/400/700/900 only, so a 500 falls
// back to 400 and a 600/650 to 700.
const APP_FONT_STACK = `Lato, ${SYSTEM_FONT_STACK}`;

// The vertical padding of ONE OPTION in a popup list — Select, Combobox and Menu all read it, so the
// three can never feel different again. Around a 20px line:
//   - phone → 12px, a 44px row: a finger-sized target, for the operator picking a shop at the shelf.
//   - `md` and up → 6px, a 32px row: Combobox's own `sm` value, the owner's reference for desktop.
// `md` is the same 48em the app switches to the mobile shell at (shell.ts), so a phone-sized list only
// ever appears inside the phone-sized shell.
const OPTION_PY = { base: "3", md: "1.5" };

// What a field does UNDER THE POINTER, shared by every control that takes input (see the field recipes
// below). The RESTING line stays the neutral `border` — a form at rest should read as a form, not as a
// row of pink boxes — and only the reacting states carry the main tone:
//
//   hover → `border.fieldHover`, the main tone faded down
//   focus → the SAME ONE LINE, in the main tone
//
// ⚠ ONE LINE, NOT TWO (owner). Chakra's `focusVisibleRing: "inside"` repaints the border AND draws a
// 1px outline on top of it — two hairlines on the same edge, which reads as a 2px frame. The ring is
// switched off here and focus is carried by the border alone, so a focused field is exactly as thick
// as an unfocused one.
//
// Chakra's own hover is `border.emphasized`, a grey a shade darker — the same "something happened"
// signal in a colour that says nothing about which app you are in.
const FIELD_OUTLINE = {
  _hover: { borderColor: "border.fieldHover" },
  focusVisibleRing: "none",
  _focusVisible: { borderColor: "brand.focusRing" },
};

const customConfig = defineConfig({
  theme: {
    // Cast to any: Chakra's generic recipe types only type `colorPalette` in defaultVariants
    // (they can't infer per-recipe variant keys from a partial override). The runtime merge
    // into the base recipe is unaffected.
    // ── A SCROLLING LIST KEEPS AWAY FROM ITS SCROLLBAR (owner) ────────────────────────────────────
    //
    // In a dialog — the product picker is the case that prompted it — the rows ran flush to the right
    // edge, so the bar was drawn ON the list: a row's last column and the thumb share the same pixels,
    // and the eye reads them as one smudged column.
    //
    // `scrollbarGutter: stable` is the other half, and it is what stops a JUMP: without it the list is
    // one scrollbar wider while it fits on one page, and every row shifts sideways the moment a search
    // narrows it to something that scrolls.
    //
    // A layerStyle rather than a prop each time: the next scrolling list in a dialog should be able to
    // say `layerStyle="scrollList"` and inherit the decision instead of copying two numbers.
    layerStyles: {
      scrollList: {
        value: {
          overflowY: "auto",
          pe: "2",
          scrollbarGutter: "stable",
        },
      },
    },
    recipes: {
      button: { defaultVariants: { size: "sm" } },
      // ── THE FIELD OUTLINE, ON HOVER AND FOCUS ───────────────────────────────────────────────────
      //
      // Every control a person types or picks in reacts the same way — see FIELD_OUTLINE.
      //
      // ⚠ EACH RECIPE HAS TO BE NAMED. `nativeSelect` copies the `select` trigger's styles from
      // CHAKRA's object at import time, not from ours, so overriding one does not reach the other.
      input: { defaultVariants: { size: "sm" }, variants: { variant: { outline: FIELD_OUTLINE } } },
      textarea: { defaultVariants: { size: "sm" }, variants: { variant: { outline: FIELD_OUTLINE } } },
      // The heading scale, lifted from the mocks (#213). A Chakra `Heading size="md"` resolves to
      // `textStyle="md"` = 16px by default — too small; the mocks set the page title at 22px and a
      // section title at 15px. Overriding the size VARIANTS (not the shared `md`/`sm` textStyles) keeps
      // the change scoped to Headings.
      //
      // ⚠ THE KEY IS `variants.size`, NOT `sizes`. This block used to read `heading: { sizes: … }`,
      // which Chakra v3 does not know and silently ignores — so every page title rendered at 16px, SMALLER
      // than an 18px card title under it, and no title hierarchy could be built on top.
      //
      // Every weight is 700: Lato ships no 500/600, so bold is the one strong weight and the levels are
      // told apart by SIZE (see TYPE HIERARCHY, on the field recipe below).
      heading: {
        variants: {
          size: {
            // A SECTION inside a card — "Customer", "Delivery address".
            sm: { fontSize: "0.9375rem", lineHeight: "1.35", fontWeight: "700" }, // 15px
            // The PAGE title — `.page-head h1`. The dominant heading in the app.
            md: { fontSize: "1.375rem", lineHeight: "1.2", fontWeight: "700" }, // 22px
            // The rare larger page title.
            lg: { fontSize: "1.625rem", lineHeight: "1.2", fontWeight: "700" }, // 26px
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    slotRecipes: {
      select: {
        defaultVariants: { size: "sm" },
        // An option row padded like a COMBOBOX option (8px sides, OPTION_PY). Chakra ships the two
        // recipes with different paddings for the same `sm` — Select's is 4px / 6px, a 28px row — so a
        // shop picker and a province picker on one form felt different. Combobox is the reference
        // (owner). The group label keeps the desktop padding at every width: it is not a tap target.
        variants: {
          size: {
            sm: {
              item: { py: OPTION_PY, px: "2" },
              itemGroupLabel: { py: "1.5", px: "2" },
            },
          },
          // The field outline, on the part that draws the box (see FIELD_OUTLINE).
          variant: { outline: { trigger: FIELD_OUTLINE } },
        },
      },
      combobox: {
        defaultVariants: { size: "sm" },
        // Its padding is already the reference; only the phone-sized row is added (OPTION_PY).
        variants: {
          size: { sm: { item: { py: OPTION_PY } } },
          variant: { outline: { input: FIELD_OUTLINE } },
        },
      },
      // Menu is used at its default `md` (every row-action kebab), whose padding already matches.
      menu: {
        variants: { size: { md: { item: { py: OPTION_PY } } } },
      },
      nativeSelect: {
        defaultVariants: { size: "sm" },
        variants: { variant: { outline: { field: FIELD_OUTLINE } } },
      },
      // ── THE DATE PICKER'S TRIGGER IS A FIELD, NOT A BUTTON (owner) ──────────────────────────────
      //
      // It is a <button> semantically — it opens a calendar — but it stands in a form row beside
      // inputs and selects, holding a VALUE the way they do. Chakra's own trigger recipe is sized
      // like a small button: 24px tall against a field's 36px, a 2px radius against 8px, and its text
      // in the muted ink a placeholder uses. Three differences, and together they made the one
      // control on the form that did not look like a control.
      //
      // ⚠ IT IS SET HERE, NOT ON THE COMPONENT. Density, spacing and colour live in this file
      // (CLAUDE.md) — a height typed into DatePicker.tsx is a height the next control copies by eye.
      datePicker: {
        defaultVariants: { size: "sm" },
        base: {
          trigger: {
            h: "9",
            minH: "9",
            px: "2.5",
            borderRadius: "l2",
            fontWeight: "normal",
            justifyContent: "start",
            gap: "2",
            color: "fg",
            ...FIELD_OUTLINE,
          },
        },
      },
      status: { defaultVariants: { size: "sm" } },
      // ── A TABLE ROW TAKES THE SURFACE IT SITS ON (owner) ────────────────────────────────────────
      //
      // Chakra paints rows with the BODY background. In light that is invisible — the page ground and
      // a card are both near-white — but in dark the card is gray-900 and the ground is gray-950, so
      // every row of an order's lines read as a hole punched in the card it sits in.
      //
      // Transparent is the fix that works in both places: on this form the row is the card's colour,
      // on a list screen it is the page canvas's. Hover and selection are unaffected — they paint
      // their own background on top of this one.
      //
      // ⚠ THE OVERRIDE HAS TO NAME THE VARIANT. Chakra sets `row: { bg: "bg" }` inside `variant.line`
      // — the default one — and a variant beats `base`, so a base-level override here changed
      // nothing at all and the rows stayed gray-950 in dark. Same trap as `nativeSelect` above.
      table: {
        variants: { variant: { line: { row: { bg: "transparent" } } } },
      },
      // ── TYPE HIERARCHY (owner) ──────────────────────────────────────────────────────────────────
      //
      // Lato ships only 400 and 700 (no 500/600), so the levels are told apart by SIZE and COLOUR,
      // with bold as the single strong weight:
      //
      //   page title      Heading md          22px  700  fg
      //   card title      Card.Title          18px  700  fg
      //   card subtitle   Card.Description    14px  400  fg.muted
      //   section         Heading sm          15px  700  fg
      //   field label     Field.Label         13px  700  fg.label   + a red * when required
      //   helper text     Field.HelperText    12px  400  fg.muted
      //
      // A card's title is bold and its subtitle a step quieter; every form reads the same way.
      card: {
        // Explicit bold: Chakra's `semibold` (600) only BECOMES 700 because Lato has no 600, and a rule
        // that works by accident is one somebody "fixes" into a different weight.
        base: { title: { fontWeight: "bold" } },
      },
      field: {
        base: {
          // THE LABEL — Lato Bold at 13px in a slightly softened ink. With no semibold to reach for, a
          // smaller bold one step lighter than body text reads like one: clearly a label, distinct from
          // the 14px regular value typed under it and from the muted helper below that.
          label: {
            fontSize: "0.8125rem", // 13px
            lineHeight: "1.25rem",
            fontWeight: "bold",
            color: "fg.label",
            // THE REQUIRED MARKER, drawn once for every form. `Field.Root required` puts
            // `data-required` on the label (Ark), so all 55 required fields get it without each screen
            // remembering a `<Field.RequiredIndicator />` — none did. `"*" / ""` gives the asterisk EMPTY
            // alt text, so a screen reader does not read "star"; "required" is already announced from
            // the input's own `required`. The `:has` guard skips a label that renders Chakra's
            // indicator itself (the legacy Field wrapper), so no label ever shows two.
            //
            // ⚠ The guard matches the indicator's SLOT CLASS. Chakra's `Field.RequiredIndicator` carries
            // no `data-part` — a guard on `[data-part=required-indicator]` matched nothing and the
            // legacy form showed "Ref id**".
            "&[data-required]:not(:has(.chakra-field__requiredIndicator))::after": {
              content: '"*" / ""',
              color: "fg.error",
            },
          },
          // Helper / fallback text under a field — a step quieter than the label, never competing.
          helperText: { color: "fg.muted", textStyle: "xs" },
        },
      },
      // A status renders in its ROLE palette (THE PALETTE, above). Chakra's defaults hard-code a hue
      // for each — blue/orange/green/red — which would put the old colours back on every alert and
      // toast.
      alert: {
        variants: {
          status: {
            info: { root: { colorPalette: "info" } },
            warning: { root: { colorPalette: "warning" } },
            success: { root: { colorPalette: "success" } },
            error: { root: { colorPalette: "error" } },
          },
        },
      },
      toast: {
        base: {
          root: {
            "&[data-type=warning]": { bg: "warning.solid", color: "warning.contrast" },
            "&[data-type=success]": { bg: "success.solid", color: "success.contrast" },
            "&[data-type=error]": { bg: "error.solid", color: "error.contrast" },
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    tokens: {
      colors: {
        ...Object.fromEntries(Object.entries(TAILWIND).map(([name, ramp]) => [name, rampTokens(ramp)])),
        // The main tone's ramp under its role name, so a `brand.500`-style reference still resolves.
        brand: rampTokens(TAILWIND.rose),
      },
      // One stack for body and headings — Lato, over the system fallback.
      fonts: {
        body: { value: APP_FONT_STACK },
        heading: { value: APP_FONT_STACK },
      },
      // The mock corner radii (#213): controls 8px (--radius-sm), cards 12px (--radius).
      radii: {
        control: { value: "0.5rem" }, //  8px
        card: { value: "0.75rem" }, // 12px
      },
    },
    semanticTokens: {
      // Every role and every neutral resolves to a step of THE PALETTE, in BOTH color modes (the
      // `.dark` class flips them).
      colors: {
        // The main tone. Its lighter subtle/muted/emphasized steps (and a brighter dark-mode solid) are
        // the mock's --accent-soft / --accent, kept so the sidebar's hover and active states read the
        // same as before — only the hue changed.
        brand: rolePalette("rose", {
          subtle: shade("rose", 50, 950),
          muted: shade("rose", 100, 800),
          emphasized: shade("rose", 200, 700),
          solid: shade("rose", 600, 500),
        }),
        primary: rolePalette("indigo"),
        success: rolePalette("emerald"),
        // ⚠ White on amber fails contrast, so the warning fill is the lighter 500 with DARK text — the
        // way Chakra treats its own yellow.
        warning: rolePalette("amber", {
          solid: shade("amber", 500, 500),
          contrast: shade("amber", 950, 950),
        }),
        info: rolePalette("sky"),
        error: rolePalette("red"),
        // THE DEFAULT FOCUS RING (owner). Chakra draws every ring in `colorPalette.focusRing`, and the
        // app's root palette is `gray` — so a tab, a menu item and a checkbox all focused in grey while
        // the brand sat unused. Overriding gray's ring paints them in the main tone instead; a control
        // given its own palette (a brand button, an error button) still rings in that palette.
        gray: { focusRing: shade("rose", 500, 400) },
        // `marketplace.<name>.bg` / `.fg` — see MARKETPLACE COLOURS, above.
        marketplace: {
          lazada: marketplaceColour(["#e1edfa", "#0356a8"], ["#0d2f57", "#75aee6"]),
          shopee: marketplaceColour(["#fdeae6", "#be3e24"], ["#4f2729", "#f69d8c"]),
          tokopedia: marketplaceColour(["#e0f5eb", "#008849"], ["#0c4136", "#73d0a5"]),
          tiktok: marketplaceColour(["#e5e7eb", "#000000"], ["#e5e7eb", "#000000"]),
          blibli: marketplaceColour(["#e0f2f8", "#00749d"], ["#0c3a53", "#73c3df"]),
          bukalapak: marketplaceColour(["#fce4ea", "#b61942"], ["#4c1a33", "#f084a0"]),
          others: marketplaceColour(
            [TAILWIND.gray[100], TAILWIND.gray[700]],
            [TAILWIND.gray[800], TAILWIND.gray[300]],
          ),
        },
        // `teamType.<type>.badge` / `.avatar` / `.fg` — see TEAM TYPE COLOURS, above.
        teamType: {
          warehouse: teamTypeColour(["#fef3c7", "#fde68a", "#b45309"], ["#78350f", "#92400e", "#fcd34d"]),
          selling: teamTypeColour(["#e0e7ff", "#c7d2fe", "#4338ca"], ["#312e81", "#3730a3", "#a5b4fc"]),
          root: teamTypeColour(["#dcfce7", "#bbf7d0", "#15803d"], ["#14532d", "#166534", "#86efac"]),
          admin: teamTypeColour(["#fee2e2", "#fecaca", "#b91c1c"], ["#7f1d1d", "#991b1b", "#fca5a5"]),
          others: teamTypeColour(["#f3f4f6", "#e5e7eb", "#374151"], ["#1f2937", "#374151", "#d1d5db"]),
        },
        // Surfaces — page → card → inset. `--bg` / `--surface` / `--surface-2`. The status tints are
        // Chakra's own `bg.error` & co., pointed at the role ramps.
        bg: {
          DEFAULT: { value: { _light: "{colors.white}", _dark: "{colors.gray.950}" } },
          subtle: { value: { _light: "{colors.white}", _dark: "{colors.gray.900}" } },
          muted: shade("gray", 50, 800),
          // Dialogs, menus, popovers: lifted off the page in dark mode, as a card is.
          panel: { value: { _light: "{colors.white}", _dark: "{colors.gray.900}" } },
          error: shade("red", 50, 950),
          warning: shade("amber", 50, 950),
          success: shade("emerald", 50, 950),
          info: shade("sky", 50, 950),
        },
        // Hairlines. `--border` / `--border-strong`.
        border: {
          DEFAULT: shade("gray", 200, 800),
          emphasized: shade("gray", 300, 700),
          // A FIELD UNDER THE POINTER (owner) — the main tone, faded down. Every control a person types
          // or picks in reacts the same way: input, textarea, select, combobox, native select. It is a
          // TOKEN rather than five recipe values so they cannot drift apart again. The resting line is
          // the neutral `border` above; only hover and focus carry the tone.
          fieldHover: shade("rose", 300, 700),
          error: shade("red", 500, 400),
          warning: shade("amber", 500, 400),
          success: shade("emerald", 500, 400),
          info: shade("sky", 500, 400),
        },
        // Text — primary → muted → subtle. `--fg` / `--fg-muted` / `--fg-subtle`. A status text is the
        // same step as its role's `.fg`, so `fg.error` and `error.fg` can never disagree.
        fg: {
          DEFAULT: shade("gray", 900, 50),
          muted: shade("gray", 500, 400),
          subtle: shade("gray", 400, 500),
          // A field label's ink — a step softer than body text, so a BOLD label reads like a semibold
          // one (see TYPE HIERARCHY, on the field recipe).
          label: shade("gray", 700, 300),
          error: shade("red", 700, 300),
          warning: shade("amber", 700, 300),
          success: shade("emerald", 700, 300),
          info: shade("sky", 700, 300),
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
    },
    // ── TELL THE BROWSER WHICH MODE IT IS IN ────────────────────────────────────────────────────
    //
    // ⚠ NOTHING IN THIS APP EVER DECLARED `color-scheme` — not index.html, not Chakra's preset. So in
    // dark mode the browser was never told the page was dark and kept painting its own widgets LIGHT
    // over it: the scrollbar first, but also every control that is still native (the `<input
    // type="time">` inside the date picker, autofill backgrounds, spell-check menus).
    //
    // This is the standards answer rather than paint over the top, and it has to come before the
    // scrollbar rules below — where those are unsupported, this alone already gets it right.
    //
    // ⚠ WRITTEN AS TWO SELECTORS, NOT `_dark`. Chakra's dark condition compiles to `.dark &`, and the
    // `dark` class is ON `html` itself — so `_dark` inside an `html` rule becomes `.dark html`, which
    // matches nothing. The first version of this silently left `color-scheme: light` in dark mode,
    // and the only symptom was a white scrollbar: exactly the bug it was written to fix.
    html: { colorScheme: "light" },
    "html.dark": { colorScheme: "dark" },
    // ── THE SCROLLBAR (owner: transparent track, thumb that follows the mode) ────────────────────
    //
    // ⚠ BOTH SYNTAXES, because neither engine covers everyone. Firefox understands only
    // `scrollbar-width`/`scrollbar-color`; Blink and WebKit need `::-webkit-scrollbar` for anything
    // past that. On `*` so every scroll area is covered at once — the page, a dialog's list, a table
    // that scrolls sideways on a phone, a combobox.
    //
    // The THUMB is `border.emphasized` (gray.300 light, gray.700 dark) straight from the semantic
    // tokens: one definition, and it follows the mode with nothing to keep in sync.
    //
    // ⚠ macOS mostly ignores this — its overlay scrollbars are already transparent and fade out. The
    // rule is for Windows and Linux Chrome, where the grey channel is actually drawn.
    "*": {
      scrollbarWidth: "thin",
      scrollbarColor: "{colors.border.emphasized} transparent",
    },
    "*::-webkit-scrollbar": {
      width: "10px",
      height: "10px",
    },
    // Transparent, so it shows whatever surface it sits on rather than cutting a grey channel
    // through a card.
    "*::-webkit-scrollbar-track": {
      bg: "transparent",
    },
    // THIN WITHOUT LOSING THE GRAB: the track stays 10px and the thumb is drawn inside a 2px
    // transparent border, so it READS as a ~6px hairline while remaining a 10px target for a mouse.
    "*::-webkit-scrollbar-thumb": {
      bg: "border.emphasized",
      borderRadius: "full",
      border: "2px solid transparent",
      backgroundClip: "content-box",
    },
    "*::-webkit-scrollbar-thumb:hover": {
      bg: "fg.subtle",
    },
    // The little square where a vertical and a horizontal bar meet — left as the surface, or it is a
    // grey notch in the corner of every scrolling table.
    "*::-webkit-scrollbar-corner": {
      bg: "transparent",
    },
    // THE FALLBACK FOCUS RING (owner). Chakra rings its own components, but a plain `<a>` — every
    // sidebar and menu-sheet link — falls through to the BROWSER's ring, which Chrome draws as a
    // near-black `1px auto` hairline. This gives anything Chakra does not style a ring in the main
    // tone. It is `*`, so its specificity is below every component recipe: a Chakra control keeps its
    // own ring, and only the unstyled elements pick this up.
    "*:focus-visible": {
      // A HAIRLINE, HUGGING THE ELEMENT (owner): 1px against Chakra's 2px, and 1px of offset against
      // its 2px. A thick ring standing off a menu item reads as a selected state rather than as focus.
      outlineWidth: "1px",
      outlineStyle: "solid",
      outlineColor: "brand.focusRing",
      outlineOffset: "1px",
      borderRadius: "l2",
    },
    // The 14px base (the mock's body size) goes on BODY ONLY.
    //
    // ⚠ NEVER GIVE `html` A FONT SIZE. `html` is what `rem` is measured against, so a size there
    // rescales every rem token in the app — spacing, radii, control heights, every heading. This rule
    // used to read `"html, body": { fontSize: "sm" }`, which applied TWICE: html became 14px (so the
    // whole app rendered at 87.5% of every number written in this file) and body became 0.875 × 14 =
    // 12.25px. Labels came out at 9.6px. With html left at the browser's 16px, a value here is the
    // value on screen.
    body: {
      fontSize: "sm",
    },
  },
});

export const system = createSystem(defaultConfig, customConfig);
