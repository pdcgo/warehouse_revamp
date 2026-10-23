package product_v1

import (
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// bundleRowItem is the BUNDLE slice — the whole bundle, its lines included. A line carries only the product id and
// the quantity: a caller resolves the product with ProductByIds (a-bundle-line-reads-its-owner-from-the-product).
func bundleRowItem(b *product_service_models.Bundle) *productv1.BundleRowItem {
	lines := make([]*productv1.BundleLine, 0, len(b.Lines))
	for _, l := range b.Lines {
		lines = append(lines, &productv1.BundleLine{ProductId: l.ProductID, Quantity: l.Quantity})
	}

	return &productv1.BundleRowItem{
		Id:              b.ID,
		TeamId:          b.TeamID,
		Name:            b.Name,
		Description:     b.Description,
		CreatedByUserId: b.CreatedByUserID,
		CreatedAtUnix:   b.CreatedAt.Unix(),
		UpdatedAtUnix:   b.UpdatedAt.Unix(),
		Lines:           lines,
	}
}

// withLines loads every line of these bundles in ONE query — never a query per bundle — in the order they were saved.
func withLines(tx *gorm.DB, bundles []product_service_models.Bundle) error {
	if len(bundles) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(bundles))
	for i := range bundles {
		ids = append(ids, bundles[i].ID)
	}

	var lines []product_service_models.BundleProduct

	err := tx.
		Where("bundle_id IN ?", ids).
		Order("bundle_id, id").
		Find(&lines).
		Error
	if err != nil {
		return err
	}

	byBundle := make(map[uint64][]product_service_models.BundleProduct, len(bundles))
	for _, l := range lines {
		byBundle[l.BundleID] = append(byBundle[l.BundleID], l)
	}

	for i := range bundles {
		bundles[i].Lines = byBundle[bundles[i].ID]
	}

	return nil
}

// bundleOrderClause orders BundleList: the last change first by default. Every order ends on id, because a name may
// repeat (bundle-names-may-repeat) and a page boundary must not fall between two rows that sort equal.
func bundleOrderClause(sort *productv1.BundleListFilterSort) string {
	col := "updated_at"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *productv1.BundleListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *productv1.BundleListFilterSort_Bundle:
			if s.Bundle == productv1.BundleRowSort_BUNDLE_ROW_SORT_NAME {
				col = "name"
			}
		}
	}

	return col + " " + dir + ", id " + dir
}

func bundleGeneralMap(bundles []product_service_models.Bundle) *commonv1.GeneralMapItem {
	m := make(map[uint64]*commonv1.GeneralItem, len(bundles))
	for i := range bundles {
		m[bundles[i].ID] = &commonv1.GeneralItem{Id: bundles[i].ID, Name: bundles[i].Name}
	}

	return &commonv1.GeneralMapItem{MapData: m}
}

func bundleRowMap(bundles []product_service_models.Bundle) *productv1.BundleRowMapItem {
	m := make(map[uint64]*productv1.BundleRowItem, len(bundles))
	for i := range bundles {
		m[bundles[i].ID] = bundleRowItem(&bundles[i])
	}

	return &productv1.BundleRowMapItem{MapData: m}
}

// bundleListItems builds the list response's slices (defaulting to the BUNDLE slice) and the sorted ids.
func bundleListItems(
	bundles []product_service_models.Bundle,
	types []productv1.BundleListDataType,
) ([]*productv1.BundleListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []productv1.BundleListDataType{productv1.BundleListDataType_BUNDLE_LIST_DATA_TYPE_BUNDLE}
	}

	ids := make([]uint64, 0, len(bundles))
	for i := range bundles {
		ids = append(ids, bundles[i].ID)
	}

	items := make([]*productv1.BundleListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case productv1.BundleListDataType_BUNDLE_LIST_DATA_TYPE_GENERAL:
			items = append(items, &productv1.BundleListResponseItem{
				D: &productv1.BundleListResponseItem_General{General: bundleGeneralMap(bundles)},
			})
		case productv1.BundleListDataType_BUNDLE_LIST_DATA_TYPE_BUNDLE:
			items = append(items, &productv1.BundleListResponseItem{
				D: &productv1.BundleListResponseItem_Bundle{Bundle: bundleRowMap(bundles)},
			})
		}
	}

	return items, ids
}

// bundleByIdsMap builds the by-ids response: keyed by bundle id, each value holding the requested slices for that one
// bundle (defaulting to the BUNDLE slice).
func bundleByIdsMap(
	bundles []product_service_models.Bundle,
	types []productv1.BundleByIdsDataType,
) map[uint64]*productv1.BundleByIdsResponseList {
	if len(types) == 0 {
		types = []productv1.BundleByIdsDataType{productv1.BundleByIdsDataType_BUNDLE_BY_IDS_DATA_TYPE_BUNDLE}
	}

	out := make(map[uint64]*productv1.BundleByIdsResponseList, len(bundles))
	for i := range bundles {
		one := bundles[i : i+1]

		slices := make([]*productv1.BundleByIdsResponseItem, 0, len(types))
		for _, t := range types {
			switch t {
			case productv1.BundleByIdsDataType_BUNDLE_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &productv1.BundleByIdsResponseItem{
					D: &productv1.BundleByIdsResponseItem_General{General: bundleGeneralMap(one)},
				})
			case productv1.BundleByIdsDataType_BUNDLE_BY_IDS_DATA_TYPE_BUNDLE:
				slices = append(slices, &productv1.BundleByIdsResponseItem{
					D: &productv1.BundleByIdsResponseItem_Bundle{Bundle: bundleRowMap(one)},
				})
			}
		}

		out[bundles[i].ID] = &productv1.BundleByIdsResponseList{Items: slices}
	}

	return out
}
