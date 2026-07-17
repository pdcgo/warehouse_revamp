import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Flex,
  Input,
  Portal,
  Span,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { productClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { Pagination } from "./Pagination";
import type { PickedProduct } from "./ProductSelect";

// PageFilter.limit is validated 1..200 — a dialog page stays small so the list never scrolls far.
const PAGE_SIZE = 10;

export interface ProductPickerProps {
  /** The caller's team. In "team" scope it's the catalogue browsed; in "all" scope it only
   * authorizes the request (results are cross-team). */
  teamId: bigint;
  /** "team" (default) browses this team's catalogue (ProductList); "all" discovers products across
   * ALL teams (ProductDiscover, #110). */
  scope?: "team" | "all";
  /** The ticked product ids. Re-seeds the draft every time the dialog opens. */
  value: bigint[];
  /** Applied on Confirm with the WHOLE ticked set. An empty array means "cleared" — a legitimate
   * outcome, not an invalid state. */
  onChange: (products: PickedProduct[]) => void;
  disabled?: boolean;
  /** Overrides the default trigger button. */
  trigger?: ReactNode;
}

// ProductPicker is the MULTI-select sibling of ProductSelect (#110): where ProductSelect is an inline
// single-pick Combobox, this is a dialog you browse — a paged list of checkboxes with a server-side
// search — for picking several products at once. Ticks are DRAFT state: seeded from `value` on open,
// applied by Confirm, discarded by Cancel/Esc/close.
export const description =
  "Multi-select product picker in a dialog (#110): searchable, paginated, checkbox per row. Ticks are a draft — Confirm applies them (an empty list clears), Cancel discards. Emits each picked product's id + sku + name snapshot. `scope`: \"team\" (default, this team's catalogue) or \"all\" (cross-team discovery).";

export function ProductPicker({
  teamId,
  scope = "team",
  value,
  onChange,
  disabled,
  trigger,
}: ProductPickerProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  // The draft: ticked ids ONLY. Keeping ids (not a filter over the loaded page) is what lets a tick
  // survive paging and searching — page 2 replaces `products`, never `ticked`.
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Everything we have ever seen: id -> its sku/name snapshot. Grows from every loaded page, every
  // search hit, and the on-open resolve below; it outlives paging, searching, and closing, so a tick
  // can always be emitted with real data once its product has been seen ONCE.
  const [known, setKnown] = useState<Map<string, PickedProduct>>(new Map());

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [products, setProducts] = useState<Product[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Read inside effects WITHOUT making them dependencies: `value` is typically an inline `.map()` (a
  // fresh array identity every render) and `known` grows as pages load — depending on either would
  // re-seed or re-resolve in the middle of an edit.
  const valueRef = useRef(value);
  valueRef.current = value;
  const knownRef = useRef(known);
  knownRef.current = known;

  // The in-flight on-open resolve, so confirm() can wait for it instead of emitting blanks.
  const resolveRef = useRef<Promise<PickedProduct[]> | null>(null);
  const [confirming, setConfirming] = useState(false);

  const noTeam = teamId <= 0n;

  // A seeded id has no sku/name until its product is loaded. Resolve the missing ones on open, so a
  // selection the user never scrolls to still Confirms with a real snapshot instead of a blank one.
  // ProductDetail is team-scoped: in "all" scope a CROSS-team id cannot resolve, and that tick stays
  // id-only (preserved — never dropped; see confirm()).
  //
  // The promise is kept so confirm() can AWAIT it. Confirm is live from the first frame, and a click
  // landing inside this window used to read the not-yet-populated `known` and emit {sku:"", name:""}
  // for ids that were about to resolve — silently replacing the caller's good snapshot with blanks,
  // outcome decided purely by click timing.
  //
  // It resolves TO the products rather than only writing state: after `await`, this render's `known`
  // is still the stale captured value, so confirm() has to read the resolved data itself.
  useEffect(() => {
    if (!open || noTeam) {
      return;
    }

    let cancelled = false;

    const missing = valueRef.current.filter((id) => !knownRef.current.has(id.toString()));
    if (missing.length === 0) {
      resolveRef.current = null;

      return;
    }

    const resolving = (async () => {
      const found = await Promise.all(
        missing.map(async (productId) => {
          try {
            const res = await productClient.productDetail({ teamId, productId });
            const p = res.product;
            return p ? { id: p.id, sku: p.sku, name: p.name } : null;
          } catch {
            // Cross-team in "all" scope, or deleted. The tick survives; only its label is unknown.
            return null;
          }
        }),
      );

      // Each lookup swallows its own failure, so this never rejects — confirm() can await it without
      // a catch, and it always settles, so the button can never hang.
      return found.filter((p): p is PickedProduct => p !== null);
    })();

    resolveRef.current = resolving;

    void resolving.then((found) => {
      if (cancelled) {
        return;
      }

      setKnown((prev) => {
        const next = new Map(prev);
        for (const p of found) {
          next.set(p.id.toString(), p);
        }

        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [open, teamId, noTeam]);

  // Server-side search, debounced, >= 2 characters — mirroring ProductSelect. Below the threshold the
  // term is dropped rather than sent, so the dialog falls back to BROWSING the catalogue (q: "")
  // instead of going blank: a picker with nothing in it is useless.
  useEffect(() => {
    const term = input.trim();
    const effective = term.length >= 2 ? term : "";

    if (effective === q) {
      return;
    }

    const timer = setTimeout(() => {
      setQ(effective);
      setPage(1);
    }, 250);

    return () => clearTimeout(timer);
  }, [input, q]);

  // The page load. Only runs while open — a closed dialog costs nothing.
  useEffect(() => {
    if (!open || noTeam) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError("");

    void (async () => {
      try {
        const req = { teamId, q, page: { page, limit: PAGE_SIZE } };
        const res =
          scope === "all"
            ? await productClient.productDiscover(req)
            : await productClient.productList(req);

        if (cancelled) {
          return;
        }

        setProducts(res.products);
        setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));

        // Every product we render is one we can now describe — remember it for Confirm.
        setKnown((prev) => {
          const next = new Map(prev);
          for (const p of res.products) {
            next.set(p.id.toString(), { id: p.id, sku: p.sku, name: p.name });
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
          setProducts([]);
          setTotalItems(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, teamId, noTeam, scope, q, page]);

  // Opening re-seeds the draft from `value` and resets the browse — so a draft discarded by Cancel
  // never leaks into the next open.
  function handleOpenChange(next: boolean) {
    if (next) {
      if (disabled) {
        return;
      }

      setTicked(new Set(valueRef.current.map((id) => id.toString())));
      setInput("");
      setQ("");
      setPage(1);
      setError("");
    }

    setOpen(next);
  }

  function toggle(id: bigint, checked: boolean) {
    const key = id.toString();

    setTicked((prev) => {
      const next = new Set(prev);

      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  }

  // Confirm is ALWAYS available — including at zero ticks, which means "cleared". An id we never
  // managed to resolve is still emitted (id only): the caller asked for it, so dropping it here would
  // quietly delete their selection.
  //
  // It waits for the on-open resolve first. Without that, a click landing while those lookups are in
  // flight emits {sku:"", name:""} for ids that were ABOUT to resolve, and the caller cannot tell
  // that apart from a genuinely unresolvable one — so it overwrites a good snapshot with blanks,
  // decided purely by click timing. The resolve never rejects and always settles, so this cannot
  // hang; the button only shows a spinner while it lands.
  async function confirm() {
    let resolved: PickedProduct[] = [];

    if (resolveRef.current) {
      setConfirming(true);

      try {
        // The resolved value, not `known`: after the await, this render's `known` is still stale.
        resolved = await resolveRef.current;
      } finally {
        setConfirming(false);
      }
    }

    const lookup = new Map(known);
    for (const p of resolved) {
      lookup.set(p.id.toString(), p);
    }

    const picked = [...ticked].map(
      (key) => lookup.get(key) ?? { id: BigInt(key), sku: "", name: "" },
    );

    onChange(picked);
    setOpen(false);
  }

  const count = ticked.size;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => handleOpenChange(e.open)}
      size="md"
      scrollBehavior="inside"
    >
      <Dialog.Trigger asChild data-testid="product-picker-trigger">
        {trigger ?? <Button variant="outline" disabled={disabled}>{t("productPicker.trigger")}</Button>}
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="product-picker-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("productPicker.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                <Input
                  placeholder={t("products.searchPlaceholder")}
                  value={input}
                  disabled={noTeam}
                  data-testid="product-picker-search"
                  onChange={(e) => setInput(e.target.value)}
                />

                <Flex align="center" justify="space-between" gap="2">
                  <Text fontSize="sm" color="fg.muted" data-testid="product-picker-count">
                    {t("productPicker.selected", { n: count })}
                  </Text>

                  {/* The only way to untick a selection that isn't on the loaded page — including a
                      seeded id this scope cannot show at all. Without it those ticks are unreachable. */}
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={count === 0}
                    data-testid="product-picker-clear"
                    onClick={() => setTicked(new Set())}
                  >
                    {t("productPicker.clear")}
                  </Button>
                </Flex>

                {noTeam ? (
                  <Text color="fg.muted" data-testid="product-picker-no-team">
                    {t("productPicker.noTeam")}
                  </Text>
                ) : (
                  <>
                    {error && (
                      <Text color="red.fg" data-testid="product-picker-error">
                        {error}
                      </Text>
                    )}

                    {loading && <Spinner colorPalette="brand" />}

                    {!loading && !error && products.length === 0 && (
                      <Text color="fg.muted" data-testid="product-picker-empty">
                        {t("products.empty")}
                      </Text>
                    )}

                    {!loading && !error && products.length > 0 && (
                      <Stack gap="2" data-testid="product-picker-list">
                        {products.map((p) => (
                          <Checkbox.Root
                            key={p.id.toString()}
                            checked={ticked.has(p.id.toString())}
                            onCheckedChange={(e) => toggle(p.id, !!e.checked)}
                            data-testid={`product-picker-option-${p.id}`}
                          >
                            <Checkbox.HiddenInput />
                            <Checkbox.Control />
                            <Checkbox.Label>
                              <Stack gap="0">
                                <Span fontWeight="medium">{p.sku}</Span>
                                <Span fontSize="xs" color="fg.muted">
                                  {p.name}
                                </Span>
                              </Stack>
                            </Checkbox.Label>
                          </Checkbox.Root>
                        ))}
                      </Stack>
                    )}

                    <Pagination
                      count={totalItems}
                      pageSize={PAGE_SIZE}
                      page={page}
                      onPageChange={setPage}
                    />
                  </>
                )}
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" data-testid="product-picker-cancel">
                  {t("common.cancel")}
                </Button>
              </Dialog.ActionTrigger>

              {/* Never disabled by `count` — confirming zero ticks is how a selection gets cleared.
                  `loading` is the ONLY thing that ever blocks it, and only while the on-open resolve
                  lands: that always settles, so it cannot become the dead end this component was
                  rolled back for once already. */}
              <Button
                colorPalette="brand"
                onClick={() => void confirm()}
                loading={confirming}
                data-testid="product-picker-confirm"
              >
                {t("common.confirm")}
              </Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
