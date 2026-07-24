import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useProductDetail } from "../../features/products/queries";
import { pathToRoot } from "../../features/categories/categoryTree";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium uppercase text-fg-muted">{label}</span>
      <span className="line-clamp-3 text-sm">{value || "—"}</span>
    </div>
  );
}

// ProductDetailPage is the read-only detail route for a product (#83) — a PAGE, not a dialog. It
// shows the SKU, name, description, its category as a breadcrumb (Parent › Child), and the image
// gallery, scoped to the current team, with an Edit shortcut. Reached by clicking a product row.
export function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseProductId(productId);
  const teamId = current?.teamId;


  const query = useProductDetail({ teamId, productId: id });

  const product = query.data?.product ?? null;
  const categories = query.data?.categories ?? [];
  const loading = query.isPending && id !== 0n;

  // A malformed id never reaches the server, so its message comes from here.
  const error = id === 0n ? "Invalid product id." : query.isError ? rpcError(query.error) : "";


  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("products.heading")}</h1>
        <p className="text-fg-muted" data-testid="product-detail-no-team">
          {t("products.detail.noTeam")}
        </p>
      </div>
    );
  }

  if (loading) {
    return <Spinner />;
  }

  if (error || !product) {
    return (
      <div className="flex flex-col gap-section">
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          data-testid="product-detail-back"
          onClick={() => navigate("/products")}
        >
          <ArrowLeft className="size-4" />
          {t("products.backToProducts")}
        </Button>
        <p className="text-red-600 dark:text-red-400" data-testid="product-detail-error">
          {error || t("products.detail.notFound")}
        </p>
      </div>
    );
  }

  const categoryLabel =
    product.categoryId > 0n ? pathToRoot(categories, product.categoryId).map((c) => c.name).join(" › ") : "";

  return (
    <div className="flex flex-col gap-section" data-testid="product-detail-page">
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        data-testid="product-detail-back"
        onClick={() => navigate("/products")}
      >
        <ArrowLeft className="size-4" />
        Back to Products
      </Button>

      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("products.detail.heading")}</h1>
        <div className="flex-1" />
        <Button
          size="xs"
          variant="outline"
          data-testid="product-detail-edit"
          onClick={() => navigate(`/products/${product.id}/edit`)}
        >
          <Pencil className="size-4" />
          {t("products.edit")}
        </Button>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <h2 className="text-[15px] font-semibold" data-testid="product-detail-name">
              {product.name}
            </h2>

            <div className="grid grid-cols-1 gap-card sm:grid-cols-2">
              <Field label={t("products.field.sku")} value={product.sku} />
              <Field label={t("products.field.category")} value={categoryLabel} />
            </div>

            <Field label={t("products.field.description")} value={product.description} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <p className="font-medium">{t("products.images")}</p>
            {product.images.length === 0 ? (
              <p className="text-sm text-fg-muted" data-testid="product-detail-no-images">
                {t("products.detail.noImages")}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-card md:grid-cols-5" data-testid="product-detail-images">
                {product.images.map((img, i) => (
                  <img
                    key={`${img.url}-${i}`}
                    src={img.thumbnailUrl || img.url}
                    alt={`${product.name} image ${i + 1}`}
                    className="aspect-square w-full rounded-control border border-line object-cover"
                    data-testid={`product-detail-image-${i}`}
                  />
                ))}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
