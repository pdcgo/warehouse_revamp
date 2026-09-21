import type { ReactNode } from "react";
import { Badge, Card, HStack, Separator, Stack, StackSeparator, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatRupiah } from "../../lib/money";

/** ONE PRODUCT AS THE OUTSIDE APP SENT IT — a marketplace's own words, not a row of our catalogue.
 *
 * A TITLE AND A PRICE, AND THAT IS ALL THERE IS (owner). There is NO product code on an external
 * line: not ours, because nothing has been mapped yet, and not theirs either — a scrape reads a
 * listing page, and a listing page shows a buyer a name and a number. `external_sku` exists on the
 * wire and is usually empty; a column for it would be a column of blanks that implies we know
 * something about the line that we do not.
 *
 * `OrderDraftItem.product_id` is deliberately absent too: the moment a line names one of our
 * products it is no longer external, and showing it here would let a mapping be read as evidence of
 * itself. A screen that has both shows the mapping in its own column, beside this. */
export interface ExternalProduct {
  /** Stable key for the row — the draft item's id, where there is one. A line the app pushed before
   * anybody saved it has none, and the list falls back to its position. */
  id?: bigint | number | string;

  /** The marketplace's TITLE, verbatim. Rendered exactly as it arrived: no case fixing, no trimming
   * of what is inside it, no "tidying". It is the evidence of what the buyer actually bought, and it
   * is what somebody pastes back into the marketplace's own search to check a doubtful mapping — a
   * title we have improved is one that comes back not found.
   *
   * May be MISSING: a scrape reads what the page gave it, and a page that gave nothing leaves this
   * empty. That is a fact about the line, not a hole to paper over — see `name` handling below. */
  name?: string;

  /** Whole rupiah, as scraped — what the BUYER was charged, which is not a price this system knows.
   * We have no catalogue entry here and therefore no cost, no margin and no HPP: this number is the
   * marketplace's, and the only thing anyone can do with it is read it.
   *
   * `undefined` means the scrape read no price. `0n` is different and is NOT treated as absent — it
   * is a real number the app sent, and one worth looking at twice. */
  price?: bigint;

  /** How many. `0` and `undefined` mean the SAME thing — not read — because `OrderDraftItem.quantity`
   * is an unconstrained `uint32` whose zero is exactly the unreadable case (an order line for zero of
   * something is not a line anybody wrote).
   *
   * ⚠ That is deliberately the opposite of `price`, where `0n` is kept as a number. Zero rupiah is a
   * price; zero pieces is an absence. */
  quantity?: number;
}

export interface ProductListExternalProps {
  items: ExternalProduct[];

  /** The card's heading, TITLE CASE (owner) — defaults to "Products From The App", the same casing
   * the app's dialog titles use.
   *
   * ⚠ IT IS NOT DECORATION. This card sits on a screen beside real catalogue lines, and the title is
   * the first thing read — so it says whose products these are before anybody starts reading titles
   * and prices. A caller overrides it when the screen already gives the origin a better name. */
  title?: ReactNode;

  /** Which app or marketplace this came from — a draft's `source`. Named ONCE, in the card's
   * description, rather than as a badge on each row: every line inside this card has the same origin,
   * so a per-row marker is the same word repeated down the page. */
  source?: string;

  /** Trailing content per row — a map-to-product control, a remove button, a tick. Given the item and
   * its index so a caller can key its own handlers. */
  action?: (item: ExternalProduct, index: number) => ReactNode;

  /** Sum the lines underneath. Off by default: this list is quoted inside a card that often has its
   * own money summary, and two totals for one set of lines is how they start disagreeing. */
  showTotal?: boolean;

  /** Replaces the default "the app sent no products" line. An empty list ALWAYS renders something —
   * a blank space reads as a screen that failed to load. */
  empty?: ReactNode;
}

