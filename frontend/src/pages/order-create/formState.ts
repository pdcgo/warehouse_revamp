import type { Dispatch } from "react";

import type { orderClient } from "../../api/clients";
import type { AddressValue } from "../../components/customers/AddressPicker";
import { emptyAddress } from "../../components/customers/AddressPicker";
import type { MarketplaceInfoValue } from "../../components/orders/MarketplaceInfoForm";
import { emptyMarketplaceInfo } from "../../components/orders/MarketplaceInfoForm";
import type { ReceiptValue } from "../../components/orders/ReceiptUpload";
import { emptyReceipt, hasReceipt } from "../../components/orders/ReceiptUpload";
import type { PickedProduct } from "../../components/products/ProductSelect";
import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";
import { unixToDateTimeInput } from "../../lib/datetime";
import type { BundleDraft, PickedBundle } from "../../features/orders/form/bundles";
import { bundleFor, fillFor } from "../../features/orders/form/bundles";
import type { CheckFinding, ReceiptScan } from "../../features/orders/form/checks";
import { applyScan } from "../../features/orders/form/checks";
import type { DuplicateFinding } from "../../features/orders/form/duplicateRef";
import type { LineDraft } from "../../features/orders/lines";
import { lineFor, toRupiah } from "../../features/orders/lines";
import type { TakeRefusal } from "../../features/orders/takeRefusal";
import { addressOf } from "./draftAddress";

// THE ORDER FORM'S STATE — ONE REDUCER (no-global-store-every-read-is-a-query-hook: *"a form with many fields keeps its
// state in a reducer"*). What the person is typing, what the receipt file said, which reads the form has already taken
// its seed from, and where Create stands — every one of them a field below, changed only by an action of this module.
//
// What is NOT here, on purpose: the server's data (each read is a query hook — the draft, the preset product, the team's
// default, the stock quote, the owners, the credit), the DOM (`lockRef`, the fieldset's `inert`), the tab-close guard
// (an effect on `locked`), and the two pure screen toggles — the rail's compact switch and the delete-draft confirm.
//
// SEEDED ONCE (the-draft-opens-in-the-order-form, a-product-page-opens-the-order-and-restock-forms, #145): a draft, a
// product opened from its page and the team's default warehouse each fill the form ONCE — the action records what it
// took (`seededDraft`, `seededPreset`, `filledDefaultFor`) and the next answer of the same read is ignored, so a re-read
// never puts anything back over what the person typed. A receipt file is read once per file it is attached as, and
// fills only what is still empty (`scanned`).

/** What the order is filled from — its own lines, or bundles — and never both (an-order-holds-items-or-bundles). */
export type OrderContents = "items" | "bundles";

/** What Create sends, minus its key — frozen in `sent` on every Create, so Try Again resends exactly this. */
export type OrderRequest = Omit<
  // The plain-object half of the request's init shape (not a built message), as the form writes it.
  Exclude<Parameters<typeof orderClient.orderCreate>[0], { $typeName: string }>,
  "idempotencyKey"
> & {
  teamId: bigint;
  shopId: bigint;
  orderExternalRefId: string;
  orderDraftId: bigint;
};

/**
 * The form lock (the-form-locks-until-it-is-answered, no-answer-is-only-a-lost-connection): from the moment Create
 * sends, the form is LOCKED on what was sent until an answer comes back. `waiting` — the request is open, with no time
 * limit; `noAnswer` — the connection dropped with no reply, and the form stays locked on it, offering Try Again.
 */
export interface SentRequest {
  phase: "waiting" | "noAnswer";
  request: OrderRequest;
}

