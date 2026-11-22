import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Field,
  Fieldset,
  Flex,
  Grid,
  GridItem,
  Heading,
  Icon,
  IconButton,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, Trash2 } from "lucide-react";
import { type orderClient, rpcError } from "../../api/clients";
import { awaitAnswer } from "../../features/orders/createAnswer";
import { NoAnswerPanel } from "./components/NoAnswerPanel";
import { useTeam } from "../../features/team/TeamContext";
import { useAuth } from "../../features/auth/AuthContext";
import { useCreateOrder } from "../../features/orders/queries";
import { useShopOptions } from "../../features/shops/queries";
import { useDeleteOrderDrafts, useOrderDraft } from "../../features/orderDrafts/queries";
import { DraftProductHints } from "./components/DraftProductHints";
import { DraftAddressText } from "./components/DraftAddressText";
import { addressTouched, initialOrderForm, isDirty, orderFormActions, orderFormReducer } from "./formState";
import type { OrderRequest } from "./formState";
import { CompactActions } from "../../components/chrome/CompactActions";
import { useIsMobile } from "../../layouts/shell";
import { useStockTakeQuote } from "../../features/inventory/queries";
import { MarketplaceInfoForm } from "../../components/orders/MarketplaceInfoForm";
import { OrderItemCard } from "../../components/orders/OrderItemCard";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { RadioPills } from "../../components/inputs/RadioPills";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { DatePicker } from "../../components/datetime/DatePicker";
import { dateTimeInputToUnix, todayDateInput } from "../../lib/datetime";
import { useProductsByIds } from "../../features/products/queries";
import { usePresetProduct } from "../../features/products/presetProduct";
import { cameFrom } from "../../lib/cameFrom";
import { useTeams } from "../../features/teams/queries";
import { bundleLines } from "../../features/orders/form/bundles";
import { useWarehouseFeeQuote } from "../../features/warehouse/queries";
import { useTeamDetail } from "../../features/teams/queries";
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
import { DuplicateRefDialog } from "../../features/orders/form/DuplicateRefDialog";
import { findDuplicateRef, warns } from "../../features/orders/form/duplicateRef";
import { runOrderChecks, scanReceipt, suggestMarketplace } from "../../features/orders/form/checks";
import { MarketplaceBadge, marketplaceLabel } from "../../components/badges/MarketplaceBadge";
import { ExtraInfoCard } from "../../features/orders/form/ExtraInfoCard";
import { TotalsInvoicePanel } from "../../features/orders/form/TotalsInvoicePanel";
import type { InvoiceRow } from "../../features/orders/form/TotalsInvoicePanel";
import { toaster } from "../../components/feedback/Toaster";
import { CustomerInfoForm } from "../../components/customers/CustomerInfoForm";
import { hasReceipt } from "../../components/orders/ReceiptUpload";
import { TakeRefusalAlert } from "../../features/orders/TakeRefusalAlert";
import { takeRefusalOf } from "../../features/orders/takeRefusal";
import { availabilityOf, byProduct, canSubmit, lineStock, toQty, toRupiah } from "../../features/orders/lines";

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
//
// THE COURIER IS REQUIRED (no-order-without-a-courier, the-courier-required-look-is-accepted): the field carries the
// red `*` and a hint while none is picked, and Create is held until one is — the server's refusal said before Create.
export function OrderCreatePage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  // Whose drafts the duplicate warning may link to — only the caller's own open (OrderDraftDetail narrows to the author).
  const { identity } = useAuth();
  const navigate = useNavigate();
  const createOrder = useCreateOrder();

  const teamId = current?.teamId;

  // ── A DRAFT IS FINISHED HERE (owner: *"order draft detail page itu dilebur dengan order create"*,
  // `the-draft-opens-in-the-order-form`) ─────────────────────────────────────────────────────────────
  //
  // `/orders/new?draft=201` is the draft's page: this form, SEEDED from what the app pushed (the shop, its order id,
  // the warehouse, the buyer, the address, the courier, the price it read), with the scraped lines as a text list above
  // the products — read while our products are picked. Create places the order and deletes the draft; the draft can
  // also be deleted from the header. Without the id the parameter is absent, the query never runs, and the form is
  // exactly what it was.
  //
  // ⚠ THE SCRAPED LINES ARE NOT COPIED IN. A marketplace title names no product of ours, and a draft stores no mapping
  // (a-draft-stores-no-mapping): the person maps every line HERE, straight into the order's lines. Auto-picking by
  // matching titles is what the draft design refused: a wrong guess is indistinguishable from a person's choice once it
  // is in the form.
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const externalDraftId = parseDraftId(searchParams.get("draft"));
  const externalDraft = useOrderDraft({ teamId, draftId: externalDraftId });
  const draft = externalDraft.data ?? null;
  const draftMode = externalDraftId > 0n;
  // OPENED FROM A PRODUCT'S PAGE (a-product-page-opens-the-order-and-restock-forms) — `?product=` starts the form with
  // that product as its first line, and `&warehouse=` with that warehouse. Never on a draft, which seeds its own.
  const preset = usePresetProduct(draftMode ? undefined : teamId);
  const presetMode = !draftMode && preset.productId > 0n;
  // Where Back and Create return to — the product's page that opened the form, else the order screens as before.
  const location = useLocation();
  const openedFrom = cameFrom(location);
  const deleteDrafts = useDeleteOrderDrafts();
  const [confirmDeleteDraft, setConfirmDeleteDraft] = useState(false);
  // ── THE FORM'S STATE — ONE REDUCER (no-global-store-every-read-is-a-query-hook, formState.ts) ─────────────────────
  //
  // Everything the person types — the buyer and the address, the marketplace side (the shop, the storefront's ref, the
  // sell price), the warehouse, the courier, the receipt and what its file said, the note, the lines or the bundles, the
  // dates — with what the form was seeded from and where Create stands, in ONE state changed only by its actions. What
  // each field means, and the rule each action keeps, is written in formState.ts; `act` holds its setters, each a stable
  // function, as the `useState` setters it replaced were.
  //
  // The warehouse is the one field that may open filled: a product page's warehouse lens, when it opened the form with
  // one (a-product-page-opens-the-order-and-restock-forms) — never on a draft, which seeds its own.
  const [form, dispatch] = useReducer(
    orderFormReducer,
    { warehouseId: draftMode ? 0n : preset.warehouseId },
    initialOrderForm,
  );
  const act = useMemo(() => orderFormActions(dispatch), []);
  const {
    customerName,
    customerPhone,
    address,
    marketplace,
    warehouseId,
    shipmentChannelId,
    receiptCode,
    scan,
    filledFromFile,
    receipt,
    note,
    lines,
    bundles,
    contents,
    switchingTo,
    orderDate,
    deadline,
    buyerUsername,
    checkingRef,
    duplicate,
    gate,
    sent,
    retry,
    error,
    refusal,
  } = form;
  const shopId = marketplace.shopId;

  // THE RIGHT RAIL, COLLAPSED (owner). The three money cards explain themselves the first time and
  // are read for their figures every time after that — so the prose is a toggle, not a fixture. A screen toggle, not
  // anything the order says, so it stays out of the form's state.
  const [compact, setCompact] = useState(false);

  // ── THE FORM LOCK (the-form-locks-until-it-is-answered, no-answer-is-only-a-lost-connection) ─────────────────────
  //
  // From the moment Create sends, the form is LOCKED on what was sent — every input, line and picker — until an answer
  // comes back. `sent` is that payload, frozen, and where the wait stands:
  //
  // - `waiting` — the request is open. There is NO time limit: a slow server keeps the form locked until it answers.
  // - `noAnswer` — the connection dropped with no reply (createAnswer.ts). The order may or may not exist, so the form
  //   stays locked on the frozen payload and offers Try Again, which re-checks the shop + ref and resends under a NEW key.
  //
  // Why locked: an edit made while the first submit may still land would be a second, different order typed over the
  // first — the person must first learn what happened to the one they sent. (`sent` is the form's — formState.ts.)
  const locked = sent !== null;
  const saving = sent?.phase === "waiting";
  // The locked fieldset: `inert` on top of `disabled`, so the controls a fieldset cannot disable (a file drop zone, a
  // radio pill, a clickable row) take no click and no focus either.
  const lockRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (lockRef.current) lockRef.current.inert = locked;
  }, [locked]);

  // THE LOCKED LOOK — the cards fade with their controls; Create (with its spinner) and the panels above stay bright.
  const lockFade = locked ? { opacity: 0.55, transition: "opacity 0.15s" } : { transition: "opacity 0.15s" };

  // Closing the TAB while locked is guarded too — the in-app links are the blocker's (below).
  useEffect(() => {
    if (!locked) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);

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
  //
  // The team is read through its query hook (#122) — the same entry the team's own pages read — and the fill stays ONE
  // SHOT per team: it takes the answer given since the form opened (never a cached one from an earlier visit), once, so
  // a re-read cannot put a default back into a field the person cleared. A failed read fills nothing: no default is an
  // ordinary state, not an error worth showing — the field is required and already visible, so the person simply
  // picks one as they did before.
  //
  // #123: the fill is the form's `defaultWarehouse` action, and its once-per-team is the reducer's (`filledDefaultFor`).
  const team = useTeamDetail({ teamId: teamId ?? 0n, enabled: teamId !== undefined });

  useEffect(() => {
    if (teamId === undefined || !team.isFetchedAfterMount) return;

    dispatch({ type: "defaultWarehouse", teamId, preferred: team.data?.info?.defaultWarehouseId ?? 0n });
  }, [teamId, team.isFetchedAfterMount, team.data]);

  // SEED FROM THE PRODUCT'S PAGE, once — the product as the first line, quantity 1, as a pick would add it. After this
  // the form is the person's; its "nothing changed" is the form as seeded, so leaving untouched asks nothing. The seed
  // is the form's `seedPreset` action, taken once per product (`seededPreset`), its "nothing changed" with it.
  useEffect(() => {
    if (!presetMode || !preset.product) return;

    dispatch({ type: "seedPreset", productId: preset.productId, product: preset.product, quantity: preset.quantity });
  }, [presetMode, preset.product, preset.productId, preset.quantity]);

  // SEED FROM THE DRAFT, once per draft — after this the form is the person's. The draft's warehouse wins over the
  // team's default: the app read where this order ships from. A draft the app pushed carries the marketplace's own
  // order id; one saved from this form carries a reference of ours, which is no marketplace's and is not copied. The
  // seed is the form's `seedDraft` action (formState.ts), taken once per draft (`seededDraft`): a re-read of the same
  // draft never puts its values back over what was typed.
  useEffect(() => {
    if (draft) dispatch({ type: "seedDraft", draft });
  }, [draft]);

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
  // The fill is the form's `scanned` action, which reads the LIVE values in the reducer — so this stays an effect about
  // the FILE: it runs when a file is picked, not on every keystroke in the two fields it may fill. A file that is
  // replaced or removed before its read answers fills nothing (`cancelled`, and the reducer's own file check).
  const receiptFile = form.receiptFile;

  useEffect(() => {
    if (!receiptFile) return;

    let cancelled = false;

    void scanReceipt(receiptFile).then((found) => {
      if (!cancelled && found) dispatch({ type: "scanned", file: receiptFile, found });
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

  // The lines, the bundles and the items-or-bundles switch are the form's actions (formState.ts): a pick RECONCILES
  // the ticked set (#165), every added bundle gets its own key, and leaving a card that holds something waits for the
  // confirm, which empties it (an-order-holds-items-or-bundles).

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
        productCode: line.productCode,
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
  const warehouseFee = feeQuote.data?.fee ?? 0;
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

  const invoiceTotal = invoice.reduce((sum, row) => sum + row.owed, 0);

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
  // ⚠ AND THE SHOP IS OPEN (a-closed-shop-refuses-only-new-selling): a waiting draft keeps its shop after the shop was
  // closed (a-close-leaves-the-drafts-waiting) — ShopSelect `keepClosed` shows it badged rather than clearing it — and
  // the server refuses the order, so Create is held here and the alert at the top says why and what the ways out are.
  // The same read ShopSelect's `keepClosed` makes, so it is one request.
  const closedShops = useShopOptions({ teamId: cardTeamId, status: "closed" });
  const closedShop = shopId > 0n ? closedShops.data?.find((shop) => shop.id === shopId) : undefined;

  const canSave =
    closedShop === undefined &&
    canSubmit({ customerName, shopId, warehouseId, lines: allLines, stock }) &&
    feeRefusal === null &&
    orderDate !== "" &&
    sellPrice > 0 &&
    marketplace.orderExternalRefId.trim() !== "" &&
    unmappedReturns === 0 &&
    // No order without a courier (no-order-without-a-courier, the-courier-required-look-is-accepted) — held here, before
    // the server would refuse it.
    shipmentChannelId > 0n;

  // How many lines the chosen warehouse cannot fill. Summarised at the top as well as marked on each
  // line: on a long order the failing line can be off screen, and "Create is disabled and I cannot see
  // why" is the state this page must never be in.
  const shortLines = allLines.filter((l) => {
    const s = lineStock(l, stock);
    return s.kind === "known" && s.short;
  }).length;

  // Anything typed at all. Used only to decide whether leaving needs a confirmation — the warehouse is
  // excluded on purpose, because it arrives PRE-FILLED and a page nobody has touched must not claim to
  // have unsaved work. On a draft or a product page's form it is "changed since it was seeded" (`isDirty`).
  const dirty = isDirty(form, draftMode || presetMode);

  // A half-typed order is real work — several lines, an address, a customer on the phone — and a
  // mis-aimed click on Back or a sidebar link threw all of it away silently. `useBlocker` stops the
  // navigation, and the answer decides whether it proceeds; blocking only while `dirty` means the
  // ordinary "opened it, changed my mind" path is untouched, and `savedRef` is what stops it firing on
  // the one navigation that is the whole point of the form.
  //
  // ⚠ AND ALWAYS WHILE LOCKED: an order sent and not yet answered (or never answered) is not "nothing typed" — leaving
  // does not stop it, and the person must know to check the orders list before typing it again.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !savedRef.current && (dirty || locked) && currentLocation.pathname !== nextLocation.pathname,
  );

  // ⚠ CREATE IS TWO STEPS NOW (owner): what the order says about itself is checked BEFORE anything
  // is written. An error stops it outright; a warning is shown and can be overruled — see
  // `checks.ts` for which is which, and OrderChecksDialog for how the two read.
  //
  // ⚠ AND BEFORE THEM, THE SHOP + REF (a-duplicate-ref-is-warned-not-refused, the-duplicate-warning-reads-drafts-too):
  // is this order already recorded? A live order on the same shop and ref is NAMED in a warning with Create Anyway —
  // never a refusal, the server takes the double. So is a DRAFT of the team on them (OrderDraftByExternalRefs). It runs
  // for a new order and for a draft being finalized alike, and never names that draft. Nothing found → straight on to the checks, with no dialog at all.
  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave || checkingRef || locked) {
      return;
    }

    dispatch({ type: "set", field: "checkingRef", value: true });
    const finding = await findDuplicateRef({
      teamId,
      shopId,
      ref: marketplace.orderExternalRefId,
      // Only when the draft loaded — the same rule `orderDraftId` is sent by below.
      finalizingDraftId: externalDraft.data ? externalDraftId : 0n,
    });
    dispatch({ type: "set", field: "checkingRef", value: false });

    if (warns(finding)) {
      dispatch({ type: "set", field: "duplicate", value: finding });
      return;
    }

    runChecks();
  }

  // THE SECOND STEP — what the order says about itself. Reached straight from Create when the ref is not recorded, or
  // from the duplicate warning's Create Anyway.
  function runChecks() {
    dispatch({ type: "set", field: "duplicate", value: null });

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
      dispatch({ type: "set", field: "gate", value: findings });
      return;
    }

    void place();
  }

  async function place() {
    if (teamId === undefined || !canSave || locked) {
      return;
    }

    dispatch({ type: "set", field: "gate", value: [] });
    await send(orderRequest(teamId));
  }

  // WHAT CREATE SENDS, minus its key — built once per Create and FROZEN in `sent`, so Try Again resends exactly this.
  function orderRequest(teamId: bigint): OrderRequest {
    return {
      teamId,
      shopId,
      warehouseId,
      customerName,
      customerPhone,
      address: addressTouched(address) ? address : undefined,
      shipmentChannelId,
      // Trimmed, so a note of nothing but whitespace is stored as no note at all — otherwise the
      // detail page would render an empty note card for a field somebody tabbed through.
      note: note.trim(),
      // Sent only when one was actually attached: an empty reference and no reference say the same
      // thing, and the shorter one cannot be mistaken for a document whose id got lost.
      receipt: hasReceipt(receipt) ? receipt : undefined,
      // What the buyer paid on the platform. The order's OWN money — goods_cost, the warehouse fee, total_cost — is
      // not sent: the server freezes it from the take (an-order-is-costed-at-what-leaves-the-shelf).
      // A double on the wire since selling 00041 — sent EXACT, a fraction included, and frozen as sent
      // (the-backend-never-rounds-money).
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
        productCode: l.productCode,
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
    } satisfies Omit<Parameters<typeof orderClient.orderCreate>[0], "idempotencyKey">;
  }

  // ONE SEND — Create's, and every Try Again's — of a frozen request, under a key of its own. The form locks first and
  // stays locked until the answer (createAnswer.ts): the order opens it; the SERVER's error gives the form back as
  // typed; no answer keeps it locked on `request` and shows the Try Again panel.
  async function send(request: OrderRequest) {
    dispatch({ type: "send", request });

    // THIS SUBMIT'S OWN KEY (the-frontend-mints-the-idempotency-key, every-submit-mints-a-new-key) — minted HERE, inside
    // every submit, never when the form opens and never reused: a resubmit after an error, a draft's finalize and a
    // retry alike send a fresh one, so two attempts never share a key. The order stores it, and the server refuses a key
    // an order already holds (the-order-refuses-a-used-key) with the take's *key already used* refusal.
    const idempotencyKey = crypto.randomUUID();

    const answer = await awaitAnswer(() => createOrder.mutateAsync({ ...request, idempotencyKey }));

    if (answer.kind === "order") {
      // The invalidation rode with the write (#177) — this page navigates away, so the list it
      // leaves behind has no other way to learn about the order just created.
      toaster.create({ type: "success", title: t("orders.orderCreated") });

      // Set BEFORE navigating, or the guard above asks whether to discard the order that was just
      // successfully placed — which is exactly what happened the first time this shipped.
      savedRef.current = true;

      const id = answer.value.order?.id;
      // Back to the product's page it was opened from (a-product-page-opens-the-order-and-restock-forms); else the order.
      void navigate(openedFrom ?? (id ? `/orders/${id}` : "/orders"));
      return;
    }

    if (answer.kind === "none") {
      // NOTHING CAME BACK — the form stays locked on what was sent, and the person decides (Try Again).
      dispatch({ type: "noAnswer", request });
      return;
    }

    // THE SERVER ANSWERED: the form is the person's again, exactly as typed. The warehouse refusing the take (short
    // stock, a borrowed product below its reserve) says WHY and names the lines; anything else is a sentence.
    const refused = takeRefusalOf(answer.error);
    dispatch({ type: "answered", refusal: refused ?? null, error: refused ? "" : rpcError(answer.error) });
  }

  // TRY AGAIN (a-try-again-always-warns): never sends straight away. It re-runs the duplicate check on the FROZEN shop +
  // ref — the first submit may have landed, so it will usually be named — and always opens the warning: Create Anyway
  // (or Send Again, when nothing is found yet) resends the frozen payload under a NEW key (every-submit-mints-a-new-key).
  async function tryAgain() {
    if (sent?.phase !== "noAnswer" || checkingRef) return;

    const { request } = sent;
    dispatch({ type: "set", field: "checkingRef", value: true });
    const finding = await findDuplicateRef({
      teamId: request.teamId,
      shopId: request.shopId,
      ref: request.orderExternalRefId,
      finalizingDraftId: request.orderDraftId,
    });
    dispatch({ type: "set", field: "checkingRef", value: false });
    dispatch({ type: "set", field: "retry", value: finding });
  }

  // GO BACK from Try Again's warning: the form is the person's again — as it was sent — and the next Create is a new
  // submit like any other (its own duplicate check, its own key).
  function goBackFromRetry() {
    dispatch({ type: "goBackFromRetry" });
  }

  // What a refused line is called on THIS form — the name the person picked it by, else its id.
  function productLabel(productId: bigint): string {
    const line = allLines.find((l) => l.productId === productId);
    return line?.name || line?.productCode || `#${productId.toString()}`;
  }

  // DELETE THE DRAFT — the app's work dropped, from its own page. Confirmed first: it is not undone.
  async function removeDraft() {
    if (teamId === undefined || !draftMode) return;

    try {
      await deleteDrafts.mutateAsync({ teamId, draftIds: [externalDraftId] });
      toaster.create({ type: "success", title: t("orderForm.draft.deleted") });
      savedRef.current = true;
      void navigate("/order-drafts");
    } catch (err) {
      toaster.create({ type: "error", title: t("orderForm.draft.deleteFailed"), description: rpcError(err) });
    }
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
    // It arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="order-create-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="order-create-back"
          onClick={() => navigate(openedFrom ?? "/orders")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md" truncate={isMobile} minW="0">
          {t("orders.newOrderTitle")}
        </Heading>
        {/* FROM A DRAFT — which one, and the way to drop it (the-draft-opens-in-the-order-form). */}
        {draft && (
          <>
            <Badge colorPalette="gray" flexShrink={0} data-testid="order-create-draft-ref">
              {t("orderForm.draft.badge", { ref: draft.externalId })}
            </Badge>
            <Box flex="1" />
            {isMobile ? (
              <CompactActions
                menuLabel={t("common.actions")}
                actions={[
                  {
                    id: "delete",
                    label: t("orderForm.draft.delete"),
                    icon: Trash2,
                    danger: true,
                    disabled: locked,
                    testId: "order-create-delete-draft",
                    onClick: () => setConfirmDeleteDraft(true),
                  },
                ]}
              />
            ) : (
              <Button
                size="xs"
                variant="outline"
                colorPalette="error"
                disabled={locked}
                data-testid="order-create-delete-draft"
                onClick={() => setConfirmDeleteDraft(true)}
              >
                <Icon as={Trash2} boxSize="4" />
                {t("orderForm.draft.delete")}
              </Button>
            )}
          </>
        )}
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="order-create-error">
          {error}
        </Text>
      )}

      {refusal && <TakeRefusalAlert refusal={refusal} labelOf={productLabel} testId="order-create-refusal" />}

      {/* SENT, AND WAITING FOR THE ANSWER — said at the top as well as on Create, which can be a screen away. */}
      {sent?.phase === "waiting" && (
        <Alert.Root status="info" data-testid="order-create-waiting">
          <Alert.Indicator>
            <Spinner size="sm" />
          </Alert.Indicator>
          <Alert.Title>{t("orderForm.lock.waiting")}</Alert.Title>
        </Alert.Root>
      )}

      {/* NO ANSWER — outside the locked fieldset, so Try Again is the one thing on the page that still answers. */}
      {sent?.phase === "noAnswer" && <NoAnswerPanel onTryAgain={() => void tryAgain()} checking={checkingRef} />}

      {/* THE DRAFT'S SHOP IS CLOSED — the draft waits (a-close-leaves-the-drafts-waiting): it cannot become an order until the
          shop is reopened, or it is deleted. Said at the top, where Create's being held is explained. */}
      {closedShop && (
        <Alert.Root status="warning" data-testid="order-create-shop-closed">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("orderForm.shopClosed.title", { name: closedShop.name })}</Alert.Title>
            <Alert.Description>{t("orderForm.shopClosed.body")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

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

      <form onSubmit={(event) => void save(event)} noValidate>
        {/* THE LOCK — one native fieldset around the whole form: `disabled` reaches every input, button and picker
            trigger inside it (and Chakra's fields read it through the fieldset context), `inert` the rest. */}
        <Fieldset.Root
          ref={lockRef}
          disabled={locked}
          minW="0"
          data-testid="order-create-lock"
          data-locked={locked ? "" : undefined}
        >
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
          <Box {...lockFade}>
            <WarehouseBand value={warehouseId} onChange={act.warehouseId} refusal={feeRefusal} />
          </Box>

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
        <GridItem {...lockFade}>
          <Stack gap="section">
            {/* ── THE RECEIPT FILE, FIRST (owner) ─────────────────────────────────────────────────
                It carries the order id AND the tracking number, so the file and the two numbers read
                off it are one card — and it leads, because it is the document the person is working
                from. */}
            <ShippingReceiptCard
              teamId={cardTeamId}
              receipt={receipt}
              // Removed: what the file said leaves with it — the form's `receipt` action. (Numbers it already filled
              // stay — they are in the boxes now, and a person may have checked them against the paper.)
              onReceiptChange={act.receipt}
              onReceiptFile={act.receiptFile}
              orderRefId={marketplace.orderExternalRefId}
              onOrderRefIdChange={act.orderRef}
              trackingCode={receiptCode}
              onTrackingCodeChange={act.receiptCode}
              shipmentChannelId={shipmentChannelId}
              onShipmentChannelChange={act.shipmentChannelId}
              courierRequired
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
                      onChange={act.marketplace}
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
                            dispatch({ type: "marketplacePatch", patch: { marketplace: suggestedMarketplace } })
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
                        fraction
                        value={marketplace.platformTotal}
                        data-testid="order-marketplace-total"
                        onChange={act.sellPrice}
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
                        onChange={act.orderDate}
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

            {/* ── WHAT THE DRAFT SAYS MUST BE SENT ── ABOVE the products, as a list of text (owner,
                the-draft-opens-in-the-order-form). The marketplace's own words first, our catalogue second —
                it is read while the products below are picked. Nothing without `?draft=`. */}
            {draft && draft.items.length > 0 && <DraftProductHints items={draft.items} source={draft.source} />}

            {/* WHAT IS BEING SOLD — as ITEMS or as BUNDLES, never both (an-order-holds-items-or-bundles): one radio
                pill picks the card, and only that card shows. */}
            <Stack gap="1.5" data-testid="order-contents-field">
              <Text fontSize="xs" fontWeight="bold" color="fg.label">
                {t("orderForm.contents.label")}
              </Text>
              <RadioPills
                value={contents}
                onChange={act.chooseContents}
                ariaLabel={t("orderForm.contents.label")}
                testId="order-contents"
                options={[
                  { value: "items", label: t("orderForm.contents.items"), testId: "order-contents-items" },
                  { value: "bundles", label: t("orderForm.contents.bundles"), testId: "order-contents-bundles" },
                ]}
              />
            </Stack>

            {contents === "items" ? (
              <OrderItemCard
                teamId={cardTeamId}
                warehouseId={warehouseId}
                lines={lines}
                stock={stock}
                costs={costs}
                busy={quoteBusy}
                onPick={act.pickProducts}
                onPatch={act.patchLine}
                onRemove={act.removeLine}
              />
            ) : (
              /* THE SAME QUESTION ASKED IN BUNDLES. Its own card: a bundle's slots are edited against a ceiling, and
                 that does not fit a table of flat lines. The products it contributes are the order's lines. */
              <BundleCard
                teamId={cardTeamId}
                warehouseId={warehouseId}
                bundles={bundles}
                stock={stock}
                costs={costs}
                onAdd={act.addBundle}
                onQuantity={act.bundleQuantity}
                onRemove={act.removeBundle}
                onFill={act.fillSlot}
                onFillQuantity={act.fillQuantity}
              />
            )}

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
              onCustomerNameChange={act.customerName}
              customerPhone={customerPhone}
              onCustomerPhoneChange={act.customerPhone}
              address={address}
              onAddressChange={act.address}
              // A DRAFT'S ADDRESS AS THE MARKETPLACE WROTE IT (the-cs-edits-the-whole-address-before-create), read beside
              // the editable picker — every part of which the person may change before Create.
              addressHint={draft ? <DraftAddressText address={draft.address} /> : undefined}
              teamId={cardTeamId}
              // THE SECOND WAY INTO AN ADDRESS (owner): search the kecamatan by name, which fills
              // everything above it and the postcode when that kecamatan has only one.
              addressKecamatanSearch
            />

            <ExtraInfoCard
              deadline={deadline}
              onDeadlineChange={act.deadline}
              buyerUsername={buyerUsername}
              onBuyerUsernameChange={act.buyerUsername}
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
            <Flex justify="space-between" align="center" gap="2" {...lockFade}>
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

            <Stack gap={compact ? "card" : "section"} {...lockFade}>
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
            </Stack>

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
              onNoteChange={act.note}
              unmappedReturns={unmappedReturns}
              compact={compact}
              saving={saving || checkingRef}
              savingText={saving ? t("orderForm.lock.placing") : undefined}
              canSave={canSave}
            />
          </Stack>
        </GridItem>
      </Grid>
        </Stack>
        </Fieldset.Root>
      </form>

      {/* THIS SHOP + REF IS ALREADY RECORDED — asked before the checks below; Go Back keeps the form as typed. */}
      <DuplicateRefDialog
        finding={duplicate}
        selfUserId={identity?.identityId}
        placing={saving}
        onGoBack={() => dispatch({ type: "set", field: "duplicate", value: null })}
        onCreateAnyway={runChecks}
      />

      {/* TRY AGAIN'S WARNING (a-try-again-always-warns) — the same dialog, always opened: Create Anyway / Send Again
          resends the frozen order under a new key; Go Back gives the form back; closing it keeps the lock. */}
      <DuplicateRefDialog
        retry
        finding={retry}
        selfUserId={identity?.identityId}
        placing={saving}
        onGoBack={goBackFromRetry}
        onDismiss={() => dispatch({ type: "set", field: "retry", value: null })}
        onCreateAnyway={() => {
          if (sent) void send(sent.request);
        }}
      />

      {/* WHAT THE CHECKS FOUND — the last thing between Create and the write. */}
      <OrderChecksDialog
        findings={gate}
        placing={saving}
        onClose={() => dispatch({ type: "set", field: "gate", value: [] })}
        onPlaceAnyway={() => void place()}
      />

      {/* Leaving a card that holds something empties it — asked first (an-order-holds-items-or-bundles). */}
      <ConfirmDialog
        open={switchingTo !== null}
        onOpenChange={(open) => {
          if (!open) act.cancelSwitch();
        }}
        title={t(switchingTo === "bundles" ? "orderForm.contents.toBundlesTitle" : "orderForm.contents.toItemsTitle")}
        message={
          contents === "items"
            ? t("orderForm.contents.dropItems", { count: lines.length })
            : t("orderForm.contents.dropBundles", { count: bundles.length })
        }
        confirmLabel={t("orderForm.contents.switch")}
        onConfirm={act.confirmSwitch}
      />

      <ConfirmDialog
        open={confirmDeleteDraft}
        onOpenChange={setConfirmDeleteDraft}
        title={t("orderForm.draft.deleteTitle")}
        message={t("orderForm.draft.deleteConfirm", { ref: draft?.externalId ?? "" })}
        confirmLabel={t("orderForm.draft.delete")}
        onConfirm={removeDraft}
      />

      <ConfirmDialog
        open={blocker.state === "blocked"}
        // LOCKED, the question is not "discard what you typed" but "the order may still be placed" — leaving cannot
        // stop a request already sent.
        title={t(locked ? "orderForm.lock.leaveTitle" : "orders.discardTitle")}
        message={
          sent?.phase === "waiting"
            ? t("orderForm.lock.leaveWaiting")
            : sent?.phase === "noAnswer"
              ? t("orderForm.lock.leaveNoAnswer")
              : t("orders.discardMessage")
        }
        confirmLabel={t(locked ? "orderForm.lock.leaveConfirm" : "orders.discardConfirm")}
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
