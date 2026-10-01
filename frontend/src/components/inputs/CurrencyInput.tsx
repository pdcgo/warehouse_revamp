import { Input } from "@chakra-ui/react";
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
// Deliberately NOT `formatRupiah`, which prefixes "Rp". A prefix inside an input is a character the
// caret has to be walked past and the parser has to strip back off, so the label says Rupiah and the
// field holds the number.
export function formatDigits(digits: string): string {
  if (digits === "") return "";

  return Number(digits).toLocaleString("id-ID");
}

export interface CurrencyInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
  /** The RAW value — digits only, no separators. "" means nothing typed yet. */
  value: string;
  /** Receives the RAW digits, never the formatted text. */
  onChange: (value: string) => void;
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
export const description =
  "Money field that formats as you type (20000 → 20.000, id-ID grouping) and drops leading zeros. The caller holds raw digits and never sees a separator.";

export function CurrencyInput({ value, onChange, ...rest }: CurrencyInputProps) {
  return (
    <Input
      {...rest}
      // inputMode brings up the numeric keypad on a phone without the type="number" behaviour that
      // would reject the grouped text.
      inputMode="numeric"
      value={formatDigits(value)}
      onChange={(e) => onChange(toDigits(e.target.value))}
    />
  );
}
