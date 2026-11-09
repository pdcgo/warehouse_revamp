import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Span, Stack, Table, Text } from "@chakra-ui/react";

import type { RestockRequest, RestockRequestItem } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockProblemType, RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { useRackCodes } from "../../../features/racks/queries";
import { placementLabel } from "../../../features/restock/lines";
import { useProductsByIds } from "../../../features/products/queries";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { BoxStats } from "../../../features/restock/BoxStats";
import {
  brokenQuantity,
  goodQuantity,
  missingQuantity,
  problemNotes,
  problemValue,
} from "../../../features/restock/summary";
import { LineNoteIcon } from "../../../features/restock/LineNoteIcon";
import { PhotoView } from "../../../features/restock/PhotoView";
import { brokenPhotoSample, brokenRackSample } from "../../../features/restock/photoSamples";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiahNumber } from "../../../lib/money";

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// THE LINES, AS THE WAREHOUSE COUNTED THEM — what was ordered, what the box held, and WHERE the good units went. The Produk
// section's content: the page's Section draws the card and its title, so this draws none (never a card inside a card).
//
// WHAT THE DOOR NEEDS, AND NOTHING ELSE (owner: *"di warehouse tidak perlu menampilkan pemasok"*, *"harga barang dan
// totalnya juga tidak perlu, gambar perlu"*, the-warehouse-reads-the-box-not-the-purchase): the product's PICTURE — the
// crew matches a box by it before the SKU — and no supplier, no price, no line total. Those are the selling team's
// purchase, and nothing at the door turns on them. The picture is read with THIS warehouse's team, as the accept page
// reads its covers.
//
// The count columns — ordered · received · good · broken · missing — because this is the side that WROTE them at the door.
// Broken and missing carry this warehouse's note and the value the system filled (the-problem-price-is-filled-by-the-system);
// missing is worked out, never typed (a-short-unit-at-the-door-is-missing).
//
// PLACEMENT is this page's own column: counting and shelving are one act, and every good unit is on a placement
// (there-is-no-unplaced-pile) — shown by its CODE, which is what is painted on the aisle. It appears once accepted;
// before then nothing has been put anywhere, and an em dash would invite the crew to wonder which shelf they forgot.
//
// THE STATISTICS LEAD (owner: *"di produk kasih statistik"*, the-restock-page-leads-with-the-box): what the box is, in
// five cards over the table — BoxStats, which the selling team's page leads with too.
//
// THE SCREEN RULES (the-warehouse-restock-detail-follows-the-screen-rules): no cell is over two lines — the line's note is
// an icon beside the product, a problem's note shares the line of what it was worth (one-context-per-column-and-never-three-
// lines); a row lights up; on a phone each line is a block (a-phone-reads-each-line-as-a-block).
//
// THE BROKEN UNITS' PHOTO (a-broken-product-carries-a-photo) — a thumbnail beside the broken count, opening it whole.
// WHERE THE BROKEN UNITS WENT (the-detail-pages-show-the-slip-and-the-broken-rack) — a line under the good units' places
// when they were put on a rack. ⚠ Both SAMPLES (photoSamples.ts); the rack goes against a business decision.
export function LinesCard({
  request,
  brokenPhotoMark,
  brokenRackMark,
}: {
  request: RestockRequest;
  /** The page's mark on the broken photo — a sample until the received line carries one. */
  brokenPhotoMark?: ReactNode;
  /** The page's mark on the broken units' rack — a sample until the received line carries one. */
  brokenRackMark?: ReactNode;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const counted = request.status === RestockRequestStatus.ACCEPTED;
  const items = request.items;

  const rackCodes = useRackCodes({ warehouseId: request.warehouseId, enabled: counted });
  const codes = rackCodes.data ?? {};

  const covers = useProductsByIds({
    teamId: request.warehouseId,
    productIds: useMemo(() => items.map((item) => item.productId), [items]),
  });
  // Two lines — the name and the SKU, the line's snapshot of what was ordered; its note, when it has one, the icon at its
  // end (a phone's block says the note in words instead, so it takes the product without it).
  const productOf = (item: RestockRequestItem, withNote = true) => {
    const cover = covers.data?.get(item.productId.toString());

    return (
      <ProductListItem
        product={{
          id: item.productId,
          productCode: item.productCode,
          name: item.name,
          defaultImageUrl: cover?.defaultImageUrl,
          defaultImageThumbnailUrl: cover?.defaultImageThumbnailUrl,
        }}
        action={withNote && item.note ? <LineNoteIcon note={item.note} productId={item.productId} /> : undefined}
      />
    );
  };

  const photoOf = (item: RestockRequestItem) => {
    const url = brokenPhotoSample(item);

    return url ? (
      <PhotoView
        url={url}
        title={t("restock.detail.brokenPhoto.title")}
        alt={t("restock.detail.brokenPhoto.alt", { name: item.name })}
        subject={item.name}
        mark={brokenPhotoMark}
        testId={`restock-detail-broken-photo-${item.productId}`}
      />
    ) : null;
  };
  const rackOf = (item: RestockRequestItem) => {
    const rack = brokenRackSample(item, codes);

    return rack ? (
      <HStack gap="1.5" data-testid={`restock-detail-broken-rack-${item.productId}`}>
        <Text fontSize="xs" color="error.fg">
          {t("restock.detail.brokenRack", { count: Number(brokenQuantity(item)), rack })}
        </Text>
        {brokenRackMark}
      </HStack>
    ) : null;
  };


  return (
    <Stack gap="card" minW="0">
      <BoxStats request={request} />

      {isMobile ? (
        <Stack gap="3" data-testid="restock-detail-items">
          {items.map((item) => (
            <LineBlock
              key={item.id.toString()}
              item={item}
              product={productOf(item, false)}
              counted={counted}
              places={counted ? placementLabel(t, item, codes) : ""}
              photo={photoOf(item)}
              rack={rackOf(item)}
            />
          ))}
        </Stack>
      ) : (
        <Table.ScrollArea>
          <Table.Root size="sm" data-testid="restock-detail-items">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("restock.detail.product")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("restock.detail.ordered")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("restock.detail.received")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("restock.detail.good")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end" data-testid="restock-detail-col-broken">
                  {t("restock.problem.broken")}
                </Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end" data-testid="restock-detail-col-missing">
                  {t("restock.problem.missing")}
                </Table.ColumnHeader>
                {counted && <Table.ColumnHeader>{t("restock.detail.placement")}</Table.ColumnHeader>}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item) => (
                <Table.Row key={item.id.toString()} css={LIGHTS_UP} data-testid={`restock-detail-item-${item.productId}`}>
                  <Table.Cell minW="64">{productOf(item)}</Table.Cell>
                  <Table.Cell textAlign="end">{item.count.toString()}</Table.Cell>
                  <CountCell
                    counted={counted}
                    value={item.receivedCount}
                    bold={counted && item.receivedCount !== item.count}
                    testId={`restock-detail-received-${item.productId}`}
                  />
                  <CountCell counted={counted} value={goodQuantity(item)} testId={`restock-detail-good-${item.productId}`} />
                  <ProblemCell
                    item={item}
                    type={RestockProblemType.BROKEN}
                    photo={photoOf(item)}
                    testId={`restock-detail-broken-${item.productId}`}
                  />
                  <ProblemCell item={item} type={RestockProblemType.MISSING} testId={`restock-detail-missing-${item.productId}`} />
                  {counted && (
                    // Two lines at most: where the good units went, then — when they were put on a rack — the broken ones.
                    <Table.Cell data-testid={`restock-detail-placement-${item.productId}`}>
                      <Stack gap="0.5">
                        <Text>{placementLabel(t, item, codes) || "—"}</Text>
                        {rackOf(item)}
                      </Stack>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      )}

    </Stack>
  );
}

function CountCell({ counted, value, bold, testId }: { counted: boolean; value: bigint; bold?: boolean; testId: string }) {
  return (
    <Table.Cell textAlign="end" color={counted ? undefined : "fg.muted"} data-testid={testId}>
      {counted ? (
        <Text as="span" fontWeight={bold ? "semibold" : "normal"}>
          {value.toString()}
        </Text>
      ) : (
        "—"
      )}
    </Table.Cell>
  );
}

// How many, then — on ONE second line — what they were worth (system-filled) and this warehouse's note, cut when long. A
// zero is an em dash. A broken row's photo sits beside its count, so the cell grows no line.
function ProblemCell({
  item,
  type,
  photo,
  testId,
}: {
  item: RestockRequestItem;
  type: RestockProblemType;
  photo?: ReactNode;
  testId: string;
}) {
  const { t } = useTranslation();
  const count = type === RestockProblemType.BROKEN ? brokenQuantity(item) : missingQuantity(item);

  if (count === 0n) {
    return (
      <Table.Cell textAlign="end" color="fg.muted" data-testid={testId}>
        —
      </Table.Cell>
    );
  }

  const note = problemNotes(item, type);

  return (
    <Table.Cell textAlign="end" data-testid={testId}>
      <Stack gap="0" align="end">
        <HStack gap="2" justify="end">
          {photo}
          <Text as="span" fontWeight="semibold" color="error.fg" data-testid={`${testId}-count`}>
            {count.toString()}
          </Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted" lineClamp={1} maxW="14rem" title={note || undefined}>
          <Span data-testid={`${testId}-value`}>
            {t("restock.detail.problemWorth", { amount: formatRupiahNumber(problemValue(item, type)) })}
          </Span>
          {note && (
            <Span data-testid={`${testId}-note`}>
              {" · "}
              {note}
            </Span>
          )}
        </Text>
      </Stack>
    </Table.Cell>
  );
}

// ONE LINE ON A PHONE (a-phone-reads-each-line-as-a-block) — the product with its picture at full width, how many were
// ordered, what came and was good, each problem with its worth and note, where it went; the line's note in words.
function LineBlock({
  item,
  product,
  counted,
  places,
  photo,
  rack,
}: {
  item: RestockRequestItem;
  product: ReactNode;
  counted: boolean;
  places: string;
  photo: ReactNode;
  rack: ReactNode;
}) {
  const { t } = useTranslation();
  const pid = item.productId;

  const problem = (type: RestockProblemType, label: string, testId: string) => {
    const count = type === RestockProblemType.BROKEN ? brokenQuantity(item) : missingQuantity(item);
    if (count === 0n) return null;
    const note = problemNotes(item, type);

    return (
      <Text fontSize="sm" color="error.fg" data-testid={testId}>
        <Span fontWeight="semibold" data-testid={`${testId}-count`}>
          {label} {count.toString()}
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
      {product}
      {/* How many were ordered — no price: the money is the selling team's purchase. */}
      <Text fontSize="sm" color="fg.muted" data-testid={`restock-detail-ordered-${pid}`}>
        {t("restock.detail.ordered")}{" "}
        <Span color="fg">{item.count.toString()}</Span>
      </Text>
      {counted && (
        <Text fontSize="sm" color="fg.muted">
          {t("restock.detail.received")}{" "}
          <Span color="fg" fontWeight={item.receivedCount !== item.count ? "semibold" : undefined} data-testid={`restock-detail-received-${pid}`}>
            {item.receivedCount.toString()}
          </Span>
          {" · "}
          {t("restock.detail.good")}{" "}
          <Span color="fg" data-testid={`restock-detail-good-${pid}`}>
            {goodQuantity(item).toString()}
          </Span>
        </Text>
      )}
      {problem(RestockProblemType.BROKEN, t("restock.problem.broken"), `restock-detail-broken-${pid}`)}
      {photo}
      {problem(RestockProblemType.MISSING, t("restock.problem.missing"), `restock-detail-missing-${pid}`)}
      {places && (
        <Text fontSize="sm" color="fg.muted" data-testid={`restock-detail-placement-${pid}`}>
          {t("restock.detail.placement")}{" "}
          <Span color="fg">{places}</Span>
        </Text>
      )}
      {rack}
      {item.note && (
        <Text fontSize="sm" color="fg.muted" data-testid={`restock-detail-line-note-${pid}`}>
          {t("restock.detail.lineNote", { note: item.note })}
        </Text>
      )}
    </Stack>
  );
}