export interface OrderForm {
  // ── what the order says ──────────────────────────────────────────────────────────────────────────────────────────
  customerName: string;
  customerPhone: string;
  address: AddressValue;
  /**
   * The marketplace side of the order — WHICH storefront sold it, and what THAT storefront calls it (and the sell
   * price). One piece of state because they are one fact: a shop with no reference cannot be looked up again, and a
   * reference with no shop has nowhere to be looked up in.
   */
  marketplace: MarketplaceInfoValue;
  /**
   * Which warehouse fulfils this order (#72). REQUIRED: from #69 the order takes its stock out of this warehouse the
   * moment it is placed, so the form cannot submit without one.
   *
   * Pre-filled from the team's configured default (#145), which is not the same as guessing. A default the SYSTEM
   * invents would move real goods out of the wrong building; a default the TEAM configured is the team stating where it
   * ships from, and it stays visible and changeable on every order. The server also still refuses an order that names
   * no warehouse, so nothing here can let one through.
   */
  warehouseId: bigint;
  /**
   * The courier — a shipment channel id (shipment-channel-is-an-id-into-shipment-service). 0n = none picked; the server
   * refuses an order without one (no-order-without-a-courier).
   */
  shipmentChannelId: bigint;
  /** The resi as TEXT — the number the buyer is given, beside the courier and the file it is printed on. Sent as
   * `receipt_code`, the order's own field for it. */
  receiptCode: string;
  /**
   * The shipping receipt — the courier's slip photographed, or the marketplace's PDF (owner). What is held here is a
   * REFERENCE to a document already uploaded, never the file: the bytes went straight to storage the moment it was
   * picked, so submitting the order writes three short strings.
   */
  receipt: ReceiptValue;
  /**
   * Whatever the person taking the order needs the next person to know (owner). Free text on purpose: "deliver after
   * 5pm", "wrap the glass one", "second attempt, the first parcel came back" are instructions to a HUMAN, and no
   * dropdown ever fits the case actually in front of them.
   */
  note: string;
  /**
   * Starts EMPTY, not with a blank line. Lines arrive by picking products, so a placeholder row with no product would be
   * a row you cannot remove and cannot use — the same conclusion the restock form reached (#165). The Create button is
   * what refuses an order with nothing on it.
   */
  lines: LineDraft[];
  /** The bundles added — their products ARE placed, as ordinary lines (the page's `allLines`); only the grouping is lost. */
  bundles: BundleDraft[];
  /**
   * ITEMS OR BUNDLES, NEVER BOTH (owner: *"order create items dan bundle cuma boleh pilih salah satu"*,
   * `an-order-holds-items-or-bundles`) — one radio pill chooses which card the order is filled from. Items first: a
   * draft seeds items, and most orders are typed line by line.
   */
  contents: OrderContents;
  /**
   * WHEN THE ORDER HAPPENED — and it starts EMPTY (owner).
   *
   * ⚠ NO DEFAULT OF TODAY. It was pre-filled with now, on the argument that most orders are typed in as they come; the
   * trouble is that a date nobody chose is indistinguishable from one somebody did, so every order typed a day late
   * carries a wrong date that looks deliberate. An empty field asks the question; a filled one answers it on the
   * person's behalf and is never revisited.
   */
  orderDate: string;
  deadline: string;
  buyerUsername: string;

  // ── the receipt file, and what it says ───────────────────────────────────────────────────────────────────────────
  /**
   * THE FILE ITSELF, held only while its numbers are read (receipt-check-takes-the-file-bytes). The order keeps the
   * document reference above; the bytes are read from HERE, beside the upload, never from storage — so the check starts
   * the moment the file is picked.
   */
  receiptFile: File | null;
  /**
   * WHAT THE RECEIPT FILE SAYS (owner, rule 1) — read once per attached file and kept, because it is used twice: to
   * fill what is still empty, and to question what was typed when Create is pressed.
   */
  scan: ReceiptScan | null;
  /** Whether that read filled a box — the card says so, since a box that filled itself looks like a typed one. */
  filledFromFile: boolean;

  // ── what the form was seeded from, once ──────────────────────────────────────────────────────────────────────────
  /** The draft (`?draft=`) the form took its seed from — "" until it has. */
  seededDraft: string;
  /** The product (`?product=`) the form took its first line from — "" until it has. */
  seededPreset: string;
  /** The team whose default-warehouse answer the form took — "" until it has. */
  filledDefaultFor: string;
  /** What the form held right after it was seeded — the leave-guard's "nothing changed" on a draft or a preset. */
  seedSignature: string | null;

  // ── items or bundles ─────────────────────────────────────────────────────────────────────────────────────────────
  /** Leaving a card that already holds something asks first, because the switch empties it — null = no confirm open. */
  switchingTo: OrderContents | null;

