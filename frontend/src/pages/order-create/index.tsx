import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Field,
  Flex,
  Grid,
  GridItem,
  Heading,
  Icon,
  IconButton,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { rpcError, teamClient } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useCreateOrder } from "../../features/orders/queries";
import { useOrderDraft } from "../../features/orderDrafts/queries";
import { useStockTakeQuote } from "../../features/inventory/queries";
import {
  MarketplaceInfoForm,
  emptyMarketplaceInfo,
} from "../../components/orders/MarketplaceInfoForm";
import type { MarketplaceInfoValue } from "../../components/orders/MarketplaceInfoForm";
import { OrderItemCard } from "../../components/orders/OrderItemCard";
import { ProductListExternal } from "../../components/products/ProductListExternal";
import type { ExternalProduct } from "../../components/products/ProductListExternal";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { emptyAddress } from "../../components/customers/AddressPicker";
import type { AddressValue } from "../../components/customers/AddressPicker";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { DatePicker } from "../../components/datetime/DatePicker";
import { dateTimeInputToUnix, todayDateInput } from "../../lib/datetime";
import { useProductsByIds } from "../../features/products/queries";
import { useTeams } from "../../features/teams/queries";
import type { BundleDraft } from "../../features/orders/form/bundles";
import { type PickedBundle, bundleFor, bundleLines, fillFor } from "../../features/orders/form/bundles";
import { useWarehouseFeeQuote } from "../../features/warehouse/queries";
import { BundleCard } from "../../features/orders/form/BundleCard";
import { CreditLimitPanel } from "../../features/orders/form/CreditLimitPanel";
import type { CreditRow } from "../../features/orders/form/CreditLimitPanel";
import { creditReadOf, creditRows, creditorIds, goodsCostOf, invoiceRows } from "../../features/orders/form/money";
import { useLiabilityCredit } from "../../features/liability/queries";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ORDER_FORM_PENDING } from "../../features/orders/form/pending";
import { NoteAndSubmitCard } from "../../features/orders/form/NoteAndSubmitCard";
import { ProfitEstimatePanel } from "../../features/orders/form/ProfitEstimatePanel";
import { ReturnMappingCard } from "../../features/orders/form/ReturnMappingCard";
import type { CrossLine } from "../../features/orders/form/ReturnMappingCard";
import { useReturnMapping } from "../../features/orders/form/returnMapping";
import { ShippingReceiptCard } from "../../features/orders/form/ShippingReceiptCard";
import { WarehouseBand } from "../../features/orders/form/WarehouseBand";
import { OrderChecksDialog } from "../../features/orders/form/OrderChecksDialog";
import type { CheckFinding, ReceiptScan } from "../../features/orders/form/checks";
import { applyScan, runOrderChecks, scanReceipt, suggestMarketplace } from "../../features/orders/form/checks";
import { MarketplaceBadge, marketplaceLabel } from "../../components/badges/MarketplaceBadge";
import { ExtraInfoCard } from "../../features/orders/form/ExtraInfoCard";
import { TotalsInvoicePanel } from "../../features/orders/form/TotalsInvoicePanel";
import type { InvoiceRow } from "../../features/orders/form/TotalsInvoicePanel";
import { toaster } from "../../components/feedback/Toaster";
import { CustomerInfoForm } from "../../components/customers/CustomerInfoForm";
import { emptyReceipt, hasReceipt } from "../../components/orders/ReceiptUpload";
import type { ReceiptValue } from "../../components/orders/ReceiptUpload";
import type { LineDraft } from "../../features/orders/lines";
import { TakeRefusalAlert } from "../../features/orders/TakeRefusalAlert";
import { type TakeRefusal, takeRefusalOf } from "../../features/orders/takeRefusal";
import {
  availabilityOf,
  byProduct,
  canSubmit,
  lineFor,
  lineStock,
  toQty,
  toRupiah,
} from "../../features/orders/lines";

// The address is OPTIONAL (#118) — exactly as the free text it replaces was: an order can be taken
// before the address is known. An untouched picker sends NOTHING rather than a message full of empty
// strings, so "no address" stays distinguishable from "an address of blanks".
function addressTouched(a: AddressValue): boolean {
  return Object.values(a).some((v) => v.trim() !== "");
}

// `?draft=` comes from a URL, so it is whatever somebody typed. Anything that is not a positive whole
// number means NO DRAFT — the query is disabled at 0n and the card renders nothing, which is the right
// answer for a mistyped link and for an absent parameter alike. `BigInt("x")` throws, so this cannot
// be a bare cast.
function parseDraftId(raw: string | null): bigint {
  if (raw === null || !/^\d+$/.test(raw)) {
    return 0n;
  }

  return BigInt(raw);
}

