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
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { productClient, rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSaveProduct } from "../../features/products/queries";
import { CategorySelect } from "../../components/pickers/CategorySelect";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { formatMarkupValue, parseMarkupPercent } from "../../lib/markup";
import { parseQuantity } from "../../lib/quantity";
import { toaster } from "../../components/feedback/Toaster";
import { LockModeField, lockFieldsOf, lockModeOf, minimumIsUsable } from "../../features/products/ProductLock";
import type { LockMode } from "../../features/products/ProductLock";
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
  // THE LOCK — one setting, three ways (`one-lock-three-ways`). OPEN is the default because that is what every
  // product has always been — available for another team to sell; closing it is a decision, so it is the one you make.
  // The minimum is kept as typed for the same reason as the markup: a half-deleted "1" must not snap back under the
  // cursor — and it survives a trip to Always, which keeps it.
  const [lockMode, setLockMode] = useState<LockMode>("open");
  const [minimum, setMinimum] = useState("");
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
          setMinimum(p.reservedStock ? String(p.reservedStock) : "");
          setLockMode(lockModeOf(p));
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

    if (markupBps === null || (lockMode === "min" && !minimumIsUsable(minimum))) {
      return;
    }

    // The two fields the lock writes; Always with no minimum typed leaves the stored one as it is on an edit.
    const lock = lockFieldsOf(lockMode, parseQuantity(minimum) ?? 0);

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
                reservedStock: lock.reservedStock,
                crossLocked: lock.crossLocked,
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
                reservedStock: lock.reservedStock ?? 0,
                crossLocked: lock.crossLocked,
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

  // The form's shape while the product loads, not a spinner on an empty page (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={4} testId="product-edit-loading" />;
  }

  // null means the typed markup is not a usable percent (negative, not a number, past the 1000% rail
  // the database also enforces). Saving is blocked rather than coercing it — a markup silently read
  // as 0 is a discount to another team that nobody chose.
  const crossMarkupBps = parseMarkupPercent(crossMarkup);
  // A minimum that is not a whole number of at least one blocks the save — 0 would be Open under another name, and a
  // decimal is not a count. Same treatment as the markup: block it rather than coerce it.
  const lockUsable = lockMode !== "min" || minimumIsUsable(minimum);

  // Category is required; SKU and name too. The backend enforces all three regardless.
  const canSave =
    sku.trim() !== "" &&
    name.trim() !== "" &&
    categoryId > 0n &&
    crossMarkupBps !== null &&
    lockUsable;

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" maxW="5xl" animationStyle="enter" data-testid="product-edit-page">
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
        <Text color="error.fg" data-testid="product-edit-error">
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
                  {/* EVERY TYPED FIELD SHOWS AN EXAMPLE (every-form-field-shows-an-example) — a realistic value, gone as
                      soon as something is typed; the two figures keep their 0, the category says what to pick. */}
                  <Field.Root required>
                    <Field.Label>{t("products.field.sku")}</Field.Label>
                    <Input
                      value={sku}
                      placeholder={t("products.form.skuPlaceholder")}
                      data-testid="product-edit-sku"
                      onChange={(e) => setSku(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("products.field.name")}</Field.Label>
                    <Input
                      value={name}
                      placeholder={t("products.form.namePlaceholder")}
                      data-testid="product-edit-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("products.field.description")}</Field.Label>
                    {/* Roomy on purpose: a catalogue description is a paragraph, not a line, and a
                        two-row box makes people write to the box instead of to the product. */}
                    <Textarea
                      value={description}
                      rows={6}
                      placeholder={t("products.form.descriptionPlaceholder")}
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

                  {/* THE LOCK, beside the markup it governs (one-lock-three-ways) — settable HERE as well as from the
                      list, and that is deliberate: the list is where you sweep the whole catalogue, but a product that
                      was never meant to leave the team has to be able to say so at BIRTH. Created open and locked a
                      minute later is a minute during which another team can order it. */}
                  <Field.Root invalid={!lockUsable}>
                    <Field.Label>{t("products.lock.title")}</Field.Label>
                    <LockModeField
                      mode={lockMode}
                      onModeChange={setLockMode}
                      minimum={minimum}
                      onMinimumChange={setMinimum}
                      testId="product-edit-lock"
                    />
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
