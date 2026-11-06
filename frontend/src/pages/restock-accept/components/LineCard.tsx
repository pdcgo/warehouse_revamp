import type { ElementType, ReactNode } from "react";
import { Box, Button, Card, Field, Flex, Grid, HStack, Icon, Spacer, Stack, Text, Textarea } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { CheckCheck, ClipboardCheck, MessageSquareText, PackageMinus, PackageX, TriangleAlert } from "lucide-react";

import type { ProductPlace } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import type { RestockRequestItem } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { toCount } from "../../../features/restock/counting";
import { FLASH_ON_LANDING } from "../../../lib/useScrollSpy";
import { formatRupiahNumber } from "../../../lib/money";
import { RadioPills } from "../../../components/inputs/RadioPills";
import { PhotoPick } from "../../../features/restock/PhotoPick";
import type { BrokenTo, LineDraft, LineState } from "../draft";
import { PcsMark } from "./PcsMark";
import { PlacementPanel } from "./PlacementPanel";

/**
 * How a line's three parts sit, from the width of the COLUMN the cards are in — not the window's: beside the info column
 * a card is ~600px wide on a 1280px screen (the-accept-page-puts-the-box-left-and-the-info-right).
 */
export type LineLayout = "three" | "two" | "stack";

export function lineLayout(columnWidth: number): LineLayout {
  // 52rem — what the three columns had at `xl` on a full-width page, the smallest they were ever drawn in.
  if (columnWidth >= 832) return "three";
  // 34rem — a count and a placement picker side by side, each still typeable.
  if (columnWidth >= 544) return "two";
  return "stack";
}

const GRID: Record<LineLayout, { columns: string; areas: string }> = {
  three: { columns: "minmax(0, 3fr) minmax(0, 4fr) minmax(0, 4fr)", areas: `"product count place"` },
  two: { columns: "minmax(0, 1fr) minmax(0, 1fr)", areas: `"product product" "count place"` },
  stack: { columns: "minmax(0, 1fr)", areas: `"product" "count" "place"` },
};

