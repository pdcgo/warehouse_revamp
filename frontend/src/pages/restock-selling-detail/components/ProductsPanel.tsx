import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, CloseButton, Dialog, Flex, HStack, Icon, Portal, Separator, Span, Stack, Table, Text } from "@chakra-ui/react";
import { CircleCheck } from "lucide-react";

import type { RestockRequest, RestockRequestItem } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockProblemType, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { lineTotal, unitPrice } from "../../../features/restock/lines";
import {
  brokenQuantity,
  goodQuantity,
  missingQuantity,
  problemNotes,
  problemValue,
} from "../../../features/restock/summary";
import { LineSupplier, useLineSuppliers } from "../../../features/restock/LineSupplier";
import { PhotoView } from "../../../features/restock/PhotoView";
import { BoxStats } from "../../../features/restock/BoxStats";
import { LineNoteIcon } from "../../../features/restock/LineNoteIcon";
import { brokenPhotoSample } from "../../../features/restock/photoSamples";
import { useProductsByIds } from "../../../features/products/queries";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { formatRupiahNumber } from "../../../lib/money";
import { useIsMobile } from "../../../layouts/shell";
import { type LineCorrectionView, lineCorrection } from "../../../features/receivedCount/corrections";
import { missingMark } from "../../../features/receivedCount/marks";
import { useRestockActors } from "../../../features/restock/queries";
import { RootTeamBadge } from "../../../components/entity/ActorName";

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

export interface ProductsPanelProps {
  request: RestockRequest;
  /** The READING team — whose catalogue the covers are looked up in. */
  teamId: bigint | undefined;
  /** The page's mark on the broken photo — a sample until the received line carries one. */
  brokenPhotoMark?: ReactNode;
}

