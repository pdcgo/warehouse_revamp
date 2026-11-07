package inventory_v1_test

import (
	"context"
	"reflect"
	"testing"

	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE RANGE PILLS' SEAM (SupplierIDsByFigure): the suppliers whose Terjual or Siap lies in a band, lower-inclusive and
// upper-exclusive, over every team's goods (the-range-pills-are-a-fixed-set).

func sbIDs(t *testing.T, f sgFixture, figure inventory_v1.SupplierFigure, lo, hi int64) []uint64 {
	t.Helper()

	ids, err := f.svc.SupplierIDsByFigure(context.Background(), figure, lo, hi)
	if err != nil {
		t.Fatalf("SupplierIDsByFigure(%d, %d, %d): %v", figure, lo, hi, err)
	}

	return ids
}

// Sumber sells 11 (3 Kaos of Melati's + 8 Celana of Sinar's — both teams count), Sinar Jaya 1; a cancelled order is
// counted back. Each edge: a supplier AT the bottom is in, AT the top is out.
func TestSupplierIDsByFigure_SoldBandsAreLowerInclusiveUpperExclusive(t *testing.T) {
	f := sgStocked(t)

	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 3, "sb-1")
	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 2, "sb-2")
	sgCancel(t, f, sgMelati, "sb-2")
	sgSell(t, f, sgSinar, sgGudang5, sgCelana, 9, "sb-3")

	cases := []struct {
		name   string
		lo, hi int64
		want   []uint64
	}{
		{"at the bottom edge", 11, 12, []uint64{sgSumber}},
		{"at the top edge", 1, 11, []uint64{sgSinarJaya}},
		{"open-ended", 2, 0, []uint64{sgSumber}},
		{"from 1, open", 1, 0, []uint64{sgSumber, sgSinarJaya}},
		{"nobody", 12, 0, nil},
	}

	for _, c := range cases {
		got := sbIDs(t, f, inventory_v1.SupplierFigureSold, c.lo, c.hi)
		if (len(got) > 0 || len(c.want) > 0) && !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s [%d, %d) = %v, want %v", c.name, c.lo, c.hi, got, c.want)
		}
	}
}

// Siap: Sumber holds 10 + 4 Kaos and 8 Celana = 22, Sinar Jaya 6; selling 5 Celana (FIFO, Sumber's batch) leaves 17.
func TestSupplierIDsByFigure_ReadyBandsReadTheShelf(t *testing.T) {
	f := sgStocked(t)

	if got := sbIDs(t, f, inventory_v1.SupplierFigureReady, 22, 23); !reflect.DeepEqual(got, []uint64{sgSumber}) {
		t.Fatalf("[22, 23) = %v, want Sumber", got)
	}

	sgSell(t, f, sgSinar, sgGudang5, sgCelana, 5, "sb-4")

	if got := sbIDs(t, f, inventory_v1.SupplierFigureReady, 22, 0); len(got) != 0 {
		t.Fatalf("[22, ∞) after the sale = %v, want none", got)
	}

	if got := sbIDs(t, f, inventory_v1.SupplierFigureReady, 6, 18); !reflect.DeepEqual(got, []uint64{sgSumber, sgSinarJaya}) {
		t.Fatalf("[6, 18) = %v, want Sumber (17) and Sinar Jaya (6)", got)
	}

	_, err := f.svc.SupplierIDsByFigure(context.Background(), inventory_v1.SupplierFigure(9), 0, 0)
	if err == nil {
		t.Fatalf("an unknown figure answered")
	}
}
