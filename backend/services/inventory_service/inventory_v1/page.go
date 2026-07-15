package inventory_v1

import commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"

// pageOffset is the SQL OFFSET for a 1-based page.
func pageOffset(page *commonv1.PageFilter) int {
	return int((page.GetPage() - 1) * page.GetLimit())
}

// pageInfo builds the response PageInfo from the filter and the total row count.
func pageInfo(page *commonv1.PageFilter, total int64) *commonv1.PageInfo {
	var totalPage uint32

	limit := page.GetLimit()
	if limit > 0 {
		totalPage = uint32((total + int64(limit) - 1) / int64(limit))
	}

	return &commonv1.PageInfo{
		CurrentPage: page.GetPage(),
		TotalPage:   totalPage,
		TotalItems:  uint64(total),
	}
}