// ONE LINE OF THE BOX, in three columns (owner): WHAT IT IS · WHAT ARRIVED · WHERE IT GOES — the three questions asked at
// the door, side by side, so a long delivery is scanned down one column at a time. Where the column is narrower, what it
// is goes on top and the two typed parts sit side by side under it; narrower still (a phone), they stack: a count, a
// note and a placement picker cannot share a row narrower than that and stay typeable.
//
// The person types TWO numbers (any-warehouse-member-counts-what-arrived) — what is in the box, and how many of those
// are broken. Good and missing are worked out and shown, never typed; their worth is filled from the line
// (the-problem-price-is-filled-by-the-system). There is no picker for a "kind" of problem: broken is a count, and a
// unit short in the box is missing by arithmetic (a-short-unit-at-the-door-is-missing).
export function LineCard({
  item,
  draft,
  st,
  warehouseId,
  imageUrl,
  thumbnailUrl,
  recommendations,
  brokenPhotoMark,
  brokenRackMark,
  layout,
  update,
}: {
  item: RestockRequestItem;
  draft: LineDraft;
  st: LineState;
  warehouseId: bigint;
  imageUrl?: string;
  thumbnailUrl?: string;
  recommendations: ProductPlace[];
  /** The page's mark on the broken photo — picked and not kept yet. */
  brokenPhotoMark?: ReactNode;
  /** The page's mark on "put on a rack" — chosen and not kept yet. */
  brokenRackMark?: ReactNode;
  /** How the three parts sit — from the lines column's width (`lineLayout`). */
  layout: LineLayout;
  update: (fn: (d: LineDraft) => LineDraft) => void;
}) {
  const { t } = useTranslation();
  const pid = item.productId;

  return (
    // A JUMP FROM THE READY LINE LANDS HERE AND BLINKS (the-ready-line-jumps-to-what-it-names) — clear of the sticky
    // header, whose height the page publishes as `--accept-header-h`.
    <Card.Root
      data-testid={`accept-line-${pid}`}
      data-layout={layout}
      data-jump={`line-${pid}`}
      scrollMarginTop="calc(var(--accept-header-h, 0px) + 1rem)"
      css={FLASH_ON_LANDING}
    >
      <Card.Body>
        <Grid templateColumns={GRID[layout].columns} templateAreas={GRID[layout].areas} gap="card" alignItems="stretch">
          {/* 1 — WHAT IT IS, AND WHAT IT CAME TO. Read-only: nothing in this column is typed. The name and SKU are the
              line's snapshot — what was ordered — and only the picture is looked up. NO SUPPLIER (owner: *"supplier tidak
              perlu"*, the-line-reads-ordered-then-what-it-came-to): where it was bought is the selling team's purchase. */}
          <Stack gridArea="product" gap="card" alignSelf="start" minW="0">
            <ProductListItem
              product={{
                id: pid,
                sku: item.sku,
                name: item.name,
                defaultImageUrl: imageUrl,
                defaultImageThumbnailUrl: thumbnailUrl,
              }}
            />

            {/* "ORDERED 12" WITH THE SELLING TEAM'S WORD BESIDE IT. A line that says more than was first ordered was
                edited by the selling team (extra-units-are-added-by-the-selling-teams-edit), and the person counting
                should see why without asking. */}
            <Stack gap="1.5">
              {/* IN PCS, AND ONLY THE PCS HIGHLIGHTED (the-pcs-alone-is-highlighted) — the number the box is checked
                  against, found at a glance down a long delivery. */}
              <Flex align="center" gap="1.5" data-testid={`accept-ordered-${pid}`}>
                <Text fontSize="sm" fontWeight="bold">
                  {t("restock.accept.ordered")}
                </Text>
                <PcsMark tone="primary" testId={`accept-ordered-${pid}-pcs`}>
                  {t("restock.accept.pcs", { n: item.count.toString() })}
                </PcsMark>
              </Flex>
              {item.note !== "" && (
                <Flex gap="1.5" align="flex-start" data-testid={`accept-line-note-${pid}`}>
                  <Icon as={MessageSquareText} boxSize="3.5" color="fg.muted" mt="0.5" flexShrink={0} />
                  <Text fontSize="xs" color="fg.muted" minW="0">
                    <Text as="span" fontWeight="bold">
                      {t("restock.accept.lineNote")}
                    </Text>{" "}
                    {item.note}
                  </Text>
                </Flex>
              )}
            </Stack>

            {/* WHAT THE BOX CAME TO, UNDER WHAT WAS ORDERED (owner: *"keterangan baik, rusak, kurang taruh di bawah dipesan
                pcs produk"*) — worked out, never typed: good, broken and missing, each problem with what it was worth
                (the-problem-price-is-filled-by-the-system), in its tone once it is there. No price per piece
                (the-accept-line-shows-no-price). */}
            <Stack gap="1.5" borderTopWidth="1px" borderColor="border" pt="2" data-testid={`accept-outcome-${pid}`}>
              <Outcome
                label={t("restock.accept.good")}
                value={st.counted && !st.brokenOver ? st.good.toString() : "—"}
                tone={st.good > 0n ? "success" : undefined}
                testId={`accept-good-${pid}`}
              />
              <Outcome
                label={t("restock.problem.broken")}
                value={st.counted && !st.brokenOver ? st.broken.toString() : "—"}
                worth={st.broken > 0n && !st.brokenOver ? st.brokenValue : undefined}
                tone={st.broken > 0n && !st.brokenOver ? "error" : undefined}
                testId={`accept-broken-count-${pid}`}
                worthTestId={`accept-broken-value-${pid}`}
              />
              <Outcome
                label={t("restock.problem.missing")}
                value={st.counted && st.over === 0n ? st.missing.toString() : "—"}
                worth={st.missing > 0n ? st.missingValue : undefined}
                tone={st.missing > 0n ? "warning" : undefined}
                testId={`accept-missing-${pid}`}
                worthTestId={`accept-missing-value-${pid}`}
              />
            </Stack>
          </Stack>

          {/* 2 — WHAT ARRIVED. Two typed numbers; then what each problem needs, broken and missing in blocks of their own. */}
          <Box gridArea="count" minW="0" borderWidth="1px" borderColor="border" borderRadius="md" p="card" h="full">
            <Stack gap="card">
              <Flex align="center" gap="2">
                <Icon as={ClipboardCheck} boxSize="4" color="brand.fg" />
                <Text fontSize="sm" fontWeight="bold">
                  {t("restock.accept.count")}
                </Text>
              </Flex>

              <Flex gap="card" wrap="wrap" align="flex-start">
                <Field.Root required invalid={st.over > 0n} w="auto">
                  <Field.Label>
                    {t("restock.accept.received")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <Flex gap="2" align="center">
                    {/* No `max`: a count above the line must SHOW, with its message — clamping it back would hide the
                        very thing the selling team has to be told. */}
                    <QuantityInput
                      min={0}
                      width="16"
                      value={draft.received}
                      aria-label={t("restock.accept.received")}
                      testId={`accept-received-${pid}`}
                      // Back to 0 (or blank), the broken count goes with it: Rusak is off then, and a number left in a
                      // field nobody can reach would hold the line up (broken-waits-for-something-received).
                      onChange={(received) =>
                        update((d) => ({ ...d, received, broken: toCount(received) === 0n ? "" : d.broken }))
                      }
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      data-testid={`accept-all-arrived-${pid}`}
                      onClick={() => update((d) => ({ ...d, received: item.count.toString() }))}
                    >
                      <Icon as={CheckCheck} boxSize="4" />
                      {t("restock.accept.allArrived")}
                    </Button>
                  </Flex>
                  <Field.HelperText>{t("restock.accept.receivedHint")}</Field.HelperText>
                </Field.Root>

                {/* RUSAK IS OFF WHILE NOTHING IS RECEIVED (owner: *"rusak disabled kalau diterima 0"*,
                    broken-waits-for-something-received) — broken units are among those in the box, so with Diterima
                    blank or 0 there is nothing that could be broken. */}
                <Field.Root invalid={st.brokenOver} disabled={st.received === 0n} w="auto">
                  <Field.Label>{t("restock.accept.broken")}</Field.Label>
                  <QuantityInput
                    min={0}
                    width="16"
                    disabled={st.received === 0n}
                    value={draft.broken}
                    aria-label={t("restock.accept.broken")}
                    testId={`accept-broken-${pid}`}
                    onChange={(broken) => update((d) => ({ ...d, broken }))}
                  />
                  <Field.HelperText>{t("restock.accept.brokenHint")}</Field.HelperText>
                </Field.Root>
              </Flex>

              {/* accept-refuses-more-than-the-line-says — the warehouse counts; the selling team decides what it owns. */}
              {st.over > 0n && (
                <ErrorLine testId={`accept-over-${pid}`}>
                  {t("restock.receive.over", { n: st.over.toString() })}
                </ErrorLine>
              )}
              {st.brokenOver && (
                <ErrorLine testId={`accept-broken-error-${pid}`}>
                  {t("restock.accept.brokenOverReceived", { n: st.received.toString() })}
                </ErrorLine>
              )}

              {/* BROKEN AND MISSING, EACH ITS OWN BLOCK (owner: *"pembagian rusak dan kurang perjelas, yang sekarang terasa
                  menyatu"*, the-broken-and-the-missing-are-blocks-of-their-own) — a tinted edge and a heading in its
                  tone, so where the broken units' note, photo and rack end and the missing units' note begins is plain. */}
              {st.broken > 0n && !st.brokenOver && (
                <ProblemBlock
                  tone="error"
                  icon={PackageX}
                  title={t("restock.problem.broken")}
                  pcs={t("restock.accept.pcs", { n: st.broken.toString() })}
                  testId={`accept-broken-block-${pid}`}
                >
                  <ProblemNote
                    value={draft.brokenNote}
                    label={t("restock.accept.brokenNote")}
                    placeholder={t("restock.accept.brokenNotePlaceholder")}
                    testId={`accept-broken-note-${pid}`}
                    onChange={(brokenNote) => update((d) => ({ ...d, brokenNote }))}
                  />
                  {/* What the broken units look like (a-broken-product-carries-a-photo) — under its note, both optional. */}
                  <PhotoPick
                    file={draft.brokenPhoto}
                    onChange={(brokenPhoto) => update((d) => ({ ...d, brokenPhoto }))}
                    alt={t("restock.accept.brokenPhoto.alt")}
                    mark={brokenPhotoMark}
                    testId={`accept-broken-photo-${pid}`}
                  />
                  {/* WHERE THEY GO (owner: *"ditaruh rak itu opsional, jadi ada 2 pilihan"*,
                      a-broken-product-may-go-on-a-rack) — thrown away, as before, or onto a rack, which then needs one. */}
                  <Stack gap="1.5" data-testid={`accept-broken-to-${pid}`}>
                    <Text fontSize="xs" fontWeight="bold" color="fg.label">
                      {t("restock.accept.brokenTo.label")}
                    </Text>
                    <RadioPills<BrokenTo>
                      value={draft.brokenTo}
                      onChange={(brokenTo) => update((d) => ({ ...d, brokenTo }))}
                      ariaLabel={t("restock.accept.brokenTo.label")}
                      options={[
                        {
                          value: "discard",
                          label: t("restock.accept.brokenTo.discard"),
                          testId: `accept-broken-to-discard-${pid}`,
                        },
                        {
                          value: "rack",
                          label: t("restock.accept.brokenTo.rack"),
                          mark: brokenRackMark,
                          testId: `accept-broken-to-rack-${pid}`,
                        },
                      ]}
                    />
                    {/* The rack itself is chosen in Taruh ke penempatan, as a row marked Rusak
                        (the-broken-units-rack-is-a-marked-placement) — said here, so the choice does not look unanswered. */}
                    {draft.brokenTo === "rack" && (
                      <Text fontSize="xs" color="fg.muted" data-testid={`accept-broken-to-hint-${pid}`}>
                        {t("restock.accept.brokenTo.pickInPutaway")}
                      </Text>
                    )}
                  </Stack>
                </ProblemBlock>
              )}

              {st.missing > 0n && (
                <ProblemBlock
                  tone="warning"
                  icon={PackageMinus}
                  title={t("restock.problem.missing")}
                  pcs={t("restock.accept.pcs", { n: st.missing.toString() })}
                  testId={`accept-missing-block-${pid}`}
                >
                  <ProblemNote
                    value={draft.missingNote}
                    label={t("restock.accept.missingNote")}
                    placeholder={t("restock.accept.missingNotePlaceholder")}
                    testId={`accept-missing-note-${pid}`}
                    onChange={(missingNote) => update((d) => ({ ...d, missingNote }))}
                  />
                </ProblemBlock>
              )}
            </Stack>
          </Box>

          {/* 3 — WHERE IT GOES. */}
          <Box gridArea="place" minW="0">
            <PlacementPanel
              productId={pid}
              warehouseId={warehouseId}
              draft={draft}
              st={st}
              recommendations={recommendations}
              update={update}
            />
          </Box>
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}

// A worked-out figure: its name, the count, and — for a problem row — what it was worth, filled from the line. In its
// tone once it is there (good, broken, missing), so the three read apart at a glance.
function Outcome({
  label,
  value,
  worth,
  tone,
  testId,
  worthTestId,
}: {
  label: string;
  value: string;
  worth?: number;
  tone?: "success" | "error" | "warning";
  testId: string;
  worthTestId?: string;
}) {
  const { t } = useTranslation();

  return (
    <Flex align="baseline" gap="2" color={tone ? `${tone}.fg` : undefined}>
      <Text fontSize="sm">{label}</Text>
      <Spacer />
      {worth !== undefined && (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={worthTestId}>
          {t("restock.accept.worth", { value: formatRupiahNumber(worth) })}
        </Text>
      )}
      <Text fontWeight="bold" minW="8" textAlign="end" data-testid={testId}>
        {value}
      </Text>
    </Flex>
  );
}

// ONE PROBLEM'S OWN BLOCK — broken or missing (the-broken-and-the-missing-are-blocks-of-their-own): an edge and a
// heading in its tone, its count in pcs, and under it only what that problem asks for.
//
//   ▌ ⊠ Rusak  [1 pcs]                 ▌ ⊟ Kurang  [3 pcs]
//   ▌ Catatan barang rusak (opsional)  ▌ Catatan barang kurang (opsional)
//   ▌ [📷 Tambah Foto]                 ▌ [ … ]
//   ▌ Barang rusak (• Dibuang) ( Rak )
function ProblemBlock({
  tone,
  icon,
  title,
  pcs,
  testId,
  children,
}: {
  tone: "error" | "warning";
  icon: ElementType;
  title: string;
  pcs: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderLeftWidth="3px"
      borderLeftColor={`${tone}.solid`}
      borderRadius="md"
      p="3"
      data-tone={tone}
      data-testid={testId}
    >
      <Stack gap="field">
        <HStack gap="1.5" color={`${tone}.fg`}>
          <Icon as={icon} boxSize="4" flexShrink={0} />
          <Text fontSize="sm" fontWeight="bold">
            {title}
          </Text>
          <PcsMark tone={tone}>{pcs}</PcsMark>
        </HStack>
        {children}
      </Stack>
    </Box>
  );
}

/** The longest a problem row's note may be — the contract's `max_len` (`broken_note`, `missing_note`). */
const MAX_PROBLEM_NOTE = 200;

// The warehouse's optional word on a problem row (a-broken-reason-is-optional) — never what holds an accept up.
//
//   Catatan barang rusak (opsional)
//   [ Contoh: karung sobek, isi tumpah   ]
//                                  12/200
//
// A LABEL over it and an EXAMPLE in it (every-form-field-shows-an-example) — the label used to be the placeholder, so it
// went the moment somebody typed. How much of the limit is used under it (a-limited-field-shows-its-count). A TEXTAREA of
// two rows, as the charge's note is (owner: *"catatan pakai textarea"*): what went wrong is a sentence, and one row read
// as an input.
function ProblemNote({
  value,
  label,
  placeholder,
  testId,
  onChange,
}: {
  value: string;
  label: string;
  placeholder: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Field.Root>
      <Field.Label>
        {label}{" "}
        <Text as="span" color="fg.subtle" fontWeight="normal">
          {t("restock.accept.courier.optional")}
        </Text>
      </Field.Label>
      <Textarea
        value={value}
        maxLength={MAX_PROBLEM_NOTE}
        rows={2}
        autoresize
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
      <Field.HelperText alignSelf="end" data-testid={`${testId}-count`}>
        {value.length}/{MAX_PROBLEM_NOTE}
      </Field.HelperText>
    </Field.Root>
  );
}

function ErrorLine({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <Flex gap="1.5" align="flex-start" color="error.fg" data-testid={testId}>
      <Icon as={TriangleAlert} boxSize="4" mt="0.5" flexShrink={0} />
      <Text fontSize="sm">{children}</Text>
    </Flex>
  );
}
