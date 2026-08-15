import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Field,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Input,
  InputGroup,
  Spinner,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { productClient, rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSaveProduct } from "../../features/products/queries";
import { CategorySelect } from "../../components/pickers/CategorySelect";
import { formatMarkupValue, parseMarkupPercent } from "../../lib/markup";
import { parseQuantity } from "../../lib/quantity";
import { toaster } from "../../components/feedback/Toaster";
import { ProductImagesInput } from "./components/ProductImagesInput";
import type { ProductImageValue } from "./components/ProductImagesInput";

// ProductEditPage is the create/edit surface for a product as a DEDICATED PAGE, not a popup
// (issue #60) — because it now carries a category and a gallery of up to 5 images, which need room.
// One component serves both /products/new (create) and /products/:productId/edit (edit); the
// presence of :productId decides which.
export function ProductEditPage() {
  const { productId } = useParams<{ productId: string }>();
  const editing = productId !== undefined;

  // Where Back and a successful Save go. EDITING returns to the product's own page, because that is
  // the only place an edit can have been started from — you open a product, then change it — and
  // landing on the list instead loses the thing you were working on and makes you find it again.
  // CREATING has no detail page to return to, so it goes to the list, where the new row is.
  const backTo = editing ? `/products/${productId}` : "/products";
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // The write and its invalidation, declared together (#177).
  const saveProduct = useSaveProduct();

  const teamId = current?.teamId;

  // A warehouse team cannot create products (#101) — block the create form even by direct URL.
  useEffect(() => {
    if (!editing && current?.teamType === TeamType.WAREHOUSE) {
      void navigate("/products", { replace: true });
    }
  }, [editing, current?.teamType, navigate]);

  const [loading, setLoading] = useState(editing);
  const saving = saveProduct.isPending;
  const [error, setError] = useState("");

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<bigint>(0n);
  // CROSS markup, held as the PERCENT the user types ("12.5"); the wire wants basis points, and
  // converting on save keeps a half-typed "12." from round-tripping into 12 under the cursor.
  const [crossMarkup, setCrossMarkup] = useState("");
  // The hold-back buffer, kept as typed text for the same reason as the markup: a half-deleted "1"
  // must not snap back to 0 under the cursor. Empty means "hold nothing back".
  const [reservedStock, setReservedStock] = useState("");
  // LOCKED: false is the default because that is what every product has always been — available for
  // another team to sell. Saying "ours only" is a decision, so it is the one you have to make.
  const [crossLocked, setCrossLocked] = useState(false);
  const [images, setImages] = useState<ProductImageValue[]>([]);

  // On edit, load the full product (including its ordered gallery) so the form is pre-filled and the
  // page is deep-linkable.
  useEffect(() => {
    if (!editing || teamId === undefined) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await productClient.productDetail({ teamId, productId: BigInt(productId) });
        const p = res.product;

        if (!cancelled && p) {
          setSku(p.sku);
          setName(p.name);
          setDescription(p.description);
          setCategoryId(p.categoryId);
          setCrossMarkup(p.crossMarkupBps ? formatMarkupValue(p.crossMarkupBps) : "");
          setReservedStock(p.reservedStock ? String(p.reservedStock) : "");
          setCrossLocked(p.crossLocked);
          setImages(p.images.map((im) => ({ url: im.url, thumbnailUrl: im.thumbnailUrl })));
        }
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
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
  }, [editing, productId, teamId]);

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined) {
      return;
    }

    // Save is disabled while this is unusable, so reaching here with null means a submit slipped
    // past the button (Enter in a field). Refusing beats coercing: 0 would quietly hand another team
    // our cost price.
    const markupBps = parseMarkupPercent(crossMarkup);
    const reserved = parseQuantity(reservedStock);

    if (markupBps === null || reserved === null) {
      return;
    }

    setError("");

    try {
      // The invalidation travels WITH the write now (#177), which matters most on a page like this
      // one: it writes and then leaves, so the list it returns to is a different component with no
      // callback to hand a refetch to. Arriving there is a cache hit, not a fetch — and without the
      // invalidation the product just created is simply missing from the list that opens a moment
      // later. That failure does not announce itself: the save succeeded and the toast appeared.
      await saveProduct.mutateAsync(
        editing
          ? {
              productId: BigInt(productId),
              fields: {
                teamId,
                sku,
                name,
                description,
                categoryId,
                // Always sent from this form, because the form always shows it — "absent = leave
                // alone" is for callers that do not have the field on screen.
                crossMarkupBps: markupBps,
                reservedStock: reserved,
                crossLocked,
                // A present wrapper REPLACES the gallery with exactly this set.
                images: { items: images },
              },
            }
          : {
              fields: {
                teamId,
                sku,
                name,
                description,
                categoryId,
                crossMarkupBps: markupBps,
                reservedStock: reserved,
                crossLocked,
                images,
              },
            },
      );

      toaster.create({
        type: "success",
        title: editing ? t("products.toast.saved") : t("products.toast.created", { sku }),
      });

      // SAVE still goes to the list, while BACK returns to the product. They are different journeys:
      // saving finishes the job and the list is where you see it landed among the others, whereas
      // Back is "I did not mean to be here" and should undo the step that got you here.
      void navigate("/products");
    } catch (err) {
      setError(rpcError(err));
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.heading")}</Heading>
        <Text color="fg.muted" data-testid="product-edit-no-team">
          {t("products.noTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  // null means the typed markup is not a usable percent (negative, not a number, past the 1000% rail
  // the database also enforces). Saving is blocked rather than coercing it — a markup silently read
  // as 0 is a discount to another team that nobody chose.
  const crossMarkupBps = parseMarkupPercent(crossMarkup);
  // null means the typed buffer is not a usable whole quantity (a decimal, a negative, past the rail
  // the database also enforces). Same treatment as the markup: block the save rather than coerce it.
  const reservedStockValue = parseQuantity(reservedStock);

  // Category is required; SKU and name too. The backend enforces all three regardless.
  const canSave =
    sku.trim() !== "" &&
    name.trim() !== "" &&
    categoryId > 0n &&
    crossMarkupBps !== null &&
    reservedStockValue !== null;

  return (
    <Stack gap="section" maxW="5xl" data-testid="product-edit-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="product-edit-back"
          onClick={() => navigate(backTo)}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{editing ? t("products.form.editTitle") : t("products.form.newTitle")}</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="product-edit-error">
          {error}
        </Text>
      )}

      <form onSubmit={save} noValidate>
        <Stack gap="section">
          {/* Gallery left, details right — the two are read side by side, not one after the other:
              the picture is what tells you the fields describe the right thing, so it leads. They
              collapse to one column below lg, where two columns would leave neither enough room.
              `alignItems=start` keeps the shorter card its own height instead of stretching it. */}
          <Grid templateColumns={{ base: "1fr", lg: "2fr 3fr" }} gap="section" alignItems="start">
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Text fontWeight="medium">{t("products.images")}</Text>
                  <ProductImagesInput teamId={teamId ?? 0n} value={images} onChange={setImages} />
                </Stack>
              </Card.Body>
            </Card.Root>

            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <Field.Root required>
                    <Field.Label>{t("products.field.sku")}</Field.Label>
                    <Input value={sku} data-testid="product-edit-sku" onChange={(e) => setSku(e.target.value)} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("products.field.name")}</Field.Label>
                    <Input value={name} data-testid="product-edit-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("products.field.description")}</Field.Label>
                    {/* Roomy on purpose: a catalogue description is a paragraph, not a line, and a
                        two-row box makes people write to the box instead of to the product. */}
                    <Textarea
                      value={description}
                      rows={6}
                      data-testid="product-edit-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("products.field.category")}</Field.Label>
                    <CategorySelect
                      value={categoryId}
                      onChange={setCategoryId}
                      placeholder={t("products.form.categoryPlaceholder")}
                      leafOnly
                    />
                    <Field.HelperText>{t("products.form.categoryHelp")}</Field.HelperText>
                  </Field.Root>

                  {/* RESERVED: units held back from selling, so available = on hand − reserved. A
                      property of the ITEM, not of a shelf — which is why it is typed here, once,
                      and not on each warehouse's stock. Empty and 0 both mean "hold nothing back". */}
                  <Field.Root invalid={reservedStockValue === null}>
                    <Field.Label>{t("products.field.reservedStock")}</Field.Label>
                    <InputGroup endElement={t("products.form.units")}>
                      <Input
                        value={reservedStock}
                        inputMode="numeric"
                        placeholder="0"
                        data-testid="product-edit-reserved-stock"
                        onChange={(e) => setReservedStock(e.target.value)}
                      />
                    </InputGroup>
                    {reservedStockValue === null ? (
                      <Field.ErrorText>{t("products.form.reservedStockInvalid")}</Field.ErrorText>
                    ) : (
                      <Field.HelperText>{t("products.form.reservedStockHelp")}</Field.HelperText>
                    )}
                  </Field.Root>

                  {/* CROSS: another team sells this product on its own order, out of our stock, and
                      pays us this much over our cost. Typed as a percent — the wire keeps basis
                      points. Empty and 0 are the same instruction here: charge nothing. */}
                  <Field.Root invalid={crossMarkupBps === null}>
                    <Field.Label>{t("products.field.crossMarkup")}</Field.Label>
                    <InputGroup endElement="%">
                      <Input
                        value={crossMarkup}
                        inputMode="decimal"
                        placeholder="0"
                        data-testid="product-edit-cross-markup"
                        onChange={(e) => setCrossMarkup(e.target.value)}
                      />
                    </InputGroup>
                    {crossMarkupBps === null ? (
                      <Field.ErrorText>{t("products.form.crossMarkupInvalid")}</Field.ErrorText>
                    ) : (
                      <Field.HelperText>{t("products.form.crossMarkupHelp")}</Field.HelperText>
                    )}
                  </Field.Root>

                  {/* LOCKED is settable HERE as well as from the list, and that is deliberate: the
                      list is where you sweep the whole catalogue, but a product that was never meant
                      to leave the team has to be able to say so at BIRTH. Created unlocked and
                      locked a minute later is a minute during which another team can order it. */}
                  <Field.Root>
                    <Switch.Root
                      checked={crossLocked}
                      data-testid="product-edit-cross-locked"
                      onCheckedChange={(e) => setCrossLocked(e.checked)}
                    >
                      <Switch.HiddenInput />
                      <Switch.Control />
                      <Switch.Label>{t("products.field.crossLocked")}</Switch.Label>
                    </Switch.Root>
                    <Field.HelperText>{t("products.form.crossLockedHelp")}</Field.HelperText>
                  </Field.Root>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Grid>

          <Flex justify="end">
            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="product-edit-save"
            >
              {editing ? t("products.save") : t("products.create")}
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}