// ProductListExternal shows the products of an order draft AS THE OUTSIDE APP SENT THEM.
//
// A draft can be pushed in over the API by another app (OrderDraftPush), and what it carries is a
// TITLE AND A PRICE. That is the whole of it (owner): no product code, no product id, no cover image,
// no stock, no owning team, no cost. It is a quotation of somebody else's record, and the shortness of
// the row is the honest shape of what a scrape actually knows.
//
// ⚠ THAT IS WHY IT IS NOT `ProductListItem`. The two are meant to look different at a glance, and
// this one is deliberately plainer: no avatar, no stock badge, no team badge. Dressing a scraped
// title in catalogue chrome would make an unmapped line read as a product this warehouse holds —
// which is the single most expensive misreading available on the draft screen, because acting on it
// means picking stock for a product nobody has matched.
//
// ⚠ IT IS ONE CARD AROUND THE WHOLE LIST (owner) — a titled box, not a stack of boxes. The card is
// the BOUNDARY between somebody else's data and ours: the screen that shows this also shows real
// catalogue lines, and the border plus the heading are what say where the outside world stops. Giving
// each product its own card would spend that meaning on separating line 1 from line 2 — a job a rule
// between rows already does — and leave the list with no edge at all.
//
// It is PRESENTATIONAL and fetches nothing. It cannot: there is nothing here to fetch by.
export const description =
  "The products of an order draft AS THE OUTSIDE APP SENT THEM, in one titled card — a title and a price per line, and nothing else: an external line has no product code, ours or theirs. The card is the boundary between somebody else's data and our catalogue, which is why it is ONE box around the list rather than a box per product. Deliberately plainer than ProductListItem (no image, no stock, no team) so a scraped line can never be mistaken for a product we hold. What the app could not read is SAID so: a missing title renders as “(the app read no name)”, an unreadable quantity as a warning rather than “× 0”, and a line whose quantity is unknown contributes nothing to the total — which is then marked partial rather than quietly short.";