  // ── Create ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The duplicate-ref lookup is running — Create stays busy, so a second press cannot start a second one. */
  checkingRef: boolean;
  /** WHAT THE DUPLICATE-REF CHECK FOUND on the last Create (a-duplicate-ref-is-warned-not-refused) — null = closed. */
  duplicate: DuplicateFinding | null;
  /** What the checks found on the last attempt to place. Empty = the dialog is closed. */
  gate: CheckFinding[];
  sent: SentRequest | null;
  /** What Try Again's re-check found (a-try-again-always-warns) — null = its warning is closed. */
  retry: DuplicateFinding | null;
  error: string;
  /**
   * WHY THE WAREHOUSE REFUSED THE LAST CREATE, when it did (a-refusal-names-its-reason-and-every-line) — kept apart from
   * `error` because it is not a sentence to print but a reason and the lines it names, each one a line on this form the
   * person has to change.
   */
  refusal: TakeRefusal | null;
}

/** The fields an input sets as they are — no rule rides on them. */
type PlainField =
  | "customerName"
  | "customerPhone"
  | "address"
  | "marketplace"
  | "warehouseId"
  | "shipmentChannelId"
  | "receiptCode"
  | "note"
  | "orderDate"
  | "deadline"
  | "buyerUsername"
  | "checkingRef"
  | "duplicate"
  | "gate"
  | "retry";

type SetAction = { [K in PlainField]: { type: "set"; field: K; value: OrderForm[K] } }[PlainField];

export type OrderFormAction =
  | SetAction
  | { type: "marketplacePatch"; patch: Partial<MarketplaceInfoValue> }
  // the receipt file
  | { type: "receipt"; value: ReceiptValue }
  | { type: "receiptFile"; file: File | null }
  | { type: "scanned"; file: File; found: ReceiptScan }
  // the lines
  | { type: "pickProducts"; products: PickedProduct[] }
  | { type: "patchLine"; productId: bigint; patch: Partial<LineDraft> }
  | { type: "removeLine"; productId: bigint }
  // the bundles
  | { type: "addBundle"; picked: PickedBundle }
  | { type: "bundleQuantity"; key: string; quantity: string }
  | { type: "removeBundle"; key: string }
  | { type: "fillSlot"; key: string; slotId: string; products: PickedProduct[] }
  | { type: "fillQuantity"; key: string; slotId: string; productId: bigint; quantity: string }
  // items or bundles
  | { type: "chooseContents"; next: OrderContents }
  | { type: "confirmSwitch" }
  | { type: "cancelSwitch" }
  // seeded once
  | { type: "seedDraft"; draft: OrderDraft }
  | { type: "seedPreset"; productId: bigint; product: PickedProduct; quantity: string }
  | { type: "defaultWarehouse"; teamId: bigint; preferred: bigint }
  // Create
  | { type: "send"; request: OrderRequest }
  | { type: "noAnswer"; request: OrderRequest }
  | { type: "answered"; refusal: TakeRefusal | null; error: string }
  | { type: "goBackFromRetry" };

/**
 * The form as it opens. The warehouse is the one field that may start filled: a product page's warehouse lens, when it
 * opened the form with one (a-product-page-opens-the-order-and-restock-forms) — set before the team's default arrives,
 * so the default (which only fills an untouched field) leaves it alone. Never on a draft, which seeds its own.
 */
export function initialOrderForm(opening: { warehouseId: bigint }): OrderForm {
  return {
    customerName: "",
    customerPhone: "",
    address: emptyAddress,
    marketplace: emptyMarketplaceInfo,
    warehouseId: opening.warehouseId,
    shipmentChannelId: 0n,
    receiptCode: "",
    receipt: emptyReceipt,
    note: "",
    lines: [],
    bundles: [],
    contents: "items",
    orderDate: "",
    deadline: "",
    buyerUsername: "",
    receiptFile: null,
    scan: null,
    filledFromFile: false,
    seededDraft: "",
    seededPreset: "",
    filledDefaultFor: "",
    seedSignature: null,
    switchingTo: null,
    checkingRef: false,
    duplicate: null,
    gate: [],
    sent: null,
    retry: null,
    error: "",
    refusal: null,
  };
}

// The source of a HAND-WRITTEN draft — one saved from this form before Save as Draft was removed
// (a-draft-becomes-an-order-through-order-create); every other draft names the app that pushed it. Its reference is
// ours, no marketplace's, so it is not copied into the order's ref (a manual draft has its ref typed).
export const DRAFT_SOURCE = "manual";

