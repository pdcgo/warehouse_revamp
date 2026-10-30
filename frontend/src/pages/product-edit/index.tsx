import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { ArrowLeft, Plus, Save } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";
import { productClient, rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSaveProduct } from "../../features/products/queries";
import { CategorySelect } from "../../components/pickers/CategorySelect";
import { CharCount } from "../../components/inputs/CharCount";
import { PRODUCT_LIMITS } from "../../features/products/limits";
import { cameFrom } from "../../lib/cameFrom";
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

  // WHERE BACK AND A SUCCESSFUL SAVE GO — back to the screen the form was opened from (owner: *"kembalinya bisa ga baca
  // route sebelumnya, kalau sebelumnya di detail maka ke situ, jika tidak ke list"*, `the-form-returns-where-it-was-opened`).
  // Opened from the product's own page, it goes back there; from anywhere else — the list, a pasted link — to the list,
  // and to the list AS IT WAS when that is where it came from, its filters and search kept.
  const location = useLocation();
  const from = cameFrom(location);
  const detail = editing ? `/products/${productId}` : undefined;
  const fromList = from !== undefined && (from === "/products" || from.startsWith("/products?"));
  const backTo = from !== undefined && from === detail ? detail : fromList ? from : "/products";
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
  // THE SKU THE SERVER REFUSED as already held by another live product of this team — kept as the value refused, so
  // the error stands under the SKU field until that value is changed, and returns if it is typed back.
  const [takenSku, setTakenSku] = useState<string | null>(null);

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

    // TRIMMED, because the server stores what it is sent: "KOPI-01 " would be a second SKU beside "KOPI-01", one that
    // nobody can tell apart on a screen.
    const record = { sku: sku.trim(), name: name.trim(), description: description.trim() };

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
                ...record,
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
                ...record,
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
        title: editing ? t("products.toast.saved") : t("products.toast.created", { sku: record.sku }),
      });

      // SAVE GOES WHERE BACK GOES (owner: *"kembali di button edit samakan dengan yang atas routenya"*,
      // `the-form-returns-where-it-was-opened`): to the screen the form was opened from — the product's page, or the
      // list as it was. One destination per form, whichever button leaves it.
      void navigate(backTo);
    } catch (err) {
      // A TAKEN SKU IS SAID UNDER THE SKU (owner). The server answers it with its own code — AlreadyExists, the only
      // one a product write gives for a duplicate (`dbError`) — so it is told apart from every other failure, which
      // stays a sentence at the top of the page.
      if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
        setTakenSku(record.sku);
        return;
      }
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

  // The SKU the server refused, while it is still the one typed.
  const skuTaken = takenSku !== null && sku.trim() === takenSku;

  // Category is required; SKU and name too. The backend enforces all three regardless.
  const canSave =
    sku.trim() !== "" &&
    name.trim() !== "" &&
    categoryId > 0n &&
    crossMarkupBps !== null &&
    lockUsable &&
    !skuTaken;

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared). At the canvas's LEFT edge, not
    // centred (a-narrowed-page-stays-at-the-left).
    <Stack gap="section" animationStyle="enter" data-testid="product-edit-page">
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
          {/* THE FORM FILLS THE CANVAS, IN THREE CARDS (owner: *"kanan terlalu sepi"*, *"kurang, tidak penuh"*,
              *"gambar terlalu besar"*, then *"deskripsi masuk info produk"*, `the-form-fills-the-canvas-in-three-cards`) —
              what it looks like, what it is, and who else may sell it:

                xl and up   [ Gambar 22rem ] [ Info Produk 1.25 ] [ Penjualan Tim Lain 1 ]
                lg          [ Gambar 18rem ] [ Info Produk        ]
                                             [ Penjualan Tim Lain ]   under Info, the left left empty
                below lg    one column, in the same order

              Info Produk is a little wider than Penjualan Tim Lain on a wide screen — it holds the longer text (owner:
              *"info produk kasih sedikit lebih besar"*); at `lg` the second card lines up under it, never under the
              picture (*"sejajar dengan info produk, ada gap di kiri"*).

              THE GALLERY'S COLUMN IS FIXED, so the cover is a picture to check, not a poster — the text columns take the
              rest of the width. The cards STRETCH to their row, so every row ends on one line. */}
          <Grid
            templateColumns={{
              base: "minmax(0, 1fr)",
              lg: "18rem minmax(0, 1fr)",
              xl: "22rem minmax(0, 1.25fr) minmax(0, 1fr)",
            }}
            templateAreas={{
              base: `"gallery" "info" "cross"`,
              lg: `"gallery info" ". cross"`,
              xl: `"gallery info cross"`,
            }}
            gap="section"
          >
            <Card.Root gridArea="gallery" data-testid="product-edit-images-card">
              <Card.Body>
                <Stack gap="card">
                  <Card.Title>{t("products.images")}</Card.Title>
                  <ProductImagesInput teamId={teamId ?? 0n} value={images} onChange={setImages} />
                </Stack>
              </Card.Body>
            </Card.Root>

            <Card.Root gridArea="info" data-testid="product-edit-info-card">
              <Card.Body>
                <Stack gap="card">
                  <Card.Title>{t("products.form.infoTitle")}</Card.Title>
                  {/* EVERY TYPED FIELD SHOWS AN EXAMPLE (every-form-field-shows-an-example) — a realistic value, gone as
                      soon as something is typed; the two figures keep their 0, the category says what to pick. */}
                  {/* EVERY LIMIT IS SHOWN, as "5/64" under its field (a-limited-field-shows-its-count) — the box stops at
                      the server's `max_len`, so the limit is met while typing, never as a refusal after Save. */}
                  <Field.Root required invalid={skuTaken}>
                    <Field.Label>{t("products.field.sku")}</Field.Label>
                    <Input
                      value={sku}
                      maxLength={PRODUCT_LIMITS.sku}
                      placeholder={t("products.form.skuPlaceholder")}
                      data-testid="product-edit-sku"
                      onChange={(e) => setSku(e.target.value)}
                    />
                    <Flex justify="space-between" align="start" gap="2" w="full">
                      {skuTaken ? (
                        <Field.ErrorText data-testid="product-edit-sku-taken">{t("products.form.skuTaken")}</Field.ErrorText>
                      ) : (
                        <span />
                      )}
                      <CharCount value={sku} max={PRODUCT_LIMITS.sku} testId="product-edit-sku-count" />
                    </Flex>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("products.field.name")}</Field.Label>
                    <Input
                      value={name}
                      maxLength={PRODUCT_LIMITS.name}
                      placeholder={t("products.form.namePlaceholder")}
                      data-testid="product-edit-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <CharCount value={name} max={PRODUCT_LIMITS.name} testId="product-edit-name-count" />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("products.field.description")}</Field.Label>
                    <Textarea
                      value={description}
                      rows={4}
                      maxLength={PRODUCT_LIMITS.description}
                      placeholder={t("products.form.descriptionPlaceholder")}
                      data-testid="product-edit-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <CharCount
                      value={description}
                      max={PRODUCT_LIMITS.description}
                      testId="product-edit-description-count"
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
                </Stack>
              </Card.Body>
            </Card.Root>

            {/* WHO ELSE MAY SELL IT — the markup and the lock are one question, so they are one card of their own. */}
            <Card.Root gridArea="cross" data-testid="product-edit-cross-card">
              <Card.Body>
                <Stack gap="card">
                  <Stack gap="0.5">
                    <Card.Title>{t("products.form.crossTitle")}</Card.Title>
                    <Card.Description>{t("products.form.crossDescription")}</Card.Description>
                  </Stack>

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

          {/* THE FOOT: Back beside Save, at the right (owner: *"di bawah ada tombol kembali, buat ada iconnya"*, then
              *"kembali di sebelah buat, buat plus saja"*) — somebody who scrolled to the end of the form leaves it from
              there, not by climbing back to the arrow at the top. Back goes where the top arrow goes; both carry their
              icon (an-action-button-carries-its-icon) — Buat its plus, Simpan its disk. */}
          <Flex justify="end" gap="3">
            <Button type="button" variant="outline" data-testid="product-edit-back-foot" onClick={() => navigate(backTo)}>
              <Icon as={ArrowLeft} boxSize="4" />
              {t("products.form.back")}
            </Button>
            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="product-edit-save"
            >
              <Icon as={editing ? Save : Plus} boxSize="4" />
              {editing ? t("products.save") : t("products.create")}
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}