export function ProductListExternal({
  items,
  title,
  source,
  action,
  showTotal = false,
  empty,
}: ProductListExternalProps) {
  const { t } = useTranslation();

  // Whitespace counts as absent — a scraped title arrives padded often enough that " " would
  // otherwise render as an empty card with money beside it.
  const titleOf = (item: ExternalProduct) => item.name?.trim() ?? "";

  // Both halves of a line total have to be known for the product of them to mean anything. A line
  // missing either is skipped by the sum and SAID to be skipped — see the partial badge.
  const countable = (item: ExternalProduct) =>
    item.quantity !== undefined && item.quantity > 0 && item.price !== undefined;

  const total = items.reduce(
    (sum, item) => (countable(item) ? sum + BigInt(item.quantity!) * item.price! : sum),
    0n,
  );
  const partial = items.some((item) => !countable(item));

  return (
    <Card.Root variant="outline" w="full" data-testid="product-list-external">
      <Card.Header>
        {/* A HEADING, sized like one and with NO ICON (owner). It reads at `lg` against `sm` rows —
            the gap is what makes it scan as the card's name rather than as a first line of content,
            and this card needs that more than most: everything under it is somebody else's text, and
            a heading that blends into the lines below is one nobody reads before reading them. */}
        <Card.Title fontSize="lg" data-testid="product-list-external-title">
          {title ?? t("productListExternal.title")}
        </Card.Title>
        {/* WHO SENT THIS — "Send By External Extension" (owner), under the heading because that is
            where a heading's qualification is read. It names the browser extension that pushed the
            draft in, which is the one thing on the card saying the lines below did not come from
            here — and is what lets the rows themselves stay clean. */}
        <Card.Description fontSize="xs" data-testid="product-list-external-caption">
          {source
            ? t("productListExternal.captionFrom", { source })
            : t("productListExternal.caption")}
        </Card.Description>
        {/* A RULE UNDER THE HEADING (owner) — it closes the two lines that name the card and opens
            the list, so the description cannot be read as the first product's subtitle. */}
        <Separator mt="card" />
      </Card.Header>

      <Card.Body>
        {items.length === 0 ? (
          <Text fontSize="sm" color="fg.muted" data-testid="product-list-external-empty">
            {empty ?? t("productListExternal.empty")}
          </Text>
        ) : (
          // A RULE BETWEEN ROWS, not a box around each. An external line has no image and no code, so
          // without a divider a title floating beside a number runs into the next one — and that is
          // how somebody reads line 2's price against line 1's title.
          <Stack gap="3" separator={<StackSeparator />}>
            {items.map((item, i) => {
              const key = (item.id ?? i).toString();
              const name = titleOf(item);

              const qtyKnown = item.quantity !== undefined && item.quantity > 0;
              const priceKnown = item.price !== undefined;

              // The line total is shown only when the quantity is MORE than one. At × 1 it repeats
              // the unit price exactly, and the same number twice on one row reads as two facts.
              const showLineTotal = qtyKnown && priceKnown && item.quantity! > 1;

              return (
                <HStack
                  key={key}
                  gap="card"
                  align="start"
                  w="full"
                  data-testid={`product-list-external-row-${key}`}
                >
                  <Stack gap="0.5" flex="1" minW="0">
                    {/* Clamped at two lines, not one: a marketplace title is a keyword sentence, and
                        the part that distinguishes two of them is usually at the END. */}
                    <Text
                      fontSize="sm"
                      lineClamp={2}
                      color={name === "" ? "fg.muted" : undefined}
                      fontStyle={name === "" ? "italic" : undefined}
                      data-testid={`product-list-external-name-${key}`}
                    >
                      {name === "" ? t("productListExternal.noName") : name}
                    </Text>

                    <HStack gap="2" minW="0">
                      {qtyKnown ? (
                        <Text
                          fontSize="xs"
                          color="fg.muted"
                          whiteSpace="nowrap"
                          data-testid={`product-list-external-qty-${key}`}
                        >
                          {t("productListExternal.qty", { n: item.quantity })}
                        </Text>
                      ) : (
                        // NOT "× 0". A zero the app failed to read, printed as a number, is a lie
                        // with a multiplication sign in front of it.
                        <Badge
                          colorPalette="orange"
                          size="xs"
                          data-testid={`product-list-external-qty-unknown-${key}`}
                        >
                          {t("productListExternal.qtyUnknown")}
                        </Badge>
                      )}
                    </HStack>
                  </Stack>

                  <Stack gap="0.5" align="end" flexShrink={0}>
                    {priceKnown ? (
                      <Text
                        fontSize="sm"
                        fontWeight="medium"
                        whiteSpace="nowrap"
                        // Rp 0 is STATED, not hidden and not relabelled — it is what the app sent.
                        // The colour asks for a second look without claiming to know which of "free"
                        // and "unread" it was, because the wire cannot tell us.
                        color={item.price === 0n ? "orange.fg" : undefined}
                        data-testid={`product-list-external-price-${key}`}
                      >
                        {formatRupiah(item.price!)}
                      </Text>
                    ) : (
                      <Text
                        fontSize="sm"
                        color="fg.muted"
                        fontStyle="italic"
                        whiteSpace="nowrap"
                        data-testid={`product-list-external-price-unknown-${key}`}
                      >
                        {t("productListExternal.priceUnknown")}
                      </Text>
                    )}

                    {showLineTotal && (
                      <Text
                        fontSize="xs"
                        color="fg.muted"
                        whiteSpace="nowrap"
                        data-testid={`product-list-external-line-total-${key}`}
                      >
                        {formatRupiah(BigInt(item.quantity!) * item.price!)}
                      </Text>
                    )}
                  </Stack>

                  {action?.(item, i)}
                </HStack>
              );
            })}
          </Stack>
        )}
      </Card.Body>

      {/* IN THE CARD'S FOOTER — inside the box, because the total is a fact about THESE lines and
          nothing else. The footer's own top border closes the list, so the row needs no rule of its
          own above it. */}
      {showTotal && items.length > 0 && (
        <Card.Footer justifyContent="end" gap="2">
          <Text fontSize="sm" color="fg.muted">
            {t("productListExternal.total")}
          </Text>
          {/* A SHORT TOTAL SAYS SO. Summing only the readable lines and printing the result plain
              would be a confident number that is quietly missing money — and nobody reconciling
              against the marketplace would know which of the two was wrong. */}
          {partial && (
            <Badge colorPalette="orange" size="xs" data-testid="product-list-external-total-partial">
              {t("productListExternal.totalPartial")}
            </Badge>
          )}
          <Text fontSize="sm" fontWeight="semibold" data-testid="product-list-external-total">
            {formatRupiah(total)}
          </Text>
        </Card.Footer>
      )}
    </Card.Root>
  );
}
