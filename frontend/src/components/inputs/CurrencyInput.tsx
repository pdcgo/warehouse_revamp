import { Box, Input, Span } from "@chakra-ui/react";
import type { InputProps } from "@chakra-ui/react";

// Strips everything that is not a digit, then removes leading zeros (#166).
//
// The leading-zero rule is the whole reason this is not a plain `type="number"`. Every money field in
// this app starts at "0", so typing into one produced "020000" — and a person who types 20000 and sees
// 020000 stops trusting the field. Anything that is not a digit goes too: a stray "-" or "e" is not a
// price, and `type="number"` would have silently accepted both.
//
// "" stays "" rather than becoming "0": an empty field is a person who has not typed yet, and filling
// it with a zero on their behalf answers a question they were still thinking about.
export function toDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");

  if (digits === "") return "";

  const trimmed = digits.replace(/^0+/, "");

  // All zeros — "000" and "0" both mean zero, and zero is a legitimate price (a sample, a transfer).
  return trimmed === "" ? "0" : trimmed;
}

// Groups digits the way Indonesian money is written: 20000 → "20.000" (#166).
//
// Deliberately NOT `formatRupiah`, which prefixes "Rp". A prefix inside the VALUE is a character the
// caret has to be walked past and the parser has to strip back off — the "Rp" is drawn beside the
// number instead (see the addon below), so the field still holds nothing but digits.
export function formatDigits(digits: string): string {
  if (digits === "") return "";

  return Number(digits).toLocaleString("id-ID");
}

// With `fraction`, a figure may carry a fraction of a rupiah (the-backend-never-rounds-money — e.g. a draft's platform
// total as the storefront gave it). The RAW value is then "150000.5": digits, at most one "." as the decimal point, so
// `Number(raw)` still parses it. The person types the Indonesian way: dots group, ONE comma starts the fraction, which
// keeps up to 3 places (a-fraction-of-a-rupiah-shows-three-decimals). "150.000," while typing stays "150000." so the
// comma does not vanish under the caret.
export function toDecimalDigits(raw: string): string {
  const comma = raw.indexOf(",");
  const whole = toDigits(comma < 0 ? raw : raw.slice(0, comma));
  if (comma < 0) return whole;

  const fraction = raw.slice(comma + 1).replace(/\D/g, "").slice(0, 3);
  return `${whole === "" ? "0" : whole}.${fraction}`;
}

// formatDecimalDigits is formatDigits for a raw value that may carry a "." fraction: "150000.5" → "150.000,5".
export function formatDecimalDigits(raw: string): string {
  const dot = raw.indexOf(".");
  if (dot < 0) return formatDigits(raw);

  return `${formatDigits(raw.slice(0, dot) || "0")},${raw.slice(dot + 1)}`;
}

export interface CurrencyInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  /** The RAW value — digits only, no separators ("150000.5" with `fraction`). "" means nothing typed yet. */
  value: string;
  /** Receives the RAW digits, never the formatted text. */
  onChange: (value: string) => void;
  /** Accept a fraction of a rupiah after a comma, up to 3 places. Off by default: most money fields are whole. */
  fraction?: boolean;
}

// CurrencyInput is the shared money field (#166): it formats as you type and refuses anything that is
// not a price.
//
// The caller holds RAW DIGITS and never sees a separator — `value` in, `onChange` out, both unformatted
// — so every existing `toRupiah(...)` parse keeps working unchanged. The formatting lives here, which
// is the point: six money fields formatted six ways is how two screens start disagreeing about what
// 20000 looks like.
//
// A TEXT input, not `type="number"`, because "20.000" is not a valid number and the browser would
// clear it. That also loses the spinner arrows, which nobody wants on a price, and the silent
// acceptance of "1e5" and "-3".
// THE "Rp" IS AN ADDON, NOT PART OF THE VALUE (owner): a money field says what it is without the
// label having to, and a number with no unit in front of it is a number somebody has to guess at.
// It is drawn OVER a bare `<Input>` — the same trick PasswordInput and DatePicker use — because
// wrapping the input in Chakra's `InputGroup` would sever the surrounding Field's label/required/
// aria wiring. `pointerEvents="none"` keeps the click going to the field under it.
//
// A PLACEHOLDER OF "0" BY DEFAULT (owner, `a-money-field-shows-0-until-typed`): an empty money field
// reads as "Rp 0" in the quiet placeholder ink, so it says it holds an amount — while the VALUE stays ""
// and nothing is answered on the person's behalf (see `toDigits`). A caller may still pass its own.
export const description =
  "Money field with an \"Rp\" addon that formats as you type (20000 → 20.000, id-ID grouping) and drops leading zeros. Shows a \"0\" placeholder until something is typed. The caller holds raw digits and never sees the prefix or a separator.";

export function CurrencyInput({ value, onChange, placeholder = "0", fraction = false, ...rest }: CurrencyInputProps) {
  return (
    <Box position="relative" w="full">
      <Span
        position="absolute"
        insetStart="2.5"
        top="50%"
        transform="translateY(-50%)"
        color="fg.muted"
        pointerEvents="none"
        userSelect="none"
        data-testid="currency-input-addon"
      >
        Rp
      </Span>
      <Input
        {...rest}
        placeholder={placeholder}
        // inputMode brings up the numeric keypad on a phone without the type="number" behaviour that
        // would reject the grouped text.
        inputMode={fraction ? "decimal" : "numeric"}
        value={fraction ? formatDecimalDigits(value) : formatDigits(value)}
        onChange={(e) => onChange(fraction ? toDecimalDigits(e.target.value) : toDigits(e.target.value))}
        // Room for the addon. After the spread, so a caller cannot reclaim the space and leave the
        // digits sitting under the "Rp".
        ps="2.5rem"
      />
    </Box>
  );
}