// The address is OPTIONAL (#118) — exactly as the free text it replaces was: an order can be taken
// before the address is known. An untouched picker sends NOTHING rather than a message full of empty
// strings, so "no address" stays distinguishable from "an address of blanks".
export function addressTouched(a: AddressValue): boolean {
  return Object.values(a).some((v) => v.trim() !== "");
}

// Everything the leave-guard counts as WORK, as one comparable string. On a draft the form opens already filled, so
// "dirty" means changed since it was seeded, not merely non-empty — leaving a draft untouched loses nothing (the draft
// is still on the list), and must not ask whether to discard it.
interface WorkFields {
  customerName: string;
  customerPhone: string;
  shopId: bigint;
  orderRef: string;
  shipmentChannelId: string;
  note: string;
  receipt: boolean;
  address: AddressValue;
  platformTotal: string;
  lines: LineDraft[];
  bundles: number;
  receiptCode: string;
  orderDate: string;
  deadline: string;
  buyerUsername: string;
}

function workSignature(w: WorkFields): string {
  return JSON.stringify({ ...w, lines: w.lines.map((l) => [l.productId, l.quantity]) }, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/** The form's work as it stands — compared with `seedSignature` on a seeded form. */
export function workOf(s: OrderForm): string {
  return workSignature({
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    shopId: s.marketplace.shopId,
    orderRef: s.marketplace.orderExternalRefId,
    shipmentChannelId: s.shipmentChannelId.toString(),
    note: s.note,
    receipt: hasReceipt(s.receipt),
    address: s.address,
    platformTotal: s.marketplace.platformTotal,
    lines: s.lines,
    bundles: s.bundles.length,
    receiptCode: s.receiptCode,
    orderDate: s.orderDate,
    deadline: s.deadline,
    buyerUsername: s.buyerUsername,
  });
}

/**
 * Whether leaving needs a confirmation. A form opened from a draft or a product's page is dirty once it differs from
 * what it was seeded with (and never before its seed landed); a blank form once anything at all is typed — the
 * warehouse excluded, because it arrives PRE-FILLED and a page nobody has touched must not claim unsaved work.
 */
export function isDirty(s: OrderForm, seeded: boolean): boolean {
  if (seeded) return s.seedSignature !== null && workOf(s) !== s.seedSignature;

  return (
    s.customerName.trim() !== "" ||
    s.customerPhone.trim() !== "" ||
    s.marketplace.shopId > 0n ||
    s.marketplace.orderExternalRefId.trim() !== "" ||
    s.shipmentChannelId > 0n ||
    s.note.trim() !== "" ||
    hasReceipt(s.receipt) ||
    addressTouched(s.address) ||
    toRupiah(s.marketplace.platformTotal) > 0 ||
    s.lines.length > 0 ||
    // The cards that do not submit are still WORK: somebody who typed a deadline and a tracking
    // number has something to lose, whether or not the server will ever see it.
    s.bundles.length > 0 ||
    s.receiptCode.trim() !== "" ||
    s.orderDate !== "" ||
    s.deadline !== "" ||
    s.buyerUsername.trim() !== ""
  );
}

export function orderFormReducer(state: OrderForm, action: OrderFormAction): OrderForm {
  switch (action.type) {
    case "set":
      // The same value is no change — as a `useState` setter, so an input that reports what it already holds draws
      // nothing.
      return Object.is(state[action.field], action.value) ? state : { ...state, [action.field]: action.value };

    case "marketplacePatch":
      return { ...state, marketplace: { ...state.marketplace, ...action.patch } };

    // ── The receipt file ────────────────────────────────────────────────────────────────────────────────────────────

    case "receipt":
      if (hasReceipt(action.value)) {
        return Object.is(action.value, state.receipt) ? state : { ...state, receipt: action.value };
      }
      // Removed: what the file said leaves with it. (Numbers it already filled stay — they are in the boxes now, and a
      // person may have checked them against the paper.)
      if (Object.is(action.value, state.receipt) && state.receiptFile === null) return state;

      return { ...state, receipt: action.value, receiptFile: null, scan: null, filledFromFile: false };

    case "receiptFile":
      // The same file reported again keeps what it said; a new file is a new answer — the last file's notice must not
      // stand beside this one while it is read.
      if (action.file === state.receiptFile) return state;

      return { ...state, receiptFile: action.file, scan: null, filledFromFile: false };

    case "scanned": {
      // ⚠ IT FILLS ONLY WHAT IS EMPTY (owner): a machine reading a photograph does not get to overwrite what a person
      // typed — `applyScan` leaves a filled box alone, and the disagreement is raised at Create instead. A read of a
      // file no longer attached fills nothing.
      if (action.file !== state.receiptFile) return state;

      const now = { orderRefId: state.marketplace.orderExternalRefId, trackingCode: state.receiptCode };
      const filled = applyScan(action.found, now);
      const refFilled = filled.orderRefId !== now.orderRefId;
      const codeFilled = filled.trackingCode !== now.trackingCode;

      return {
        ...state,
        scan: action.found,
        marketplace: refFilled ? { ...state.marketplace, orderExternalRefId: filled.orderRefId } : state.marketplace,
        receiptCode: filled.trackingCode,
        filledFromFile: refFilled || codeFilled,
      };
    }

    // ── The lines ───────────────────────────────────────────────────────────────────────────────────────────────────

    case "pickProducts": {
      // The picker hands back the WHOLE ticked set, so this RECONCILES — it does not append (#165). A product that is
      // still ticked keeps the line it already had, with the quantity typed into it; rebuilding the list from the
      // picked set would silently reset every number the next time somebody opened the picker to add one more.
      const ticked = new Set(action.products.map((p) => p.id.toString()));
      const kept = state.lines.filter((l) => ticked.has(l.productId.toString()));
      const known = new Set(kept.map((l) => l.productId.toString()));
      const added = action.products.filter((p) => !known.has(p.id.toString())).map(lineFor);

      return { ...state, lines: [...kept, ...added] };
    }

    case "patchLine":
      return {
        ...state,
        lines: state.lines.map((l) => (l.productId === action.productId ? { ...l, ...action.patch } : l)),
      };

    case "removeLine":
      // Dropping ONE product without opening the dialog. Unticking it in the picker does the same thing — they are the
      // same edit, because the picker's ticks are derived from these lines rather than held separately.
      return { ...state, lines: state.lines.filter((l) => l.productId !== action.productId) };

    // ── The bundles ─────────────────────────────────────────────────────────────────────────────────────────────────

    case "addBundle":
      // A key per ADDED bundle: the same bundle can sit on one order twice, at different quantities.
      return {
        ...state,
        bundles: [...state.bundles, bundleFor(action.picked, `${action.picked.id}-${state.bundles.length + 1}`)],
      };

    case "bundleQuantity":
      return {
        ...state,
        bundles: state.bundles.map((b) => (b.key === action.key ? { ...b, quantity: action.quantity } : b)),
      };

    case "removeBundle":
      return { ...state, bundles: state.bundles.filter((b) => b.key !== action.key) };

    case "fillSlot":
      // Filling a slot is the same reconcile as picking lines: the picker's ticked set IS the slot.
      return {
        ...state,
        bundles: state.bundles.map((bundle) => {
          if (bundle.key !== action.key) return bundle;

          return {
            ...bundle,
            slots: bundle.slots.map((slot) => {
              if (slot.id !== action.slotId) return slot;

              const ticked = new Set(action.products.map((p) => p.id.toString()));
              const kept = slot.fills.filter((f) => ticked.has(f.productId.toString()));
              const known = new Set(kept.map((f) => f.productId.toString()));
              const added = action.products
                .filter((p) => !known.has(p.id.toString()))
                .map((p) => fillFor(p, slot.ruleQty));

              return { ...slot, fills: [...kept, ...added] };
            }),
          };
        }),
      };

    case "fillQuantity":
      return {
        ...state,
        bundles: state.bundles.map((bundle) =>
          bundle.key === action.key
            ? {
                ...bundle,
                slots: bundle.slots.map((slot) =>
                  slot.id === action.slotId
                    ? {
                        ...slot,
                        fills: slot.fills.map((f) =>
                          f.productId === action.productId ? { ...f, quantity: action.quantity } : f,
                        ),
                      }
                    : slot,
                ),
              }
            : bundle,
        ),
      };

    // ── Items or bundles ────────────────────────────────────────────────────────────────────────────────────────────
    //
    // A switch from an empty card is immediate; from one that holds lines or bundles it waits for the confirm, which
    // then empties the card being left — an order never carries both (an-order-holds-items-or-bundles).

    case "chooseContents": {
      if (action.next === state.contents) return state;

      const holding = state.contents === "items" ? state.lines.length : state.bundles.length;
      if (holding > 0) return { ...state, switchingTo: action.next };

      return { ...state, contents: action.next };
    }

    case "confirmSwitch":
      if (state.switchingTo === null) return state;

      return {
        ...state,
        lines: state.contents === "items" ? [] : state.lines,
        bundles: state.contents === "items" ? state.bundles : [],
        contents: state.switchingTo,
        switchingTo: null,
      };

    case "cancelSwitch":
      return state.switchingTo === null ? state : { ...state, switchingTo: null };

    // ── Seeded once ─────────────────────────────────────────────────────────────────────────────────────────────────

    case "seedDraft":
      return seedFromDraft(state, action.draft);

    case "seedPreset": {
      // SEED FROM THE PRODUCT'S PAGE, once — the product as the first line, at the quantity chosen there, as a pick would
      // add it. After this the form is the person's; its "nothing changed" is the form as seeded, so leaving untouched
      // asks nothing.
      const id = action.productId.toString();
      if (state.seededPreset === id) return state;

      const seeded = { ...state, seededPreset: id, lines: [{ ...lineFor(action.product), quantity: action.quantity }] };

      return { ...seeded, seedSignature: workOf(seeded) };
    }

    case "defaultWarehouse": {
      // The team's configured default (#145), ONE SHOT per team: the first answer given since the form opened is taken,
      // and it only ever fills an UNTOUCHED field — an answer arriving after somebody picked one must not overwrite
      // them, and a later answer never puts a default back. No default (0n) fills nothing and is still the answer.
      const id = action.teamId.toString();
      if (state.filledDefaultFor === id) return state;

      const fill = action.preferred !== 0n && state.warehouseId === 0n;

      return { ...state, filledDefaultFor: id, warehouseId: fill ? action.preferred : state.warehouseId };
    }

    // ── Create ──────────────────────────────────────────────────────────────────────────────────────────────────────

    case "send":
      // ONE SEND — Create's, and every Try Again's: the form locks on the frozen request, and the last answer's notices
      // go.
      return { ...state, retry: null, error: "", refusal: null, sent: { phase: "waiting", request: action.request } };

    case "noAnswer":
      // NOTHING CAME BACK — the form stays locked on what was sent, and the person decides (Try Again).
      return { ...state, sent: { phase: "noAnswer", request: action.request } };

    case "answered":
      // THE SERVER ANSWERED: the form is the person's again, exactly as typed — with the warehouse's refusal (naming
      // the lines) or the error's sentence.
      return action.refusal
        ? { ...state, sent: null, refusal: action.refusal }
        : { ...state, sent: null, error: action.error };

    case "goBackFromRetry":
      // GO BACK from Try Again's warning: the form is the person's again — as it was sent.
      return { ...state, retry: null, sent: null };
  }
}

// SEED FROM THE DRAFT, once per draft — after this the form is the person's. The draft's warehouse wins over the team's
// default: the app read where this order ships from. A draft the app pushed carries the marketplace's own order id;
// one saved from this form carries a reference of ours, which is no marketplace's and is not copied.
function seedFromDraft(state: OrderForm, draft: OrderDraft): OrderForm {
  const id = draft.id.toString();
  if (state.seededDraft === id) return state;

  const orderRef = draft.source !== DRAFT_SOURCE ? draft.externalId : "";
  // What the buyer paid — the draft's own `platform_total` (the-draft-price-is-platform-total); when the app sent none,
  // the rows' prices summed (`the-draft-sell-price-starts-from-the-rows`). The CS may type over it either way.
  const scraped = draft.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  // ⚠ The draft's figure and the rows' prices are doubles since selling 00041/00042, kept EXACT
  // (a-draft-keeps-its-platform-total-as-typed, the-backend-never-rounds-money): the seed is the figure itself, a
  // fraction included, and the order places exactly that.
  const seededTotal = draft.platformTotal > 0 ? draft.platformTotal : scraped;
  const platformTotal = Number.isFinite(seededTotal) && seededTotal > 0 ? String(seededTotal) : "";
  // The platform's own dates and the buyer's username, as the app pushed them — empty when it sent none.
  const orderDate = draft.platformCreatedAtUnix > 0n ? unixToDateTimeInput(draft.platformCreatedAtUnix) : "";
  const deadline =
    draft.platformShipmentDeadlineUnix > 0n ? unixToDateTimeInput(draft.platformShipmentDeadlineUnix) : "";
  const address = addressOf(draft);
  // NO LINE IS SEEDED: a draft stores no mapping (a-draft-stores-no-mapping) — its scraped lines are the text above the
  // products, and the person picks ours.
  const lines: LineDraft[] = [];

  return {
    ...state,
    seededDraft: id,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    address,
    shipmentChannelId: draft.shipmentChannelId,
    marketplace: { ...state.marketplace, shopId: draft.shopId, orderExternalRefId: orderRef, platformTotal },
    orderDate,
    deadline,
    buyerUsername: draft.buyerUsername,
    warehouseId: draft.warehouseId > 0n ? draft.warehouseId : state.warehouseId,
    lines,
    // ⚠ The signature is the DRAFT's, not the form's: what was attached or typed before the draft arrived is work.
    seedSignature: workSignature({
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      shopId: draft.shopId,
      orderRef,
      shipmentChannelId: draft.shipmentChannelId.toString(),
      note: "",
      receipt: false,
      address,
      platformTotal,
      lines,
      bundles: 0,
      receiptCode: "",
      orderDate,
      deadline,
      buyerUsername: draft.buyerUsername,
    }),
  };
}

/**
 * The form's setters, each a STABLE function over `dispatch` — built once per page (`useMemo`), so an input's
 * `onChange` is the same function on every render, as the `useState` setters it replaces were.
 */
export function orderFormActions(dispatch: Dispatch<OrderFormAction>) {
  return {
    customerName: (value: string) => dispatch({ type: "set", field: "customerName", value }),
    customerPhone: (value: string) => dispatch({ type: "set", field: "customerPhone", value }),
    address: (value: AddressValue) => dispatch({ type: "set", field: "address", value }),
    marketplace: (value: MarketplaceInfoValue) => dispatch({ type: "set", field: "marketplace", value }),
    orderRef: (orderExternalRefId: string) => dispatch({ type: "marketplacePatch", patch: { orderExternalRefId } }),
    sellPrice: (platformTotal: string) => dispatch({ type: "marketplacePatch", patch: { platformTotal } }),
    warehouseId: (value: bigint) => dispatch({ type: "set", field: "warehouseId", value }),
    shipmentChannelId: (value: bigint) => dispatch({ type: "set", field: "shipmentChannelId", value }),
    receiptCode: (value: string) => dispatch({ type: "set", field: "receiptCode", value }),
    note: (value: string) => dispatch({ type: "set", field: "note", value }),
    orderDate: (value: string) => dispatch({ type: "set", field: "orderDate", value }),
    deadline: (value: string) => dispatch({ type: "set", field: "deadline", value }),
    buyerUsername: (value: string) => dispatch({ type: "set", field: "buyerUsername", value }),
    receipt: (value: ReceiptValue) => dispatch({ type: "receipt", value }),
    receiptFile: (file: File | null) => dispatch({ type: "receiptFile", file }),
    pickProducts: (products: PickedProduct[]) => dispatch({ type: "pickProducts", products }),
    patchLine: (productId: bigint, patch: Partial<LineDraft>) => dispatch({ type: "patchLine", productId, patch }),
    removeLine: (productId: bigint) => dispatch({ type: "removeLine", productId }),
    addBundle: (picked: PickedBundle) => dispatch({ type: "addBundle", picked }),
    bundleQuantity: (key: string, quantity: string) => dispatch({ type: "bundleQuantity", key, quantity }),
    removeBundle: (key: string) => dispatch({ type: "removeBundle", key }),
    fillSlot: (key: string, slotId: string, products: PickedProduct[]) =>
      dispatch({ type: "fillSlot", key, slotId, products }),
    fillQuantity: (key: string, slotId: string, productId: bigint, quantity: string) =>
      dispatch({ type: "fillQuantity", key, slotId, productId, quantity }),
    chooseContents: (next: OrderContents) => dispatch({ type: "chooseContents", next }),
    confirmSwitch: async () => dispatch({ type: "confirmSwitch" }),
    cancelSwitch: () => dispatch({ type: "cancelSwitch" }),
  };
}
