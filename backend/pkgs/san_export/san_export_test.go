package san_export

import (
	"bytes"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

// A file reads back as written: the headers first, a string as text (its leading 0 kept), money EXACT to the last
// fraction (the-backend-never-rounds-money), a share as its exact ratio under a 0.0% format — and a second sheet after
// the first.
func TestWorkbook_WritesExactCellsOnTwoSheets(t *testing.T) {
	book, err := NewWorkbook()
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()

	first, err := book.Sheet("Toko", []string{"Kode", "Nilai", "Tingkat"})
	if err != nil {
		t.Fatal(err)
	}

	err = first.Row("0812", 12345.505, Percent(0.0437))
	if err != nil {
		t.Fatal(err)
	}

	second, err := book.Sheet("Kedua", []string{"A"})
	if err != nil {
		t.Fatal(err)
	}

	err = second.Row(int64(7))
	if err != nil {
		t.Fatal(err)
	}

	content, err := book.Bytes()
	if err != nil {
		t.Fatal(err)
	}

	file, err := excelize.OpenReader(bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()

	if got := file.GetSheetList(); len(got) != 2 || got[0] != "Toko" || got[1] != "Kedua" {
		t.Fatalf("sheets = %v, want [Toko Kedua]", got)
	}

	rows, err := file.GetRows("Toko", excelize.Options{RawCellValue: true})
	if err != nil {
		t.Fatal(err)
	}

	if len(rows) != 2 || rows[0][0] != "Kode" || rows[1][0] != "0812" || rows[1][1] != "12345.505" || rows[1][2] != "0.0437" {
		t.Fatalf("rows = %v", rows)
	}

	shown, err := file.GetCellValue("Toko", "C2")
	if err != nil {
		t.Fatal(err)
	}

	if shown != "4.4%" {
		t.Fatalf("the share shows as %q, want 4.4%%", shown)
	}

	kind, err := file.GetCellType("Toko", "A2")
	if err != nil {
		t.Fatal(err)
	}

	if kind == excelize.CellTypeNumber {
		t.Fatal("a code must stay a text cell")
	}

	other, err := file.GetRows("Kedua")
	if err != nil {
		t.Fatal(err)
	}

	if len(other) != 2 || other[1][0] != "7" {
		t.Fatalf("second sheet = %v", other)
	}
}

// Every line is a message carrying the count; the first failed send is kept for the export to stop on.
func TestProgress_SendsEachLineWithTheCount(t *testing.T) {
	var got []string
	var counts [][2]int64

	p := NewProgress(func(message string, done, total int64) error {
		got = append(got, message)
		counts = append(counts, [2]int64{done, total})

		return nil
	})

	p.Total = 3
	p.Info("exporting stores", "rows", 3)
	p.Done = 3
	p.Info("rows written", "done", 3)

	if len(got) != 2 || got[0] != `level=INFO msg="exporting stores" rows=3` || counts[1] != [2]int64{3, 3} {
		t.Fatalf("lines = %q, counts = %v", got, counts)
	}

	if p.Err() != nil {
		t.Fatal(p.Err())
	}
}

// The readers' clock: 23:30 UTC is the next Jakarta day.
func TestDay_IsTheJakartaDay(t *testing.T) {
	at := time.Date(2026, 11, 6, 23, 30, 0, 0, time.UTC)

	if got := Day(at); got != "2026-11-07" {
		t.Fatalf("Day = %s, want 2026-11-07", got)
	}

	if got := Filename("pemasok-toko", at); got != "pemasok-toko-2026-11-07-063000.xlsx" {
		t.Fatalf("Filename = %s", got)
	}

	if Day(time.Time{}) != "" || DayOfUnix(0) != "" {
		t.Fatal("a moment that never happened is an empty cell")
	}
}
