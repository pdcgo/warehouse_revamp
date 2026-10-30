// Package order_import_readers reads a marketplace's ORDER EXPORT — the file a shop downloads from the platform's
// own order page — into one Order per ref: the platform's words, and what they mean to us
// (the-import-moves-only-after-handover).
//
// It only READS. Which of our statuses an order may move to, and from which, is the import's to decide; a reader
// says "the platform says in transit" and nothing more.
//
// ⚠ BUILT AGAINST MOCKS. examples/order_samples/ holds invented exports laid out like the real ones as far as they
// are known. When a real export disagrees, the reader follows the real one.
package order_import_readers

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

// Status is what the platform's words mean to the import.
type Status int

const (
	// StatusUnknown is a word this reader does not know. It never moves an order: a new platform word is listed
	// for a person to read, not guessed at.
	StatusUnknown Status = iota
	// StatusBeforeHandover — unpaid, or waiting to be shipped. The warehouse's state, never moved by an import.
	StatusBeforeHandover
	// StatusInTransit — the courier has it.
	StatusInTransit
	// StatusCompleted — delivered, or completed by the buyer.
	StatusCompleted
	// StatusReturn — a return or a refund is open or done on the platform.
	StatusReturn
	// StatusCancelled — cancelled on the platform.
	StatusCancelled
)

// Order is one order of the file, however many product rows it took.
type Order struct {
	Ref    string
	Status Status
	// Words are the platform's own, for the line the import writes about this order.
	Words string
	// Row is the first row naming it, numbered as the spreadsheet numbers it.
	Row int
}

// ErrNotThisExport is a file that is not this platform's order export — the wrong platform's file, a statement,
// or something else. The import ends on it before touching an order.
var ErrNotThisExport = errors.New("not this platform's order export")

// headerSearch is how far down a sheet the header row is looked for. Both known exports put it on the first row;
// the margin is for a platform that adds a title above it, as Shopee's statement does.
const headerSearch = 20

// sheets is every sheet of the file as rows of cells: each sheet of an .xlsx, or the one table of a .csv.
func sheets(content []byte) ([][][]string, error) {
	switch {
	case bytes.HasPrefix(content, []byte("PK\x03\x04")):
		return xlsxSheets(content)
	case bytes.HasPrefix(content, []byte{0xD0, 0xCF, 0x11, 0xE0}):
		return nil, fmt.Errorf("%w: an old .xls file — open it and save it as .xlsx", ErrNotThisExport)
	default:
		return csvSheet(content)
	}
}

func xlsxSheets(content []byte) ([][][]string, error) {
	file, err := excelize.OpenReader(bytes.NewReader(content))
	if err != nil {
		return nil, fmt.Errorf("%w: the file cannot be opened as .xlsx (%v)", ErrNotThisExport, err)
	}

	defer func() {
		_ = file.Close()
	}()

	var out [][][]string

	for _, name := range file.GetSheetList() {
		rows, err := file.GetRows(name)
		if err != nil {
			return nil, fmt.Errorf("reading sheet %q: %w", name, err)
		}

		out = append(out, rows)
	}

	return out, nil
}

func csvSheet(content []byte) ([][][]string, error) {
	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(content, []byte("\xEF\xBB\xBF"))))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	rows, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("%w: the file is neither .xlsx nor a readable .csv (%v)", ErrNotThisExport, err)
	}

	return [][][]string{rows}, nil
}

// columns is a header row's column positions, by normalised name.
type columns map[string]int

func (c columns) cell(row []string, name string) string {
	at, ok := c[normalise(name)]
	if !ok || at >= len(row) {
		return ""
	}

	return strings.TrimSpace(row[at])
}

// findTable is the first sheet with a header row naming every `required` column: that sheet, the header's index
// and its columns.
func findTable(all [][][]string, required ...string) ([][]string, int, columns, bool) {
	for _, rows := range all {
		for i := 0; i < len(rows) && i < headerSearch; i++ {
			cols := columns{}
			for at, name := range rows[i] {
				key := normalise(name)
				if _, seen := cols[key]; !seen {
					cols[key] = at
				}
			}

			found := true
			for _, name := range required {
				if _, ok := cols[normalise(name)]; !ok {
					found = false

					break
				}
			}

			if found {
				return rows, i, cols, true
			}
		}
	}

	return nil, 0, nil, false
}

// normalise compares header names without case or runs of spaces — "Status Pembatalan/ Pengembalian" keeps its
// odd space, and a platform that tidies it should not break the reader.
func normalise(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// words joins the platform's words for one order, skipping the empty and the repeated.
func words(parts ...string) string {
	var kept []string

	for _, part := range parts {
		if part == "" {
			continue
		}

		if len(kept) > 0 && strings.EqualFold(kept[len(kept)-1], part) {
			continue
		}

		kept = append(kept, part)
	}

	return strings.Join(kept, " · ")
}
