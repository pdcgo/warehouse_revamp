package inventory_v1

import commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"

// pager is satisfied by BOTH the legacy PageFilter and the guideline CommonPagination — they share
// the page/limit accessors. Keeping these helpers generic lets the inventory list RPCs migrate to
// CommonPagination one at a time without a flag day on this shared code.
type pager interface {
	GetPage() uint32
	GetLimit() uint32
}

// pageOffset is the SQL OFFSET for a 1-based page.
func pageOffset(page pager) int {
	return int((page.GetPage() - 1) * page.GetLimit())
}

// pageInfo builds the response PageInfo from the filter and the total row count.
func pageInfo(page pager, total int64) *commonv1.PageInfo {
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