// OrderCreatePage is the selling-side "place an order" form (#90), a dedicated PAGE (like the product
// editor) because it carries a dynamic list of lines.
//
// It is not merely a form: placing an order DRAWS ITS GOODS out of the chosen warehouse in the same
// transaction that writes it, so this screen is where stock leaves the building. Two consequences run
// through the whole page — the warehouse is required and visible, and every line shows what that
// warehouse actually holds.
export function OrderCreatePage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const createOrder = useCreateOrder();

  const teamId = current?.teamId;

  // ── WHAT THE EXTENSION SENT ──────────────────────────────────────────────────────────────────────
  //
  // `/orders/new?draft=201` opens this form ALONGSIDE the draft a browser extension pushed in, so the
  // person types the order while reading the marketplace's own words. Without the id the parameter is
  // absent, the query never runs, and the form is exactly what it was — a hand-written order has no
  // extension behind it and must not show a card claiming one.
  //
  // ⚠ IT IS READ-ONLY HERE, and nothing on it is copied into the form. The scraped text names no
  // product of ours (`OrderDraftItem.product_id` is 0 until a person maps it), so there is nothing to
  // prefill with — auto-picking a catalogue product by matching titles is exactly what the draft
  // design refused, because a wrong guess is indistinguishable from a person's choice once it is in
  // the form. Reading the lines and picking the products is the human act, and this card is the half
  // being read from.
  const [searchParams] = useSearchParams();
  const externalDraftId = parseDraftId(searchParams.get("draft"));
  const externalDraft = useOrderDraft({ teamId, draftId: externalDraftId });

  const externalItems: ExternalProduct[] = useMemo(
    () =>
      (externalDraft.data?.items ?? []).map((item) => ({
        id: item.id,
        name: item.externalName,
        price: item.unitPrice,
        quantity: item.quantity,
      })),
    [externalDraft.data],
  );

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  // The marketplace side of the order — WHICH storefront sold it, and what THAT storefront calls it.
  // One piece of state because they are one fact: a shop with no reference cannot be looked up again,
  // and a reference with no shop has nowhere to be looked up in.
  const [marketplace, setMarketplace] = useState<MarketplaceInfoValue>(emptyMarketplaceInfo);
  const shopId = marketplace.shopId;

  // Which warehouse fulfils this order (#72). REQUIRED: from #69 the order takes its stock out of this
  // warehouse the moment it is placed, so the form cannot submit without one.
  //
  // Pre-filled from the team's configured default (#145), which is not the same as guessing. A default
  // the SYSTEM invents would move real goods out of the wrong building; a default the TEAM configured
  // is the team stating where it ships from, and it stays visible and changeable on every order. The
  // server also still refuses an order that names no warehouse, so nothing here can let one through.
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [shippingCode, setShippingCode] = useState("");
  // The resi as TEXT — the number the buyer is given, beside the courier and the file it is printed
  // on. Sent as `receipt_code`, the order's own field for it.
  const [receiptCode, setReceiptCode] = useState("");
  // WHAT THE RECEIPT FILE SAYS (owner, rule 1) — read once per attached file and kept, because it is
  // used twice: to fill what is still empty, and to question what was typed when Create is pressed.
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [filledFromFile, setFilledFromFile] = useState(false);
  // THE FILE ITSELF, held only while its numbers are read (receipt-check-takes-the-file-bytes). The order
  // keeps the document reference below; the bytes are read from HERE, beside the upload, never from
  // storage — so the check starts the moment the file is picked.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  // What the checks found on the last attempt to place. Empty = the dialog is closed.
  const [gate, setGate] = useState<CheckFinding[]>([]);

  // The shipping receipt — the courier's slip photographed, or the marketplace's PDF (owner). What
  // is held here is a REFERENCE to a document already uploaded, never the file: the bytes went
  // straight to storage the moment it was picked, so submitting the order writes three short strings.
  const [receipt, setReceipt] = useState<ReceiptValue>(emptyReceipt);

  // Whatever the person taking the order needs the next person to know (owner). Free text on purpose:
  // "deliver after 5pm", "wrap the glass one", "second attempt, the first parcel came back" are
  // instructions to a HUMAN, and no dropdown ever fits the case actually in front of them.
  const [note, setNote] = useState("");

  // Starts EMPTY, not with a blank line. Lines arrive by picking products, so a placeholder row with
  // no product would be a row you cannot remove and cannot use — the same conclusion the restock form
  // reached (#165). The Create button is what refuses an order with nothing on it.
  const [lines, setLines] = useState<LineDraft[]>([]);

  // ── …AND WHAT THE NEW CARDS HOLD ────────────────────────────────────────────────────────
  //
  // Everything below is real on screen and NOT YET SENT — each one is an entry in `pending.ts`,
  // marked on its card and listed at the top of the page. The exception is the bundle: its
  // products ARE placed, as ordinary lines (see `allLines`); only the grouping is lost.
  const [bundles, setBundles] = useState<BundleDraft[]>([]);
  // WHEN THE ORDER HAPPENED — and it starts EMPTY (owner).
  //
  // ⚠ NO DEFAULT OF TODAY. It was pre-filled with now, on the argument that most orders are typed in
  // as they come; the trouble is that a date nobody chose is indistinguishable from one somebody did,
  // so every order typed a day late carries a wrong date that looks deliberate. An empty field asks
  // the question; a filled one answers it on the person's behalf and is never revisited.
  const [orderDate, setOrderDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [buyerUsername, setBuyerUsername] = useState("");
  // THE RIGHT RAIL, COLLAPSED (owner). The three money cards explain themselves the first time and
  // are read for their figures every time after that — so the prose is a toggle, not a fixture.
  const [compact, setCompact] = useState(false);


  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // WHY THE WAREHOUSE REFUSED THE LAST CREATE, when it did (a-refusal-names-its-reason-and-every-line) — kept apart
  // from `error` because it is not a sentence to print but a reason and the lines it names, each one a line on this
  // form the person has to change.
  const [refusal, setRefusal] = useState<TakeRefusal | null>(null);

  // A REF, not state, and this is load-bearing rather than a style choice. The save navigates in the
  // same tick it records success, and a `setState` has not landed by then — so a state flag would still
  // read false when the blocker below runs, and every successful order would be met with "discard
  // this?". A ref is written and read synchronously, which is what the navigation needs.
  const savedRef = useRef(false);

  // Pre-fill the warehouse from the team's configured default (#145).
  //
  // Only ever fills an UNTOUCHED field: if the answer arrives after somebody has already picked one,
  // it must not overwrite them. Reading `warehouseId` inside the updater rather than depending on it
  // keeps this a one-shot fill instead of a rule that fights the person typing.
  useEffect(() => {
    if (teamId === undefined) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await teamClient.teamDetail({ teamId });
        const preferred = res.team?.info?.defaultWarehouseId ?? 0n;

        if (!cancelled && preferred !== 0n) {
          setWarehouseId((chosen) => (chosen === 0n ? preferred : chosen));
        }
      } catch {
        // No default is an ordinary state, not an error worth showing: the field is required and
        // already visible, so the person simply picks one as they did before.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // ⚠ EVERY PRODUCT ON THE ORDER, picked by hand or arrived inside a bundle. One list, because
  // everything downstream — the stock read, the HPP read, the ownership read, the totals, the
  // invoice, the validation AND the order that is written — is about products and has no opinion
  // about how they got here. A bundle is an input device, not a second kind of goods.
  const allLines = useMemo(() => [...lines, ...bundleLines(bundles)], [lines, bundles]);
  // …and the same goods ONE LINE PER PRODUCT, which is what the order stores: the server merges a product that sits
  // on two lines (a bundle's slot and a hand-picked line) before the take, and the take costs it once. Every money
  // figure below is summed over THIS, so the totals on screen are the totals the order keeps.
  const productLines = useMemo(() => byProduct(allLines), [allLines]);

  // ── THE RECEIPT FILE, READ BACK ───────────────────────────────────────────────────────────────
  //
  // ⚠ IT FILLS ONLY WHAT IS EMPTY (owner). A machine reading a photograph does not get to overwrite
  // what a person typed — so `applyScan` leaves a filled box alone, and the disagreement it would
  // have caused is raised at Create instead, where somebody can look at both.
  //
  // Reading the LIVE values through refs keeps this an effect about the FILE: it runs when a file is
  // picked, not on every keystroke in the two fields it may fill.
  const refsNow = useRef({ orderRefId: "", trackingCode: "" });
  refsNow.current = { orderRefId: marketplace.orderExternalRefId, trackingCode: receiptCode };

  useEffect(() => {
    if (!receiptFile) {
      setScan(null);
      setFilledFromFile(false);
      return;
    }

    let cancelled = false;
    // A new file is a new answer: the last file's notice must not stand beside this one while it is read.
    setScan(null);
    setFilledFromFile(false);

    void scanReceipt(receiptFile).then((found) => {
      if (cancelled || !found) return;

      setScan(found);

      const filled = applyScan(found, refsNow.current);
      if (filled.orderRefId !== refsNow.current.orderRefId) {
        setMarketplace((prev) => ({ ...prev, orderExternalRefId: filled.orderRefId }));
      }
      if (filled.trackingCode !== refsNow.current.trackingCode) {
        setReceiptCode(filled.trackingCode);
      }

      setFilledFromFile(
        filled.orderRefId !== refsNow.current.orderRefId ||
          filled.trackingCode !== refsNow.current.trackingCode,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [receiptFile]);

  // WHICH STOREFRONT THE REFERENCE LOOKS LIKE (owner, rule 4) — offered only when the format names
  // exactly one and it is not the one already chosen. A suggestion that agrees with the field is
  // noise; one that cannot decide is a guess.
  const suggestedMarketplace = useMemo(() => {
    const hit = suggestMarketplace(marketplace.orderExternalRefId);
    return hit !== undefined && hit !== marketplace.marketplace ? hit : undefined;
  }, [marketplace.orderExternalRefId, marketplace.marketplace]);

  const productIds = useMemo(() => allLines.map((l) => l.productId), [allLines]);

  // WHAT THE ORDER WOULD DRAW from the chosen warehouse (an-order-is-costed-at-what-leaves-the-shelf): each line's
  // cost as the take would draw it — the owner's batches oldest first, the very draw Create then freezes — and what
  // the warehouse holds against it. ONE batched read for all lines, re-asked when the warehouse or a quantity changes:
  // the same order is placeable from one building and not from another, and 3 units cost more than 3 × the first one
  // once they spill into a newer batch. The stock column and the HPP come from the same answer, so they cannot
  // describe two different reads.
  const quote = useStockTakeQuote({ teamId, warehouseId, lines: allLines });
  const costs = quote.data?.costs;
  const stock = useMemo(() => availabilityOf(costs), [costs]);
  // A kept answer while a changed quantity is being priced — the lines say so rather than reading as current.
  const quoteBusy = quote.isFetching && !quote.isPending;

  // WHOSE product each line is. The by-ids row carries `teamId`, so cross-team ownership is a FACT
  // rather than a guess — it is what fills the return-mapping card and splits the invoice by team.
  const owners = useProductsByIds({ teamId, productIds }).data;
  // Names for the creditor rows. A picker feed / name lookup, so `reference`.
  const teamsQuery = useTeams({ page: 1, pageSize: 200, reference: true });

  const teamNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teamsQuery.data?.teams ?? []) map.set(team.id.toString(), team.name);
    return map;
  }, [teamsQuery.data]);

  const teamName = (id: bigint) => teamNames.get(id.toString()) ?? `#${id.toString()}`;

  // Past the `!current` guard below the team is always known; the `?? 0n` is for the TYPE, and the
  // cards take a plain bigint because none of them has anything to say about "no team yet".
  const cardTeamId = teamId ?? 0n;

  // The picker hands back the WHOLE ticked set, so this RECONCILES — it does not append (#165).
  //
  // A product that is still ticked keeps the line it already had, with the quantity and price typed
  // into it. Rebuilding the list from the picked set would be shorter to write and would silently
  // reset every number on screen the next time somebody opened the picker to add one more product.
  function pickProducts(products: PickedProduct[]) {
    setLines((prev) => {
      const ticked = new Set(products.map((p) => p.id.toString()));
      const kept = prev.filter((l) => ticked.has(l.productId.toString()));

      const known = new Set(kept.map((l) => l.productId.toString()));
      const added = products.filter((p) => !known.has(p.id.toString())).map(lineFor);

      return [...kept, ...added];
    });
  }

  function patchLine(productId: bigint, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  // Dropping ONE product without opening the dialog. Unticking it in the picker does the same thing —
  // they are the same edit, because the picker's ticks are derived from these lines rather than held
  // separately.
  function removeLine(productId: bigint) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  // ── Bundles ───────────────────────────────────────────────────────────────────────────────────

  function addBundle(picked: PickedBundle) {
    // A key per ADDED bundle: the same bundle can sit on one order twice, at different quantities.
    setBundles((prev) => [...prev, bundleFor(picked, `${picked.id}-${prev.length + 1}`)]);
  }

  function setBundleQuantity(key: string, quantity: string) {
    setBundles((prev) => prev.map((b) => (b.key === key ? { ...b, quantity } : b)));
  }

  function removeBundle(key: string) {
    setBundles((prev) => prev.filter((b) => b.key !== key));
  }

  // Filling a slot is the same reconcile as picking lines: the picker's ticked set IS the slot.
  function fillSlot(key: string, slotId: string, products: PickedProduct[]) {
    setBundles((prev) =>
      prev.map((bundle) => {
        if (bundle.key !== key) return bundle;

        return {
          ...bundle,
          slots: bundle.slots.map((slot) => {
            if (slot.id !== slotId) return slot;

            const ticked = new Set(products.map((p) => p.id.toString()));
            const kept = slot.fills.filter((f) => ticked.has(f.productId.toString()));
            const known = new Set(kept.map((f) => f.productId.toString()));
            const added = products
              .filter((p) => !known.has(p.id.toString()))
              .map((p) => fillFor(p, slot.ruleQty));

            return { ...slot, fills: [...kept, ...added] };
          }),
        };
      }),
    );
  }

  function setFillQuantity(key: string, slotId: string, productId: bigint, quantity: string) {
    setBundles((prev) =>
      prev.map((bundle) =>
        bundle.key === key
          ? {
              ...bundle,
              slots: bundle.slots.map((slot) =>
                slot.id === slotId
                  ? {
                      ...slot,
                      fills: slot.fills.map((f) =>
                        f.productId === productId ? { ...f, quantity } : f,
                      ),
                    }
                  : slot,
              ),
            }
          : bundle,
      ),
    );
  }


  // ── Who owns what, and what that costs ────────────────────────────────────────────────────────

  // One entry per OTHER team with goods on this order, with what those goods are worth at HPP.
  // Deduplicated by product, because the same product can arrive twice — once by hand and once
  // inside a bundle — and it is still one product belonging to one team.
  const crossLines: CrossLine[] = useMemo(() => {
    const seen = new Map<string, CrossLine>();

    for (const line of allLines) {
      const ownerTeamId = owners?.get(line.productId.toString())?.teamId ?? 0n;
      if (ownerTeamId === 0n || ownerTeamId === teamId) continue;

      seen.set(line.productId.toString(), {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        ownerTeamId,
        ownerName: teamName(ownerTeamId),
      });
    }

    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLines, owners, teamId, teamNames]);

  // THE GOODS' COST — the order's `goods_cost` as it will be frozen: per PRODUCT, not per line (`productLines`: the
  // same product on two lines is one draw, priced once), each at what it costs the seller — a borrowed product WITH its
  // own markup (the-cross-charge-lives-on-the-line). The fee below is asked on exactly this, as Create prices it.
  const productsTotal = useMemo(
    () => goodsCostOf({ lines: productLines, owners, costs, teamId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productLines, owners, costs, teamId],
  );

  // THE WAREHOUSE'S FEE, priced by the warehouse itself on the goods' cost — the same call order create makes before
  // it freezes the fee (the-flat-rate-is-dropped-last step 3). 0 while it is being asked, never a guess.
  const feeQuote = useWarehouseFeeQuote({ teamId, warehouseId, goodsCost: productsTotal });
  const warehouseFee = feeQuote.data?.fee ?? 0n;
  // A warehouse that never set its fee takes no orders (a-warehouse-with-no-rate-takes-no-orders): its sentence is
  // shown under the picker and Save stays off, because the server would refuse the order anyway.
  const feeRefusal = warehouseId > 0n ? (feeQuote.data?.refusal ?? null) : null;
  // THE GOODS AND THE FEE, and nothing else. No shipping term, by design: the buyer pays the platform for the
  // courier and none of that money passes through us (an-order-records-no-shipping-cost,
  // cod-and-shipping-are-the-platforms) — so the profit below is measured against the whole of our cost.
  const orderTotal = productsTotal + warehouseFee;
  const sellPrice = toRupiah(marketplace.platformTotal);

  // WHAT WE OWE, per creditor. The goods of each owning team at HPP, then their markup on top — the
  // same shape `liability` posts, so the preview and the recorded debt cannot disagree.
  const invoice: InvoiceRow[] = useMemo(
    () => invoiceRows({ lines: productLines, owners, costs, teamId, warehouseId, warehouseFee, teamName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productLines, owners, costs, teamId, teamNames, warehouseId, warehouseFee],
  );

  const invoiceTotal = invoice.reduce((sum, row) => sum + row.owed, 0n);

  // One row per creditor this order would put us in debt to — the building that ships it, and every
  // team whose goods are on it. Exactly the set `CheckCredit` is asked about at placement.
  //
  // ⚠ KEYED BY TEAM, NOT BY REASON. A warehouse can also own products on the order (it happens the
  // moment a building sells its own goods), and then the fee and the goods are two debts to ONE
  // creditor with ONE limit. Listing them separately would show an order as comfortable against a
  // ceiling that the two halves together cross.
  //
  // THE FIGURES ARE EACH CREDITOR'S OWN (the-debtor-sees-the-limits-set-on-it): one read for every creditor on the
  // order, the same reading the create's check makes. A row still reading, or failed, says so — never "unlimited".
  const creditQuery = useLiabilityCredit(teamId, creditorIds(invoice, warehouseId));
  const creditRowsList: CreditRow[] = useMemo(
    () =>
      creditRows({
        invoice,
        teamId,
        warehouseId,
        warehouseFee,
        teamName,
        credit: creditReadOf(creditQuery),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoice, teamId, warehouseId, warehouseFee, teamNames, creditQuery.data, creditQuery.isError],
  );

  // ── The return mapping ────────────────────────────────────────────────────────────────────────

  // A CROSS LINE ARRIVES WITH LAST TIME'S ANSWER ALREADY IN IT — read by ProductReturnMapByIds, and locked: the first
  // order carrying another team's product needs a decision, every order after it does not. A pick made here has been
  // WRITTEN by the card by the time it shows (the-map-is-written-when-it-is-picked), so it stands whether or not this
  // order is ever placed, and Create only ever checks. The draft page reads the same hook.
  const returnMapping = useReturnMapping(teamId, crossLines);
  const unmappedReturns = returnMapping.unmapped;

  // The marketplace's order date is required to place (platform-created-at-is-required-at-finalize) — marked on its
  // field like the customer's name, so a disabled Create always has a red asterisk to point at. So is the SELL PRICE,
  // what the buyer paid there (platform-total-is-required-at-finalize): settlement opens the order's account on it. So
  // is the MARKETPLACE REF (an-order-ref-is-required-by-the-rpc): the request's validation refuses an empty one.
  // ⚠ AND EVERY BORROWED PRODUCT NEEDS ITS RETURN MAP (a-borrowed-line-needs-its-map-at-create): the server refuses
  // the order without one, so Create is held here too, and the line under the button says why.
  const canSave =
    canSubmit({ customerName, shopId, warehouseId, lines: allLines, stock }) &&
    feeRefusal === null &&
    orderDate !== "" &&
    sellPrice > 0n &&
    marketplace.orderExternalRefId.trim() !== "" &&
    unmappedReturns === 0;

  // How many lines the chosen warehouse cannot fill. Summarised at the top as well as marked on each
  // line: on a long order the failing line can be off screen, and "Create is disabled and I cannot see
  // why" is the state this page must never be in.
  const shortLines = allLines.filter((l) => {
    const s = lineStock(l, stock);
    return s.kind === "known" && s.short;
  }).length;

  // Anything typed at all. Used only to decide whether leaving needs a confirmation — the warehouse is
  // excluded on purpose, because it arrives PRE-FILLED and a page nobody has touched must not claim to
  // have unsaved work.
  const dirty =
    customerName.trim() !== "" ||
    customerPhone.trim() !== "" ||
    shopId > 0n ||
    marketplace.orderExternalRefId.trim() !== "" ||
    shippingCode !== "" ||
    note.trim() !== "" ||
    hasReceipt(receipt) ||
    addressTouched(address) ||
    toRupiah(marketplace.platformTotal) > 0n ||
    lines.length > 0 ||
    // The cards that do not submit are still WORK: somebody who typed a deadline and a tracking
    // number has something to lose, whether or not the server will ever see it.
    bundles.length > 0 ||
    receiptCode.trim() !== "" ||
    orderDate !== "" ||
    deadline !== "" ||
    buyerUsername.trim() !== "";

  // A half-typed order is real work — several lines, an address, a customer on the phone — and a
  // mis-aimed click on Back or a sidebar link threw all of it away silently. `useBlocker` stops the
  // navigation, and the answer decides whether it proceeds; blocking only while `dirty` means the
  // ordinary "opened it, changed my mind" path is untouched, and `savedRef` is what stops it firing on
  // the one navigation that is the whole point of the form.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !savedRef.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  // ⚠ CREATE IS TWO STEPS NOW (owner): what the order says about itself is checked BEFORE anything
  // is written. An error stops it outright; a warning is shown and can be overruled — see
  // `checks.ts` for which is which, and OrderChecksDialog for how the two read.
  function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) {
      return;
    }

    const findings = runOrderChecks({
      orderRefId: marketplace.orderExternalRefId,
      trackingCode: receiptCode,
      scan,
      sellPrice: toRupiah(marketplace.platformTotal),
      // ⚠ THE FIGURE THE PANEL SHOWS, not the one the RPC carries. They differ by the warehouse fee,
      // and a dialog that quotes a different margin from the card above it is a dialog nobody trusts.
      orderTotal,
    });

    if (findings.length > 0) {
      setGate(findings);
      return;
    }

    void place();
  }

  async function place() {
    if (teamId === undefined || !canSave) {
      return;
    }

    setGate([]);
    setSaving(true);
    setError("");
    setRefusal(null);

    try {
      const res = await createOrder.mutateAsync({
        teamId,
        shopId,
        warehouseId,
        customerName,
        customerPhone,
        address: addressTouched(address) ? address : undefined,
        shippingCode,
        // Trimmed, so a note of nothing but whitespace is stored as no note at all — otherwise the
        // detail page would render an empty note card for a field somebody tabbed through.
        note: note.trim(),
        // Sent only when one was actually attached: an empty reference and no reference say the same
        // thing, and the shorter one cannot be mistaken for a document whose id got lost.
        receipt: hasReceipt(receipt) ? receipt : undefined,
        // What the buyer paid on the platform. The order's OWN money — goods_cost, the warehouse fee, total_cost — is
        // not sent: the server freezes it from the take (an-order-is-costed-at-what-leaves-the-shelf).
        platformTotal: toRupiah(marketplace.platformTotal),
        // Trimmed, so a reference of nothing but whitespace is stored as none at all — the same
        // treatment `note` gets, and for the same reason: "" and "   " must not be two states.
        orderExternalRefId: marketplace.orderExternalRefId.trim(),
        // The number printed on the slip (`receipt_code`), trimmed for the same reason. Typed, or filled from the
        // file's scan — either way what the person confirmed is what is kept.
        receiptCode: receiptCode.trim(),
        // The buyer's name on the marketplace — optional, never a reason to refuse (the-buyers-username-is-optional).
        // Trimmed like the ref; the server trims it again, so spaces alone are none on either side.
        buyerUsername: buyerUsername.trim(),
        // WHEN THE BUYER ORDERED — required (platform-created-at-is-required-at-finalize), which `canSave` already
        // holds the form to — and the marketplace's ship-by time, optional. Local time, to the minute.
        platformCreatedAtUnix: dateTimeInputToUnix(orderDate),
        platformShipmentDeadlineUnix: dateTimeInputToUnix(deadline),
        // ⚠ `allLines`, so a bundle's products are really ordered. The GROUPING is what is not
        // stored (mark 1) — the goods themselves are ordinary lines and must reach the warehouse,
        // or the totals above would promise stock the order never draws. A product on two lines is
        // sent twice and merged by the SERVER into one line (both doors, every client) — the two
        // carry the same sku and name, and the price is the take's, so nothing is lost in the merge.
        items: allLines.map((l) => ({
          id: 0n,
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          quantity: toQty(l.quantity),
          // NO PRICE: a line carries none (an-order-line-carries-no-marketplace-price). The server freezes every money
          // figure of the line from the take's REAL draw (#74, an-order-is-costed-at-what-leaves-the-shelf) — the same
          // selection the form's quote ran, so the two agree unless another order took the same units first.
        })),
        // THE DRAFT THIS FORM WAS OPENED BESIDE (`?draft=`), finished by this order and deleted with it
        // (a-draft-becomes-an-order-through-order-create). Only when it loaded — which already proves it is the
        // caller's — so a mistyped or foreign `?draft=` never refuses an order typed in full.
        orderDraftId: externalDraft.data ? externalDraftId : 0n,
      });

      // The invalidation rode with the write (#177) — this page navigates away, so the list it
      // leaves behind has no other way to learn about the order just created.
      toaster.create({ type: "success", title: t("orders.orderCreated") });

      // Set BEFORE navigating, or the guard above asks whether to discard the order that was just
      // successfully placed — which is exactly what happened the first time this shipped.
      savedRef.current = true;

      const id = res.order?.id;
      void navigate(id ? `/orders/${id}` : "/orders");
    } catch (err) {
      // The warehouse refusing the take (short stock, a borrowed product below its reserve) says WHY and names the
      // lines; anything else is a sentence.
      const refused = takeRefusalOf(err);
      if (refused) {
        setRefusal(refused);
      } else {
        setError(rpcError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  // What a refused line is called on THIS form — the name the person picked it by, else its id.
  function productLabel(productId: bigint): string {
    const line = allLines.find((l) => l.productId === productId);
    return line?.name || line?.sku || `#${productId.toString()}`;
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orders.title")}</Heading>
        <Text color="fg.muted" data-testid="order-create-no-team">
          {t("orders.selectTeamCreate")}
        </Text>
      </Stack>
    );
  }

  return (
    // No `maxW`: the page fills the content area, the way the list pages do. A two-column grid wants
    // the room — the wider the window, the more of it the lines get.
    <Stack gap="section" data-testid="order-create-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="order-create-back"
          onClick={() => navigate("/orders")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{t("orders.newOrderTitle")}</Heading>
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="order-create-error">
          {error}
        </Text>
      )}

      {refusal && <TakeRefusalAlert refusal={refusal} labelOf={productLabel} testId="order-create-refusal" />}

      {/* Full width, above both columns: a line the warehouse cannot fill is a fact about the whole
          order, not about the column the line happens to sit in. */}
      {shortLines > 0 && (
        <Alert.Root status="error" data-testid="order-create-short">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("orders.shortTitle", { count: shortLines })}</Alert.Title>
            <Alert.Description>{t("orders.shortHelp")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      <form onSubmit={save} noValidate>
        <Stack gap="section">
          {/* WHAT THIS SCREEN CANNOT DO, BEFORE ANYTHING ELSE. It is read once, at the top, and
              repeated as a badge on each card that is affected — so somebody who scrolled straight to
              a card still learns it there. Empty since ReceiptCheck landed, so it renders nothing; it stays
              mounted for the next part built ahead of the system. */}
          <NotImplementedSummary list={ORDER_FORM_PENDING} />

          {/* ⚠ THE WAREHOUSE LEADS THE FORM, AND IT IS NOT A CARD (owner). Every figure below is
              measured against this building — see WarehouseBand for why it sits above the flow rather
              than inside it.

              BELOW THE WARNING, THOUGH (owner): that strip is about the SCREEN — what it cannot do
              yet — and it is read before anybody starts. This is the first thing about the ORDER.
              Above it, the warehouse would be answered before the reader knew what they were looking
              at. */}
          <WarehouseBand value={warehouseId} onChange={setWarehouseId} refusal={feeRefusal} />

      {/* ⚠ `minmax(0, 1fr)` ON A PHONE TOO, not `1fr`. A track's minimum is `auto` — its widest child —
          so a wide lines table pushed the whole column past a 390px screen instead of scrolling inside
          its own box. */}
      <Grid
        templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" }}
        gap="section"
        alignItems="start"
        style={{ marginTop: 16 }}
      >
        {/* ── THE ORDER BEING WRITTEN ─────────────────────────────────────── left column ──────── */}
        <GridItem>
          <Stack gap="section">
            {/* ── THE RECEIPT FILE, FIRST (owner) ─────────────────────────────────────────────────
                It carries the order id AND the tracking number, so the file and the two numbers read
                off it are one card — and it leads, because it is the document the person is working
                from. */}
            <ShippingReceiptCard
              teamId={cardTeamId}
              receipt={receipt}
              onReceiptChange={(next) => {
                setReceipt(next);
                // Removed: what the file said leaves with it. (Numbers it already filled stay — they
                // are in the boxes now, and a person may have checked them against the paper.)
                if (!hasReceipt(next)) setReceiptFile(null);
              }}
              onReceiptFile={setReceiptFile}
              orderRefId={marketplace.orderExternalRefId}
              onOrderRefIdChange={(orderExternalRefId) =>
                setMarketplace({ ...marketplace, orderExternalRefId })
              }
              trackingCode={receiptCode}
              onTrackingCodeChange={setReceiptCode}
              shippingCode={shippingCode}
              onShippingCodeChange={setShippingCode}
              filledFromFile={filledFromFile}
              scanResult={scan?.result}
            />

            {/* WHICH SHOP, WHICH WAREHOUSE — the warehouse decides what every stock figure below it
                means. */}
            <Card.Root>
              {/* ORDER INFORMATION (owner) — the live form calls this card "Shop & Warehouse",
                  which named its two controls. It now also carries the storefront's reference, what
                  the storefront took and WHEN the order happened, and those are not a shop or a
                  warehouse: they are what identifies this order. The live page keeps its own title
                  (its key is untouched); this one is named for what it holds. */}
              <Card.Header>
                <Card.Title>{t("orderForm.source.title")}</Card.Title>
                <Card.Description>{t("orderForm.source.help")}</Card.Description>
              </Card.Header>
              <Card.Body>
                <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
                  <Stack gap="card">
                    {/* ⚠ WITHOUT ITS MONEY FIELD. The same number is collected below under the name
                        the rest of this screen uses for it — see the note there. */}
                    <MarketplaceInfoForm
                      teamId={cardTeamId}
                      value={marketplace}
                      onChange={setMarketplace}
                      required
                      hideTotal
                      hideOrderRef
                    />

                    {/* ⚠ WHAT THE REFERENCE LOOKS LIKE (owner, rule 4). One click applies it; it
                        never applies itself, because a storefront chosen by a pattern is still a
                        guess and the shop list below is scoped by this field. */}
                    {suggestedMarketplace !== undefined && (
                      <Flex align="center" gap="2" wrap="wrap" data-testid="order-marketplace-suggestion">
                        <Text fontSize="xs" color="fg.muted">
                          {t("orderForm.source.looksLike")}
                        </Text>
                        <MarketplaceBadge marketplace={suggestedMarketplace} size="sm" />
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          data-testid="order-marketplace-suggestion-apply"
                          onClick={() =>
                            setMarketplace({ ...marketplace, marketplace: suggestedMarketplace })
                          }
                        >
                          {t("orderForm.source.useIt", { name: marketplaceLabel(suggestedMarketplace) })}
                        </Button>
                      </Flex>
                    )}

                    {/* ONE NAME FOR ONE NUMBER: HARGA JUAL / SELL PRICE (owner).
                        The live form calls this "Marketplace order total" while the profit panel
                        calls the same figure the sell price — two words for one thing on one screen,
                        and the person has to work out they are the same. The sell price wins: it is
                        what the customer paid, which is what the margin is measured against. */}
                    {/* REQUIRED (platform-total-is-required-at-finalize) — read off the storefront like the order
                        date, and Create stays off until it is there. */}
                    <Field.Root required>
                      <Field.Label>
                        {t("orderForm.source.sellPrice")}
                        <Field.RequiredIndicator />
                      </Field.Label>
                      <CurrencyInput
                        value={marketplace.platformTotal}
                        data-testid="order-marketplace-total"
                        onChange={(platformTotal) =>
                          setMarketplace({ ...marketplace, platformTotal })
                        }
                      />
                      <Field.HelperText>{t("orderForm.source.sellPriceHelp")}</Field.HelperText>
                    </Field.Root>
                  </Stack>

                  <Stack gap="card">
                    {/* ⚠ THE WAREHOUSE IS NOT HERE ANY MORE (owner). It was the odd one out: every
                        other field on this card is a fact ABOUT the order, while the building is what
                        the whole screen is measured against. It leads the page now — see
                        WarehouseBand. */}

                    {/* WHEN THE CUSTOMER BOUGHT IT (owner) — part of the order's own information,
                        so it sits with the shop and the storefront's reference rather than with the
                        delivery deadline further down. The two dates answer opposite questions: this
                        one is when it happened, that one is when it must arrive. */}
                    {/* REQUIRED (platform-created-at-is-required-at-finalize): every order comes from a platform,
                        and the person reads this off the same storefront page as the ref. */}
                    <Field.Root required>
                      <Field.Label>
                        {t("orderForm.source.orderDate")}
                        <Field.RequiredIndicator />
                      </Field.Label>
                      {/* WITH THE CLOCK (owner). A marketplace stamps an order to the minute, and
                          two orders on one morning are told apart by nothing else — so the field
                          that records WHEN IT HAPPENED carries a time. */}
                      {/* ⚠ NEVER IN THE FUTURE (owner). An order is typed in AFTER it happened —
                          at best a minute later, at worst two days — so a date past today is a typo
                          every time, and one that would file the order under a day it has not
                          reached yet. */}
                      <DatePicker
                        value={orderDate}
                        onChange={setOrderDate}
                        withTime
                        clearable
                        max={todayDateInput()}
                        testId="order-create-order-date"
                      />
                      <Field.HelperText>{t("orderForm.source.orderDateHelp")}</Field.HelperText>
                    </Field.Root>
                  </Stack>
                </SimpleGrid>
              </Card.Body>
            </Card.Root>

            {/* ── WHAT THE EXTENSION SENT ── ABOVE the picker, and only when there is a draft ──
                This is the text being worked FROM and the picker below is the work, so the screen
                reads top to bottom: the marketplace's own words first, our catalogue second. It
                renders NOTHING without `?draft=`, so a hand-written order is the form it always
                was. */}
            {externalItems.length > 0 && (
              <ProductListExternal
                items={externalItems}
                source={externalDraft.data?.source}
                showTotal
              />
            )}

            {/* WHAT IS BEING SOLD — the items card. */}
            <OrderItemCard
              teamId={cardTeamId}
              warehouseId={warehouseId}
              lines={lines}
              stock={stock}
              costs={costs}
              busy={quoteBusy}
              onPick={pickProducts}
              onPatch={patchLine}
              onRemove={removeLine}
            />

            {/* …AND THE SAME QUESTION ASKED IN BUNDLES. A second card rather than a section of the
                one above: a bundle's slots are edited against a ceiling, and that does not fit a
                table of flat lines. The products it contributes are counted with the rest. */}
            <BundleCard
              teamId={cardTeamId}
              warehouseId={warehouseId}
              bundles={bundles}
              stock={stock}
              costs={costs}
              onAdd={addBundle}
              onQuantity={setBundleQuantity}
              onRemove={removeBundle}
              onFill={fillSlot}
              onFillQuantity={setFillQuantity}
            />

            {/* WHERE A RETURN WOULD LAND — only for goods belonging to another team, so the card is
                empty on an ordinary own-catalogue order. */}
            <ReturnMappingCard
              teamId={cardTeamId}
              lines={crossLines}
              mapping={returnMapping.mapping}
              onMap={returnMapping.onMap}
              checking={returnMapping.checking}
            />

            {/* WHO IT IS FOR, WHERE IT GOES, WHAT WAS HANDED OVER — reused whole. */}
            {/* ⚠ NO RECEIPT HERE ANY MORE. The courier, the tracking number and the file moved to
                the card at the top, where the label they come from is — and this component drops its
                whole receipt section when a caller cannot hold one, so nothing had to be edited in
                it. What is left is what the title always said: the customer and where the parcel
                goes. */}
            <CustomerInfoForm
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              customerPhone={customerPhone}
              onCustomerPhoneChange={setCustomerPhone}
              address={address}
              onAddressChange={setAddress}
              teamId={cardTeamId}
              // THE SECOND WAY INTO AN ADDRESS (owner): search the kecamatan by name, which fills
              // everything above it and the postcode when that kecamatan has only one.
              addressKecamatanSearch
            />

            <ExtraInfoCard
              deadline={deadline}
              onDeadlineChange={setDeadline}
              buyerUsername={buyerUsername}
              onBuyerUsernameChange={setBuyerUsername}
            />
          </Stack>
        </GridItem>

        {/* ── THE MONEY ───────────────────────────────────────── right column, and it STICKS ──── */}
        <GridItem position={{ base: "static", lg: "sticky" }} top="4">
          {/* ⚠ COMPACT TIGHTENS THE RAIL, it does not only hide words (owner). Removing three
              descriptions from cards that keep their full padding leaves the same tall column with
              holes in it — which reads as emptier than before, not denser. So the gap between the
              cards closes too, and each card pulls its own padding in. */}
          <Stack gap={compact ? "card" : "section"}>
            {/* THE RAIL'S OWN HEADER — a name on the left, its one control on the right.
                ⚠ THE BUTTON IS NOT ALLOWED TO FLOAT (owner). On its own in an otherwise empty row it
                read as a stray control hanging in white space — the emptiness was AROUND it, not
                inside the cards. Paired with the name of what it collapses, the row has the same
                shape as every card header on this screen and the button belongs to something.

                ONE TOGGLE FOR ALL THREE, not a collapse per card: they are read together, and three
                separate chevrons would be three states to keep in your head. */}
            <Flex justify="space-between" align="center" gap="2">
              <Text fontSize="sm" fontWeight="bold" color="fg.muted">
                {t("orderForm.rail.title")}
              </Text>
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-testid="order-create-rail-compact"
                onClick={() => setCompact((on) => !on)}
              >
                <Icon as={compact ? ChevronsUpDown : ChevronsDownUp} boxSize="4" />
                {t(compact ? "orderForm.rail.expand" : "orderForm.rail.collapse")}
              </Button>
            </Flex>

            <CreditLimitPanel rows={creditRowsList} compact={compact} />
            <ProfitEstimatePanel sellPrice={sellPrice} orderTotal={orderTotal} compact={compact} />
            <TotalsInvoicePanel
              productsTotal={productsTotal}
              warehouseFee={warehouseFee}
              orderTotal={orderTotal}
              invoice={invoice}
              invoiceTotal={invoiceTotal}
              compact={compact}
            />

            {/* ── THE NOTE, AND THE BUTTON AFTER IT ───────────────────────── last in the rail ──
                One card, because it is one moment: the last thing remembered, then the thing that
                ends the order (owner).

                ⚠ IN THE STICKY COLUMN, which is why it is here rather than at the foot of the form:
                a note is something remembered HALFWAY THROUGH — the customer says one more thing
                while the lines are being typed — so it has to stay reachable while a long list of
                products scrolls past. After the money, never inside it: the rail reads
                may-I-owe → is-it-worth-it → what-does-it-come-to, and this is what follows. */}
            <NoteAndSubmitCard
              note={note}
              onNoteChange={setNote}
              unmappedReturns={unmappedReturns}
              compact={compact}
              saving={saving}
              canSave={canSave}
            />
          </Stack>
        </GridItem>
      </Grid>
        </Stack>
      </form>

      {/* WHAT THE CHECKS FOUND — the last thing between Create and the write. */}
      <OrderChecksDialog
        findings={gate}
        placing={saving}
        onClose={() => setGate([])}
        onPlaceAnyway={() => void place()}
      />

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title={t("orders.discardTitle")}
        message={t("orders.discardMessage")}
        confirmLabel={t("orders.discardConfirm")}
        onConfirm={async () => blocker.proceed?.()}
        // Closing the dialog ANY other way — Cancel, the X, the backdrop, Escape — means "stay", so
        // the navigation is reset rather than left hanging. `reset` is only defined while the blocker
        // is blocked, so the close that follows a confirmed proceed is a no-op rather than a fight.
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      />
    </Stack>
  );
}
