import type { PendingList, PendingPart } from "../pending/registry";

// WHAT THE ACCOUNT SCREENS CANNOT DO YET — one list for the domain, because the account dialogs that carry a
// part of it open on more than one page (the accounts list, an account's page). See `features/pending` for the
// four kinds and why a badge's number is its position in this list.

/** One unwired part. The id is also its i18n key (`financialAccounts.pending.<id>`). */
export type PendingId = "archivedOnly" | "otherType";

const PARTS: PendingPart<PendingId>[] = [
  // THE ARCHIVE VIEW LISTS ARCHIVED ACCOUNTS ONLY, AND THE CONTRACT CANNOT (owner: *"apinya bisa filter arsip saja
  // … tapi aku tidak akan mengubah be nya, jadi kasih saja warning unimplemented"*). `FinancialAccountList` has
  // `include_archived`, which ADDS the archived to the active, and nothing that leaves the active out. So the view
  // asks for the first 200 accounts with the archived included and keeps the archived itself — real rows, but
  // counted and paged on screen, and an account past the 200th is missed.
  { id: "archivedOnly", kind: "derived" },

  // TYPE "LAINNYA" (owner: *"tambah jenis lainnya, penyedianya jelas lainnya, no rekening tidak wajib"*,
  // `the-type-decides-the-provider`). New Account offers it, but the contract allows types 1–3 and providers 1–5
  // only, and `checkIdentity` refuses `unknown` — so saving one is refused until the backend allows it. The
  // Storybook stub accepts it (owner: *"kita tidak akan mengubah api apapun"*).
  { id: "otherType", kind: "dropped" },
];

export const FINANCIAL_ACCOUNT_PENDING: PendingList<PendingId> = { ns: "financialAccounts", parts: PARTS };
