import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Portal,
  Spacer,
  Stack,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ArrowLeft, ArrowUpRight, Info, Printer, Tags, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";

import type { RestockLabel } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { useTeam } from "../../features/team/TeamContext";
import { labelsPath } from "../../features/restock/labelsPath";
import { useIsMobile } from "../../layouts/shell";
import { cameFrom } from "../../lib/cameFrom";
import { formatUnixDate } from "../../lib/datetime";
import { useElementWidth } from "../../lib/useElementWidth";
import { useFitToWindow } from "../../lib/useFitToWindow";
import { FLASH_ON_LANDING, jumpTo } from "../../lib/useScrollSpy";
import { QuantityInput } from "../../components/inputs/QuantityInput";
import { LabelPaper, LabelSticker } from "./components/LabelPaper";
import { LabelSettingsPanel } from "./components/LabelSettingsPanel";
import { RestocksCard } from "./components/RestocksCard";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { RESTOCK_LABELS_PENDING } from "./pending";
import type { LabelSet } from "./labelSets";
import { useLabelSets } from "./labelSets";
import type { LabelSettings } from "./settings";
import {
  DEFAULT_SETTINGS,
  PX_PER_MM,
  clearSettings,
  labelBox,
  loadSettings,
  normalise,
  papersOf,
  runOf,
  saveSettings,
} from "./settings";

/** One label on the print — the restock it is from, and its place among that restock's labels. */
interface Entry {
  set: LabelSet;
  label: RestockLabel;
  /** Its count's key: the restock and the label's index in it. */
  key: string;
}

// THE RESTOCKS ON THIS PRINT — the address's `?ids=503,502`, the labels' one address for one restock or several
// (the-labels-have-one-address). Every id once, in order; anything that is not a whole number is dropped.
function idsOf(search: string): bigint[] {
  const parts = (new URLSearchParams(search).get("ids") ?? "").split(",");
  const ids: bigint[] = [];
  for (const part of parts) {
    const p = part.trim();
    if (!/^\d+$/.test(p)) continue;
    const id = BigInt(p);
    if (id > 0n && !ids.includes(id)) ids.push(id);
  }

  return ids;
}

