import { formatRupiah } from "../../lib/money";

// ⚠ DIRECTION IS WORDS, NEVER A SIGN — the one rule this whole screen is built around (#185).
//
// The data keeps one signed convention (receivable positive, payable negative) because arithmetic
// needs it. A READER does not: "−180.000" makes somebody decode a minus sign into a direction, and
// the answer they get wrong is which way the money goes. So nothing on these screens ever renders a
// bare negative — the sign is turned into a sentence here, once, and every screen uses it.
//
// Kept in its own file rather than inline for the same reason `draftReadiness.ts` is: two screens ask
// this (the position list and the counterparty detail header), and answering it twice is how they
// start disagreeing about what a minus sign meant.
export type Direction = "they-owe-you" | "you-owe-them" | "square";

export function directionOf(balance: bigint): Direction {
  if (balance > 0n) {
    return "they-owe-you";
  }

  if (balance < 0n) {
    return "you-owe-them";
  }

  return "square";
}

// The i18n key for the sentence, and the absolute amount to interpolate into it. `abs` is computed
// HERE and used only for display — it is never stored, never returned by an API, and never sits in a
// field beside the signed one, because two fields that disagree in sign is a bug that reaches the
// screen.
export function directionCopy(balance: bigint): { key: string; amount: string } {
  const abs = balance < 0n ? -balance : balance;

  switch (directionOf(balance)) {
    case "they-owe-you":
      return { key: "settlement.theyOweYou", amount: formatRupiah(abs) };
    case "you-owe-them":
      return { key: "settlement.youOweThem", amount: formatRupiah(abs) };
    default:
      return { key: "settlement.square", amount: formatRupiah(0n) };
  }
}

// Green when money is coming to you, orange when it is going out, grey when square. Colour SUPPORTS
// the words; it never replaces them — a colour-blind reader gets the sentence either way.
export function directionPalette(balance: bigint): string {
  switch (directionOf(balance)) {
    case "they-owe-you":
      return "green";
    case "you-owe-them":
      return "orange";
    default:
      return "gray";
  }
}

// Whole days since a unix timestamp, in the READER'S timezone — which is why the server sends a
// timestamp and not a day count. A rollup computed on the server silently shifts when the server
// moves; this one is computed where the person reading it lives.
export function daysSince(unix: bigint, now: Date = new Date()): number {
  if (unix === 0n) {
    return 0;
  }

  const then = new Date(Number(unix) * 1000);
  const ms = now.getTime() - then.getTime();

  return Math.max(0, Math.floor(ms / 86_400_000));
}