// PRODUCTS — WHAT WAS ORDERED, WHERE IT WAS BOUGHT, AND WHAT THE BOX HELD.
//
// Per line: the product and the selling team's note on it (three-notes-one-writer-each), the supplier and store it
// was bought from — a deleted one still named, badged (a-deleted-supplier-still-shows-with-a-badge) — then the count:
//
//   ordered  — the line's count
//   received — what was in the box, broken units included (any-warehouse-member-counts-what-arrived)
//   good     — received − broken: what became stock
//   broken   — typed at the door, with the warehouse's note
//   missing  — ordered − received, worked out, never typed (a-short-unit-at-the-door-is-missing)
//
// Broken and missing each carry what the units were WORTH — filled by the system from the line, never typed
// (the-problem-price-is-filled-by-the-system) — because that is the figure this team claims from the supplier.
//
// No PLACE column: which shelf inside the warehouse a line went to is not a fact a buyer acts on, and the warehouse's
// placements are not readable from this team (RackList is scoped to the warehouse).
//
// Before the warehouse counts, the count columns read "—" — NOT COUNTED YET — never the 0 the fields hold, which would
// say "nothing arrived" about a box nobody has opened.
//
// THE SCREEN RULES (the-restock-detail-follows-the-screen-rules): a row lights up under the pointer; no cell is over two
// lines — the line's note is an icon beside the product, its words in the tooltip; a problem's note shares the line of
// what it was worth — and on a phone each line is a block (a-phone-reads-each-line-as-a-block).
//
// THE BROKEN UNITS' PHOTO (a-broken-product-carries-a-photo) — in the Penyesuaian dialog under the broken row, and as a
// thumbnail in a phone's block. ⚠ A SAMPLE (photoSamples.ts): nothing stores one yet.
export function ProductsPanel({ request, teamId, brokenPhotoMark }: ProductsPanelProps) {
  const { t } = useTranslation();

  const counted = request.status === RestockRequestStatus.ACCEPTED;
  const items = request.items;
  // A line Koreksi Jumlah Terima corrected (the-received-count-prototype-is-accepted): its own *Kurang (koreksi)* badge,
  // and in its detail what it is worth at the batch price — this team's money (a-stock-in-correction-keeps-the-batch-price).
  const correctionOf = (item: RestockRequestItem) => lineCorrection(item, request.countCorrections);

  const covers = useProductsByIds({
    teamId,
    productIds: useMemo(() => items.map((item) => item.productId), [items]),
  });
  const { suppliers, channels } = useLineSuppliers(teamId, items);

  const isMobile = useIsMobile();
  const coverOf = (item: RestockRequestItem) => covers.data?.get(item.productId.toString());

  // The page's Produk SECTION draws the card and the title (the-restock-detail-is-the-product-pages-shape) — never a card
  // inside a card.
  return (
        <Stack gap="card" minW="0">
          {/* What the box is, in five cards — as the warehouse's page (the-restock-page-leads-with-the-box). */}
          <BoxStats request={request} />

          {isMobile ? (
            <Stack gap="3" data-testid="restock-detail-items">
              {items.map((item) => (
                <LineBlock
                  key={item.id.toString()}
                  item={item}
                  counted={counted}
                  cover={coverOf(item)}
                  photoMark={brokenPhotoMark}
                  correction={correctionOf(item)}
                  supplier={
                    <LineSupplier
                      supplierId={item.supplierId}
                      supplierChannelId={item.supplierChannelId}
                      suppliers={suppliers}
                      channels={channels}
                      testId={`restock-detail-supplier-${item.productId}`}
                    />
                  }
                />
              ))}
            </Stack>
          ) : (
          /* The table scrolls, not the page — see the three layers in index.tsx (minW="0" on the panel, maxW on the
             card, this scroll area). */
          <Table.ScrollArea>
            <Table.Root size="sm" data-testid="restock-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>
                    <HStack gap="1.5">
                      {t("restock.detail.product")}
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>
                    <HStack gap="1.5">
                      {t("restock.detail.supplier")}
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.ordered")}</Table.ColumnHeader>
                  {/* ONE COLUMN FOR WHAT THE BOX HELD (owner: *"datang baik rusak dan kurang kepanjangan di tabel, lebih baik
                      jadi penyesuaian lalu bisa didetailkan lagi"*, the-count-is-one-adjustment-column) — its detail opens
                      in a dialog. */}
                  <Table.ColumnHeader data-testid="restock-detail-col-adjustment">{t("restock.detail.adjustment")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restock.detail.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((item) => {
                  const cover = covers.data?.get(item.productId.toString());

                  return (
                    <Table.Row key={item.id.toString()} css={LIGHTS_UP} data-testid={`restock-detail-item-${item.productId}`}>
                      {/* The product, two lines — its note, when it has one, is the icon at its end. */}
                      <Table.Cell minW="64">
                        <ProductListItem
                          product={{
                            id: item.productId,
                            productCode: item.productCode,
                            name: item.name,
                            defaultImageUrl: cover?.defaultImageUrl,
                            defaultImageThumbnailUrl: cover?.defaultImageThumbnailUrl,
                          }}
                          action={item.note ? <LineNoteIcon note={item.note} productId={item.productId} /> : undefined}
                        />
                      </Table.Cell>
                      <Table.Cell minW="48">
                        <LineSupplier
                          supplierId={item.supplierId}
                          supplierChannelId={item.supplierChannelId}
                          suppliers={suppliers}
                          channels={channels}
                          testId={`restock-detail-supplier-${item.productId}`}
                        />
                      </Table.Cell>
                      <Table.Cell textAlign="end">{item.count.toString()}</Table.Cell>
                      <Table.Cell>
                        <AdjustmentCell item={item} counted={counted} photoMark={brokenPhotoMark} correction={correctionOf(item)} />
                      </Table.Cell>
                      <Table.Cell textAlign="end">{formatRupiahNumber(unitPrice(item))}</Table.Cell>
                      <Table.Cell textAlign="end">{formatRupiahNumber(lineTotal(item))}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
          )}
        </Stack>
  );
}

// PENYESUAIAN — what the box held, ONE CELL (the-count-is-one-adjustment-column). It was four columns — Datang, Baik,
// Rusak, Kurang — and the table ran wide for figures that are mostly *as ordered*:
//
//   not counted yet    —                           the box is not open: never the 0 the fields hold
//   as ordered         ✓ Sesuai                    every unit came, none broken
//   short or broken    Baik 7 [Rusak 2] [Kurang 1]  the good units, and what went wrong as its tone's badge
//
// A counted cell is a button: it opens the line's detail in a dialog — ordered, came, good, and each problem with what it
// was worth (filled by the system) and the warehouse's note (AdjustmentDialog).
function AdjustmentCell({
  item,
  counted,
  photoMark,
  correction,
}: {
  item: RestockRequestItem;
  counted: boolean;
  photoMark?: ReactNode;
  /** The line's received-count correction: its own *Kurang (koreksi)* badge, its money in the dialog. */
  correction?: LineCorrectionView;
}) {
  const { t } = useTranslation();
  const pid = item.productId;

  if (!counted) {
    return (
      <Text color="fg.muted" title={t("restock.detail.notCounted")} data-testid={`restock-detail-adjustment-${pid}`}>
        —
      </Text>
    );
  }

  const broken = brokenQuantity(item);
  const missing = missingQuantity(item);
  const asOrdered = broken === 0n && missing === 0n && !correction;
  // The door's own Kurang — the correction's units are their own badge.
  const doorMissing = missing - (correction?.netOut ?? 0n);

  return (
    <Dialog.Root size="sm" lazyMount unmountOnExit>
      <Dialog.Trigger asChild>
        <Button
          variant="plain"
          size="xs"
          h="auto"
          px="0"
          fontWeight="normal"
          aria-label={t("restock.detail.adjustmentOpen", { name: item.name })}
          data-testid={`restock-detail-adjustment-${pid}`}
        >
          {asOrdered ? (
            <HStack gap="1" color="success.fg">
              <Icon as={CircleCheck} boxSize="4" />
              {t("restock.detail.asOrdered")}
            </HStack>
          ) : (
            <HStack gap="1.5" wrap="wrap">
              <Text as="span" textDecoration="underline" textDecorationStyle="dotted">
                {t("restock.detail.goodShort", { count: goodQuantity(item).toString() })}
              </Text>
              {broken > 0n && (
                <Badge colorPalette="error" size="sm">
                  {t("restock.problem.broken")} {broken.toString()}
                </Badge>
              )}
              {doorMissing > 0n && (
                <Badge colorPalette="warning" size="sm">
                  {t("restock.problem.missing")} {doorMissing.toString()}
                </Badge>
              )}
              {correction && (
                <Badge colorPalette="warning" variant="outline" size="sm" data-testid={`restock-detail-correction-badge-${pid}`}>
                  {t("receivedCount.badge", { count: signed(correction.netOut) })}
                </Badge>
              )}
            </HStack>
          )}
        </Button>
      </Dialog.Trigger>
      <AdjustmentDialog item={item} photoMark={photoMark} correction={correction} />
    </Dialog.Root>
  );
}

// THE LINE'S ADJUSTMENT, IN FULL — a small receipt: ordered, came, good, then each problem with what it was worth and why.
// The problems' worth is the LANDED price (the-problem-price-is-filled-by-the-system), not the line's unit price.
function AdjustmentDialog({
  item,
  photoMark,
  correction,
}: {
  item: RestockRequestItem;
  photoMark?: ReactNode;
  correction?: LineCorrectionView;
}) {
  const { t } = useTranslation();
  const pid = item.productId;
  const photo = brokenPhotoSample(item);

  const row = (label: string, value: string, testId: string, strong = false) => (
    <Flex justify="space-between" gap="3" fontWeight={strong ? "bold" : undefined}>
      <Text color={strong ? undefined : "fg.muted"}>{label}</Text>
      <Text whiteSpace="nowrap" data-testid={testId}>
        {value}
      </Text>
    </Flex>
  );

  const problem = (type: RestockProblemType, label: string, testId: string) => {
    // The door's own Kurang here; a correction's units are their own row below.
    const fixed = type === RestockProblemType.MISSING && correction ? correction : undefined;
    const count =
      (type === RestockProblemType.BROKEN ? brokenQuantity(item) : missingQuantity(item)) - (fixed?.netOut ?? 0n);
    if (count === 0n) {
      return row(label, "—", testId);
    }
    const note = problemNotes(item, type);

    return (
      <Stack gap="0.5" data-testid={testId}>
        <Flex justify="space-between" gap="3">
          <Text color="fg.muted">{label}</Text>
          <Text fontWeight="bold" color={type === RestockProblemType.BROKEN ? "error.fg" : "warning.fg"} data-testid={`${testId}-count`}>
            {count.toString()}
          </Text>
        </Flex>
        <Text fontSize="xs" color="fg.muted" textAlign="end" data-testid={`${testId}-value`}>
          {t("restock.detail.problemWorth", { amount: formatRupiahNumber(problemValue(item, type) - (fixed?.value ?? 0)) })}
        </Text>
        {note && (
          <Text fontSize="xs" color="fg.muted" textAlign="end" whiteSpace="pre-wrap" wordBreak="break-word" data-testid={`${testId}-note`}>
            {note}
          </Text>
        )}
        {/* A THUMBNAIL, held right with the row's figures — it opens the photo whole (owner: *"gambar rusak di selling
            perkecil saja, nanti bisa preview lagi"*, a-door-photo-is-a-thumbnail-that-opens-whole). */}
        {type === RestockProblemType.BROKEN && photo && (
          <Flex justify="end">
            <PhotoView
              url={photo}
              title={t("restock.detail.brokenPhoto.title")}
              alt={t("restock.detail.brokenPhoto.alt", { name: item.name })}
              subject={item.name}
              mark={photoMark}
              testId={`restock-detail-broken-photo-${pid}`}
            />
          </Flex>
        )}
      </Stack>
    );
  };

  return (
    <Portal>
      {/* A row lights up and a page may open from it — no click in here reaches it. */}
      <Dialog.Backdrop onClick={(e) => e.stopPropagation()} />
      <Dialog.Positioner onClick={(e) => e.stopPropagation()}>
        <Dialog.Content data-testid={`restock-detail-adjustment-${pid}-dialog`}>
          <Dialog.Header>
            <Stack gap="0.5" minW="0">
              <Dialog.Title>{t("restock.detail.adjustment")}</Dialog.Title>
              <Text fontSize="sm" color="fg.muted" truncate>
                {item.name} · {item.productCode}
              </Text>
            </Stack>
          </Dialog.Header>
          <Dialog.CloseTrigger asChild>
            <CloseButton size="sm" />
          </Dialog.CloseTrigger>
          <Dialog.Body pb="6">
            <Stack gap="2" fontSize="sm">
              {row(t("restock.detail.ordered"), item.count.toString(), `restock-detail-ordered-${pid}`)}
              {row(
                t("restock.detail.received"),
                correction
                  ? `${item.receivedCount} (${t("receivedCount.was", { count: correction.was.toString() })})`
                  : item.receivedCount.toString(),
                `restock-detail-received-${pid}`,
              )}
              {row(t("restock.detail.good"), goodQuantity(item).toString(), `restock-detail-good-${pid}`, true)}
              <Separator />
              {problem(RestockProblemType.BROKEN, t("restock.problem.broken"), `restock-detail-broken-${pid}`)}
              {problem(RestockProblemType.MISSING, t("restock.problem.missing"), `restock-detail-missing-${pid}`)}
              {correction && <CorrectionRows correction={correction} testId={`restock-detail-correction-${pid}`} />}
            </Stack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Positioner>
    </Portal>
  );
}


// ONE LINE ON A PHONE (a-phone-reads-each-line-as-a-block) — the product at full width, where it was bought, the
// arithmetic as a line, then what the box held and what went wrong, each a line of its own; its note, when it has one,
// in words. Nothing is clamped into a narrow column.
function LineBlock({
  item,
  counted,
  cover,
  supplier,
  photoMark,
  correction,
}: {
  item: RestockRequestItem;
  counted: boolean;
  cover?: { defaultImageUrl?: string; defaultImageThumbnailUrl?: string };
  supplier: React.ReactNode;
  photoMark?: ReactNode;
  /** The line's received-count correction. */
  correction?: LineCorrectionView;
}) {
  const { t } = useTranslation();
  const broken = brokenQuantity(item);
  const missing = missingQuantity(item);
  const pid = item.productId;
  const photo = brokenPhotoSample(item);

  const problem = (type: RestockProblemType, count: bigint, label: string, testId: string) => {
    const corrected = type === RestockProblemType.MISSING ? correction : undefined;
    if (count === 0n && !corrected) return null;
    const note = problemNotes(item, type);

    return (
      <Text fontSize="sm" color="error.fg" data-testid={testId}>
        <Span fontWeight="semibold" data-testid={`${testId}-count`}>
          {label} {corrected ? missingMark(t, count, corrected.netOut) : count.toString()}
        </Span>
        <Span color="fg.muted" data-testid={`${testId}-value`}>
          {" · "}
          {formatRupiahNumber(problemValue(item, type))}
        </Span>
        {note && (
          <Span color="fg.muted" data-testid={`${testId}-note`}>
            {" · "}
            {note}
          </Span>
        )}
      </Text>
    );
  };

  return (
    <Stack gap="2" borderWidth="1px" borderRadius="md" p="3" data-testid={`restock-detail-item-${pid}`}>
      <ProductListItem
        product={{
          id: pid,
          productCode: item.productCode,
          name: item.name,
          defaultImageUrl: cover?.defaultImageUrl,
          defaultImageThumbnailUrl: cover?.defaultImageThumbnailUrl,
        }}
      />
      {supplier}
      {/* The arithmetic: how many at what, and what the line came to. */}
      <Flex justify="space-between" gap="2" fontSize="sm">
        <Text color="fg.muted">
          {item.count.toString()} × {formatRupiahNumber(unitPrice(item))}
        </Text>
        <Text fontWeight="bold" whiteSpace="nowrap">
          {formatRupiahNumber(lineTotal(item))}
        </Text>
      </Flex>
      {counted && (
        <Text fontSize="sm" color="fg.muted">
          {t("restock.detail.received")}{" "}
          <Span color="fg" fontWeight={item.receivedCount !== item.count ? "semibold" : undefined} data-testid={`restock-detail-received-${pid}`}>
            {item.receivedCount.toString()}
          </Span>
          {correction && (
            <Span color="fg.muted" data-testid={`restock-detail-received-${pid}-was`}>
              {" "}({t("receivedCount.was", { count: correction.was.toString() })})
            </Span>
          )}
          {" · "}
          {t("restock.detail.good")}{" "}
          <Span color="fg" data-testid={`restock-detail-good-${pid}`}>
            {goodQuantity(item).toString()}
          </Span>
        </Text>
      )}
      {problem(RestockProblemType.BROKEN, broken, t("restock.problem.broken"), `restock-detail-broken-${pid}`)}
      {photo && (
        <PhotoView
          url={photo}
          title={t("restock.detail.brokenPhoto.title")}
          alt={t("restock.detail.brokenPhoto.alt", { name: item.name })}
          subject={item.name}
          mark={photoMark}
          testId={`restock-detail-broken-photo-${pid}`}
        />
      )}
      {problem(RestockProblemType.MISSING, missing, t("restock.problem.missing"), `restock-detail-missing-${pid}`)}
      {item.note && (
        <Text fontSize="sm" color="fg.muted" data-testid={`restock-detail-line-note-${pid}`}>
          {t("restock.detail.lineNote", { note: item.note })}
        </Text>
      )}
    </Stack>
  );
}

/** A signed count: "+2", "−1". */
function signed(n: bigint): string {
  return n > 0n ? `+${n}` : n < 0n ? `−${-n}` : "0";
}

// A RECEIVED-COUNT CORRECTION, AS THE SELLING TEAM READS IT (a-stock-in-correction-keeps-the-batch-price): the units the
// warehouse took out as Kurang (koreksi) and what they were worth at the batch's price — the selling team bears them, as
// if typed short at accept — or the units it put back, and the loss that came off; then why and who (the line's newest).
function CorrectionRows({ correction, testId }: { correction: LineCorrectionView; testId: string }) {
  const { t } = useTranslation();
  const last = correction.last;
  const actors = useRestockActors(last ? [last.actorUserId] : []);
  const actor = last ? actors.data?.get(last.actorUserId.toString()) : undefined;
  const name = actor?.name || (last ? t("restock.table.userRef", { id: last.actorUserId.toString() }) : "");
  const out = correction.netOut;
  const value = correction.value ?? 0;

  return (
    <Stack gap="0.5" data-testid={testId}>
      <Flex justify="space-between" gap="3">
        <Text color="fg.muted">{t("receivedCount.missingCorrection")}</Text>
        <Text fontWeight="bold" color="warning.fg" data-testid={`${testId}-count`}>
          {signed(out)}
        </Text>
      </Flex>
      <Text fontSize="xs" color="fg.muted" textAlign="end" data-testid={`${testId}-value`}>
        {out >= 0n
          ? t("receivedCount.borne", { amount: formatRupiahNumber(value) })
          : t("receivedCount.lifted", { amount: formatRupiahNumber(-value) })}
      </Text>
      {last && (
        <Text fontSize="xs" color="fg.muted" textAlign="end" whiteSpace="pre-wrap" wordBreak="break-word" data-testid={`${testId}-why`}>
          “{last.reason}” — {name}
          {last.isOverride && <RootTeamBadge size="xs" ms="1" />}
        </Text>
      )}
    </Stack>
  );
}
