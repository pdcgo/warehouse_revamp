package inventory_v1

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierStoresAtWarehouse answers a supplier page's Toko tab under a Gudang terkait chip
// (a-supplier-page-is-scoped-by-its-warehouses): the supplier's stores whose goods were received at one warehouse, in id
// order. SupplierStoreProductsAtWarehouse answers its Produk tab: the (store, product) pairs — store 0 for a line that
// named the supplier alone — of the supplier's goods received there.
//
// "Received there" is the chips' own test, receivedHere (supplier_ids_at_warehouse.go): a batch of the supplier in that
// warehouse that holds units now, was minted by a restock there, or was ever sold from — exactly the batches that put
// the warehouse among the supplier's Gudang terkait chips (SupplierGoods by WAREHOUSE). So under a chip a tab keeps only
// what that chip stands for, and the supplier list's Gudang filter reads the very same set. EVERY team's batches count
// (every-selling-team-sees-every-teams-figures); a batch's supplier and store are the restock LINE's, copied at accept
// and by a transfer (a-batch-keeps-its-supplier).
//
// Plain functions over inventory's own tables (HARD RULE 3), asked by supplier_service through the composition root's
// seam (cmd/app_development/supplier_goods_reader.go). Both walk the supplier's batches through batches_supplier_idx
// (supplier_id, supplier_channel_id, warehouse_id); the warehouse is checked inside the index entry.
func SupplierStoresAtWarehouse(ctx context.Context, db *gorm.DB, supplierID, warehouseID uint64) ([]uint64, error) {
	if supplierID == 0 || warehouseID == 0 {
		return nil, nil
	}

	var ids []uint64

	err := db.
		WithContext(ctx).
		Raw(`
			SELECT DISTINCT b.supplier_channel_id
			FROM batches b
			WHERE b.supplier_id = ?
			  AND b.warehouse_id = ?
			  AND b.supplier_channel_id > 0
			  AND `+receivedHere+`
			ORDER BY b.supplier_channel_id`,
			supplierID,
			warehouseID,
			string(inventory_service_models.TxRestock),
			string(inventory_service_models.TxOrder),
		).
		Scan(&ids).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier %d stores at warehouse %d: %w", supplierID, warehouseID, err)
	}

	return ids, nil
}

// SupplierStoreProductsAtWarehouse is the Produk tab's set under a chip — see SupplierStoresAtWarehouse. Ordered by store,
// then product.
func SupplierStoreProductsAtWarehouse(ctx context.Context, db *gorm.DB, supplierID, warehouseID uint64) ([]StoreProduct, error) {
	if supplierID == 0 || warehouseID == 0 {
		return nil, nil
	}

	var pairs []StoreProduct

	err := db.
		WithContext(ctx).
		Raw(`
			SELECT DISTINCT b.supplier_channel_id AS store_id, b.product_id
			FROM batches b
			WHERE b.supplier_id = ?
			  AND b.warehouse_id = ?
			  AND `+receivedHere+`
			ORDER BY b.supplier_channel_id, b.product_id`,
			supplierID,
			warehouseID,
			string(inventory_service_models.TxRestock),
			string(inventory_service_models.TxOrder),
		).
		Scan(&pairs).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier %d products at warehouse %d: %w", supplierID, warehouseID, err)
	}

	return pairs, nil
}