// RestockLabelsPage prints the stickers for an ACCEPTED delivery — the step after counting it in: one label per
// shelved unit (or per placement) so a picker can find and scan what just landed.
//
// It is warehouse-only, like accepting: the crew that shelved the goods prints them. The QR encodes
// `sku/batch-id` — one batch per line (one-batch-per-line). Every good unit is on a placement
// (there-is-no-unplaced-pile), so every label has one; there is no holding pile to print.
//
// AN ACCEPTED RESTOCK — AND AN ARRIVED ONE (owner: *"halaman ini juga bisa diakses status tiba, tapi tanpa penempatan
// harusnya"*, labels-print-from-arrived). Accepted, the labels are the server's: one per placement, its batch in the QR.
// Arrived, the box is signed for and not yet counted, so nothing is on a placement and no batch exists: the labels are
// the restock's own lines — one per product, as many as were ordered, NO PLACEMENT, the SKU alone in the QR. Any other
// status has none, and the page says so rather than asking for labels the server would refuse.
//
// Broken and missing units are absent by construction: they never became stock, so the server returns no
// label for them. The count of what was left out is shown so a short run reads as deliberate.
//
// SET UP IN MM (owner, 2026-11-06, the-label-is-set-up-in-mm) — the paper, the grid of labels on it, the padding, the
// text and each text's size, the run's limit and page; remembered on this device (settings.ts). The screen previews
// each paper at its true proportions, scaled up; the print sends every paper of the run, one paper a page, the page
// exactly the paper's size.
//
// ON THE SCREEN RULES (the-restock-labels-follow-the-screen-rules): back is its icon in the title's row and returns
// where the page was opened; on a phone the header is one row with Cetak as its icon; a first load is a
// skeleton; the date speaks the app's language; nothing runs past a phone's edge.
//
// MANY RESTOCKS IN ONE PRINT (owner: *"halaman labels bisa print banyak restock sekaligus"*,
// labels-print-several-restocks) — the page holds a LIST of restocks, opened with the one it came from: *Tambah Restok*
// puts another on, ✕ takes one off, and the run is every label of every restock, in that order, each with its own
// count. The address follows (`/inventories/restock/labels?ids=503,502`), so a refresh prints the same set — ONE
// address, one restock or several (owner: *"pakai 1 alamat saja"*, the-labels-have-one-address); the old
// `/inventories/restock/503/labels` redirects here (router.tsx).
export function RestockLabelsPage() {
  const { current } = useTeam();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();
  // From `lg` the settings stand in a column beside the preview, held in view and fitted to the window.
  const wide = useBreakpointValue({ base: false, lg: true }) ?? false;
  const column = useFitToWindow<HTMLDivElement>(wide);

  const [ids, setIds] = useState<bigint[]>(() => idsOf(location.search));
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened) — the list with its filters, or
  // a restock's page; reached by a link, the restock's page, or the list for several. Read once: the address changes
  // as restocks are added, and the way back must not change with it.
  const [openedFrom] = useState(() => cameFrom(location));
  const one = ids.length === 1;
  const backTo = openedFrom ?? (one ? `/inventories/restock/${ids[0]!.toString()}` : "/inventories/restock");

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const teamId = isWarehouse ? current?.teamId : undefined;

  // Each restock's labels — accepted, the server's; arrived, its own lines; anything else, none (labelSets.ts).
  const sets = useLabelSets(teamId, ids);
  const readySets = sets.filter((s) => s.state === "ready");

  // A restock on or off the print — the address follows, replaced, carrying the way back.
  const changeIds = (next: bigint[]) => {
    setIds(next);
    navigate(labelsPath(next), {
      replace: true,
      preventScrollReset: true,
      state: openedFrom ? { from: openedFrom } : undefined,
    });
  };
  const addRestock = (id: bigint) => {
    if (!ids.includes(id)) changeIds([...ids, id]);
  };
  const removeRestock = (id: bigint) => {
    if (ids.length > 1) changeIds(ids.filter((x) => x !== id));
  };
  // A RESTOCK TAKES YOU TO ITS LABELS (owner: *"restock navigasi ke labelnya"*, labels-a-restock-jumps-to-its-labels) —
  // its group in Yang Dicetak, scrolled to and blinking once (a-nav-jump-blinks-where-it-lands).
  const jumpToRestock = (id: bigint) => {
    const el = document.querySelector<HTMLElement>(`[data-jump="restock-${id.toString()}"]`);
    if (el) jumpTo(el);
  };

  // Remembered on this device (the-label-settings-are-remembered); the run's page is not — a new visit starts at 1.
  const [settings, setSettings] = useState<LabelSettings>(loadSettings);
  const [page, setPage] = useState(1);
  useEffect(() => saveSettings(settings), [settings]);
  const change = (patch: Partial<LabelSettings>) => setSettings((prev) => normalise({ ...prev, ...patch }));
  const reset = () => {
    clearSettings();
    setSettings(DEFAULT_SETTINGS);
    setPage(1);
  };

  // Every label of every restock, in the restocks' order — the restock it is from travels with it.
  const entries = useMemo<Entry[]>(
    () =>
      readySets.flatMap((set) =>
        set.labels.map((label, i) => ({ set, label, key: `${set.id.toString()}:${i}` })),
      ),
    // `sets` is rebuilt only when an answer changes (labelSets.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sets],
  );
  const labels = useMemo(() => entries.map((e) => e.label), [entries]);

  // HOW MANY OF EACH LABEL (owner: *"bisa diedit jumlahnya"*, the-print-list-is-each-label-and-its-count) — each label of
  // the restock (a product on a placement) with its own count, typed over. Until typed, *Satu label per* says: a piece,
  // the units on that placement; a placement, 1. Choosing it again starts every count over from it.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const defaultCount = (label: RestockLabel) => (settings.mode === "shelf" ? 1 : Number(label.quantity));
  const countOf = (entry: Entry) => {
    const typed = counts[entry.key];
    if (typed === undefined) return defaultCount(entry.label);
    const n = Number(typed);
    return typed === "" || !Number.isFinite(n) ? 0 : Math.max(0, Math.round(n));
  };
  const changeSettings = (patch: Partial<LabelSettings>) => {
    if (patch.mode !== undefined) setCounts({});
    change(patch);
  };

  // The full job — each label as many times as its count.
  const job: RestockLabel[] = [];
  for (const entry of entries) {
    for (let n = 0; n < countOf(entry); n++) job.push(entry.label);
  }
  /** How many of one restock's labels print — its counts summed. */
  const printedOf = (id: bigint) => entries.filter((e) => e.set.id === id).reduce((s, e) => s + countOf(e), 0);

  const productCount = useMemo(() => new Set(labels.map((l) => l.sku)).size, [labels]);
  // The run this print sends — `limit` labels, the `page`-th of them — cut into papers.
  const run = runOf(job, settings.limit, page);
  const papers = papersOf(run.items, settings);
  // Today, in the app's language — printed when the date is on.
  const today = formatUnixDate(BigInt(Math.floor(Date.now() / 1000)));

  // THE PREVIEW — one paper, the run's first, filled as it will print; else the first label on its own. As large as the
  // card holds, up to 3×, never below its true size; 24px is the grey ground's padding.
  const [previewRef, previewWidth] = useElementWidth<HTMLDivElement>();
  const paperPx = settings.paperWidth * PX_PER_MM;
  const scale = previewWidth > 0 ? Math.min(3, Math.max(1, (previewWidth - 24) / paperPx)) : 1;
  const previewLabels = papers[0] ?? (labels[0] ? [labels[0]] : []);
  // Yang Dicetak's stickers — each label at up to 2× its box.
  const stickerPx = labelBox(settings).width * PX_PER_MM;
  const stickerScale = Math.min(2, Math.max(1, 200 / Math.max(1, stickerPx)));

  // OUR PRINT — the run's papers, through the browser's dialog (which is where a PDF is saved too). Nothing to print is
  // said, never a blank page sent.
  const printLabels = () => {
    if (papers.length === 0) {
      toaster.create({ type: "warning", title: t("restock.labels.nothingToPrint") });
      return;
    }
    window.print();
  };
  // CTRL+P IS OUR PRINT (owner: *"detect ctrl+P jadi cetak kita"*, ctrl-p-prints-the-labels) — and ⌘P on a Mac: the same
  // act as Cetak, so the shortcut never prints the page as it looks, nor a run with nothing in it. Read through a ref, so
  // the one listener always prints the latest run.
  const printRef = useRef(printLabels);
  printRef.current = printLabels;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        printRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Back is its icon alone, in the title's row — as on the restock's other pages.
  const back = (
    <IconButton
      size="sm"
      variant="ghost"
      flexShrink={0}
      className="no-print"
      aria-label={one ? t("restock.labels.back", { id: ids[0]!.toString() }) : t("restock.labels.backAny")}
      title={one ? t("restock.labels.back", { id: ids[0]!.toString() }) : t("restock.labels.backAny")}
      onClick={() => navigate(backTo)}
      data-testid="labels-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.labels.title")}</Heading>
        <Text color="fg.muted">{t("restock.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.labels.title")}</Heading>
        <Text color="fg.muted" data-testid="labels-not-warehouse">
          {t("restock.labels.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  // The first load shows the page's shape (motion-is-small-quick-and-shared) — until the first restock is in; one added
  // later loads in its own row, and the rest of the page stays.
  if (ids.length > 0 && sets.every((s) => s.state === "loading")) {
    return <ListSkeleton heading rows={3} testId="labels-loading" />;
  }

  const first = sets[0];

  // ONE RESTOCK, NEITHER ACCEPTED NOR ARRIVED — said plainly, with the way to the restock, as Terima says a restock it
  // cannot take. Among several, it is a row of the Restok card that says so.
  if (one && first?.state === "notPrintable" && first.restock) {
    const id = first.restock.id;

    return (
      <Stack gap="section" animationStyle="enter">
        <Flex align="center" gap="2">
          {back}
          <Heading size="md" truncate>
            {t("restock.labels.title")}
          </Heading>
          <RestockStatusBadge status={first.restock.status} />
        </Flex>
        <Alert.Root status="info" maxW="3xl" data-testid="labels-not-printable">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("restock.labels.notAcceptedTitle", { id: id.toString() })}</Alert.Title>
            <Alert.Description>{t("restock.labels.notAccepted")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <Button
          variant="outline"
          alignSelf="flex-start"
          data-testid="labels-open-restock"
          onClick={() => navigate(`/inventories/restock/${id}`)}
        >
          <Icon as={ArrowUpRight} boxSize="4" />
          {t("restock.accept.openRestock")}
        </Button>
      </Stack>
    );
  }

  // NOTHING TO SHOW — no restock in the address, or the only one could not be read. Among several, an unreadable one is
  // a row of the Restok card that says so.
  if (!first || (one && first.state === "error")) {
    return (
      <Stack gap="section">
        <Box>{back}</Box>
        <Text color="error.fg" data-testid="labels-error">
          {first?.error ? rpcError(first.error) : t("restock.labels.notFound")}
        </Text>
      </Stack>
    );
  }

  // How many will print — beside the actions on a desktop, under the title's row on a phone.
  const summary = (
    <Stack gap="0" textAlign={mobile ? "start" : "end"} data-testid="labels-count">
      <Text fontSize="sm">
        <Text as="span" fontWeight="bold">
          {job.length}
        </Text>{" "}
        {t("restock.labels.count", { products: productCount })}
      </Text>
      <Text fontSize="xs" color="fg.muted" data-testid="labels-run">
        {t("restock.labels.settings.runLine", { from: run.from, to: run.to, total: job.length, papers: papers.length })}
      </Text>
    </Stack>
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="labels-page">
      <PrintStyles settings={settings} />

      {/* THE TITLE'S ROW — back, the title, the status, and Cetak: the browser's own print dialog, which is where a PDF
          is saved too — so there is no Unduh PDF beside it (owner: *"unduh pdf dan cetak sama plek ketiplek, tidak
          perlu unduh pdf"*, cetak-is-the-one-print-button). On a phone ONE row with Cetak as its icon
          (the-phone-header-is-one-row, a-phone-header-action-is-an-icon), and how many will print comes down under it. */}
      <Flex align="center" gap={mobile ? "2" : "card"} wrap={mobile ? "nowrap" : "wrap"} className="no-print">
        {back}
        {/* One restock names itself and its status; several are counted, and the Restok card names each. */}
        <Heading size="md" truncate data-testid="labels-heading">
          {one
            ? t("restock.labels.heading", { id: first.id.toString() })
            : t("restock.labels.headingMany", { count: ids.length })}
        </Heading>
        {one && first.restock && <RestockStatusBadge status={first.restock.status} />}
        <Spacer />
        {mobile ? (
          <CompactActions
            menuLabel={t("restock.accept.actions")}
            actions={[
              {
                id: "print",
                label: t("restock.labels.print"),
                icon: Printer,
                primary: true,
                disabled: papers.length === 0,
                testId: "labels-print",
                onClick: printLabels,
              },
            ]}
          />
        ) : (
          <>
            {summary}
            <Button
              colorPalette="brand"
              disabled={papers.length === 0}
              title={t("restock.labels.printShortcut")}
              onClick={printLabels}
              data-testid="labels-print"
            >
              <Icon as={Printer} boxSize="4" />
              {t("restock.labels.print")}
            </Button>
          </>
        )}
      </Flex>

      {mobile && <Box className="no-print">{summary}</Box>}

      {/* What is not wired yet — the restocks are read one by one (pending.ts). */}
      <Box className="no-print">
        <NotImplementedSummary list={RESTOCK_LABELS_PENDING} />
      </Box>

      {/* THE SETTINGS BESIDE THE PREVIEW where there is room — held in view while the preview scrolls
          (the-label-page-is-settings-and-a-preview); on the right, what is printed: the restocks, the Pratinjau, Yang
          Dicetak. On a phone it all stacks, the restocks first (labels-print-several-restocks).

            lg                                   base
            ┌ settings ┐ ┌ Restok ──────────┐   Restok
            │ (sticky, │ ├ Pratinjau ───────┤   settings
            │  fitted) │ ├ Yang Dicetak ────┤   Pratinjau
            └──────────┘ └──────────────────┘   Yang Dicetak

          The second row is `1fr`, so the settings — spanning both rows — never stretch the Restok card's. */}
      <Grid
        templateColumns={{ base: "minmax(0, 1fr)", lg: "22rem minmax(0, 1fr)" }}
        templateRows={{ lg: "auto 1fr" }}
        gap="section"
        alignItems="start"
      >
        <Box gridColumn={{ lg: "2" }} gridRow={{ lg: "1" }} minW="0">
          <RestocksCard
            teamId={teamId}
            sets={sets}
            printedOf={printedOf}
            onAdd={addRestock}
            onRemove={removeRestock}
            onJump={jumpToRestock}
          />
        </Box>

        {/* THE SETTINGS ARE THE WHOLE COLUMN (owner: *"scrollbar di label settingnya tidak enak"*,
            the-label-settings-scroll-inside-their-card) — as Product Discover's filter panel is its column: it sticks and
            ends a gutter above the window's foot wherever it stands (useFitToWindow); its title stays and the groups
            scroll inside. Sharing the column with the Restok card left them a window of ~430px for ~900px of settings. */}
        <Box
          ref={column}
          gridColumn={{ lg: "1" }}
          gridRow={{ lg: "1 / span 2" }}
          position={wide ? "sticky" : "static"}
          top="page"
          display="flex"
          flexDirection="column"
          minW="0"
        >
          <LabelSettingsPanel
            settings={settings}
            onChange={changeSettings}
            page={run.page}
            pages={run.pages}
            onPage={setPage}
            onReset={reset}
            fill={wide}
          />
        </Box>

        {/* THE RIGHT COLUMN — the Pratinjau on top, one paper as it will print; under it Yang Dicetak, every label once
            with its count (owner: *"kasih pratinjau di atas qrcodenya dan jumlahnya, bisa diedit jumlahnya, semua qrcode
            yang sekarang bukan pratinjau jadi yang di print"*, the-print-list-is-each-label-and-its-count). */}
        <Stack gap="section" minW="0" className="no-print" gridColumn={{ lg: "2" }} gridRow={{ lg: "2" }}>
          <Card.Root minW="0" data-testid="labels-preview">
            <Card.Body>
              <Stack gap="card">
                <Flex align="baseline" gap="2" wrap="wrap">
                  <Text fontWeight="bold">{t("restock.labels.settings.preview")}</Text>
                  <Text fontSize="xs" color="fg.muted" data-testid="labels-preview-size">
                    {t("restock.labels.settings.previewSize", {
                      width: settings.paperWidth,
                      height: settings.paperHeight,
                      rows: settings.rows,
                      columns: settings.columns,
                    })}
                  </Text>
                </Flex>

                {previewLabels.length === 0 ? (
                  // AN EMPTY RUN SAYS WHY (an-empty-list-shows-a-hint) — nothing of this delivery went into stock.
                  <EmptyHint icon={Tags} title={t("restock.labels.none")} testId="labels-empty" />
                ) : (
                  // ONE PAPER on a grey ground, as large as the card holds; a paper wider than a phone scrolls in it
                  // (nothing-runs-past-a-phones-edge).
                  <Box ref={previewRef} bg="bg.muted" borderRadius="md" p="card" overflowX="auto" minW="0">
                    <Flex justify="center">
                      <Box flexShrink={0} bg="white" borderRadius="sm" boxShadow="sm" overflow="hidden">
                        <Box style={{ zoom: scale }}>
                          <LabelPaper labels={previewLabels} settings={settings} today={today} testId="labels-paper-0" />
                        </Box>
                      </Box>
                    </Flex>
                  </Box>
                )}
              </Stack>
            </Card.Body>
          </Card.Root>

          {(entries.length > 0 || (!one && readySets.length > 0)) && (
            <Card.Root minW="0" data-testid="labels-to-print">
              <Card.Body>
                <Stack gap="card">
                  <Flex align="baseline" gap="2" wrap="wrap">
                    <Text fontWeight="bold">{t("restock.labels.settings.toPrint")}</Text>
                    <Text fontSize="xs" color="fg.muted" data-testid="labels-to-print-total">
                      {t("restock.labels.settings.toPrintLine", { total: job.length, kinds: labels.length })}
                    </Text>
                  </Flex>

                  {/* EVERY LABEL ONCE, WITH ITS COUNT — the sticker on a grey tile, the product and its placement, and how
                      many to print, typed over. Several restocks: one group each, under its number and status, in the
                      order they print (labels-print-several-restocks). */}
                  <Stack gap="section" className="labels-sheet" data-testid="labels-sheet">
                    {readySets.map((set) => {
                      const id = set.id.toString();
                      const items = entries.filter((e) => e.set.id === set.id);

                      return (
                        // Where a row of the Restok card lands (labels-a-restock-jumps-to-its-labels) — clear of the
                        // window's top, blinking once.
                        <Stack
                          key={id}
                          gap="card"
                          data-jump={`restock-${id}`}
                          scrollMarginTop="page"
                          borderRadius="md"
                          css={FLASH_ON_LANDING}
                          data-testid={`labels-group-${id}`}
                        >
                          {!one && (
                            <Flex align="center" gap="2" wrap="wrap">
                              <Text fontWeight="bold">#{id}</Text>
                              {set.restock && <RestockStatusBadge status={set.restock.status} />}
                              <Text fontSize="xs" color="fg.muted">
                                {t("restock.labels.restocks.labelCount", { count: printedOf(set.id) })}
                              </Text>
                            </Flex>
                          )}

                          {/* ARRIVED, NOT COUNTED (labels-print-from-arrived) — said once a restock: no placement on its
                              labels yet, and the counts are what was ordered. */}
                          {set.arrived && (
                            <Flex align="flex-start" gap="2" color="fg.muted" fontSize="sm" data-testid="labels-arrived-note">
                              <Icon as={Info} boxSize="4" color="info.fg" flexShrink={0} mt="0.5" />
                              <Text>{t("restock.labels.arrivedNote")}</Text>
                            </Flex>
                          )}

                          {/* The honest hard case: broken and missing units never entered stock, so they got no label. */}
                          {set.excludedCount > 0n && (
                            <Flex align="center" gap="2" color="fg.muted" fontSize="sm" data-testid="labels-excluded">
                              <Icon as={TriangleAlert} boxSize="4" color="warning.fg" flexShrink={0} />
                              <Text>{t("restock.labels.excluded", { count: Number(set.excludedCount) })}</Text>
                            </Flex>
                          )}

                          {items.length === 0 ? (
                            <Text fontSize="sm" color="fg.muted">
                              {t("restock.labels.none")}
                            </Text>
                          ) : (
                            <Grid templateColumns="repeat(auto-fill, minmax(min(15rem, 100%), 1fr))" gap="card">
                              {items.map((entry) => (
                                <LabelItem
                                  key={entry.key}
                                  entry={entry}
                                  index={entries.indexOf(entry)}
                                  count={countOf(entry)}
                                  value={counts[entry.key] ?? String(defaultCount(entry.label))}
                                  onChange={(value) => setCounts((prev) => ({ ...prev, [entry.key]: value }))}
                                  settings={settings}
                                  today={today}
                                  stickerScale={stickerScale}
                                />
                              ))}
                            </Grid>
                          )}
                        </Stack>
                      );
                    })}
                  </Stack>
                </Stack>
              </Card.Body>
            </Card.Root>
          )}
        </Stack>
      </Grid>

      {/* WHAT PRINTS — every paper of the run, at its true size, one paper a page. Hidden on screen; outside the app's
          root, so the print can drop everything else whole. */}
      <Portal>
        <div className="labels-print-root" data-testid="labels-print-root">
          {papers.map((paperLabels, i) => (
            <LabelPaper key={i} labels={paperLabels} settings={settings} today={today} />
          ))}
        </div>
      </Portal>
    </Stack>
  );
}

// ONE LABEL IN YANG DICETAK — its sticker on a grey tile, the product's name, where it is and how many there, and how
// many of it to print, typed over (the-print-list-is-each-label-and-its-count). `index` is its place in the whole run,
// across restocks, so the test ids read down the page.
function LabelItem({
  entry,
  index,
  count,
  value,
  onChange,
  settings,
  today,
  stickerScale,
}: {
  entry: Entry;
  index: number;
  count: number;
  value: string;
  onChange: (value: string) => void;
  settings: LabelSettings;
  today: string;
  stickerScale: number;
}) {
  const { t } = useTranslation();
  const { label } = entry;

  return (
    <Stack
      gap="2"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      p="3"
      opacity={count === 0 ? 0.55 : 1}
      data-testid={`labels-item-${index}`}
    >
      <Flex justify="center" bg="bg.muted" borderRadius="sm" p="2" overflowX="auto">
        <Box flexShrink={0} bg="white" boxShadow="xs" borderRadius="xs" overflow="hidden">
          <Box style={{ zoom: stickerScale }}>
            <LabelSticker label={label} settings={settings} today={today} />
          </Box>
        </Box>
      </Flex>
      {/* The name on its own line; under it where it is and how many there, beside the count. */}
      <Text fontSize="sm" fontWeight="bold" lineClamp={1} title={label.name}>
        {label.name}
      </Text>
      <Flex align="center" gap="2">
        <Text fontSize="xs" color="fg.muted" flex="1" minW="0" data-testid={`labels-item-${index}-where`}>
          {label.placementCode
            ? `${label.placementCode} · ${t("restock.labels.settings.onPlacement", { count: Number(label.quantity) })}`
            : t("restock.labels.settings.ordered", { count: Number(label.quantity) })}
        </Text>
        <QuantityInput
          min={0}
          width="12"
          value={value}
          aria-label={t("restock.labels.settings.countOf", { name: label.name, placement: label.placementCode })}
          testId={`labels-count-${index}`}
          onChange={onChange}
        />
      </Flex>
    </Stack>
  );
}

// The page's print rules — the page's size IS the paper's, no margin; the app and everything but the run's papers is
// dropped; one paper a page. Written with the settings in it, because `@page` takes no variables.
function PrintStyles({ settings }: { settings: LabelSettings }) {
  return (
    <style>{`
      .labels-print-root { display: none; }
      @media print {
        @page { size: ${settings.paperWidth}mm ${settings.paperHeight}mm; margin: 0; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        body > *:not(.labels-print-root) { display: none !important; }
        .labels-print-root { display: block !important; }
        .labels-print-root .label-paper { break-after: page; page-break-after: always; }
        .labels-print-root .label-paper:last-child { break-after: auto; page-break-after: auto; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `}</style>
  );
}
