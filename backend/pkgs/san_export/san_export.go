// Package san_export is the plumbing of a screen's table written as a file — the order list's export
// (one-export-is-the-list-as-a-file) made shareable for every export after it (each-supplier-tab-exports-its-own-table):
//
//   - Workbook / Sheet: an .xlsx written row by row through excelize's stream writer, so a long table never sits in
//     memory twice. A string stays a string cell (an id keeps its leading 0); a number is written EXACTLY as it is —
//     the backend never rounds money (the-backend-never-rounds-money); a Percent is the exact ratio under a 0.0% format,
//     so only the spreadsheet's display rounds it, as the screen does.
//   - Progress: the guideline's long-task stream (code-implementation-guideline.md) — every step a slog line sent as the
//     stream's message, carrying done and total.
//   - Store: where the finished file goes — adapted at the composition root to document_service, AS THE CALLER, as a
//     private document behind an expiring link that carries the file's name (a-download-keeps-its-files-name).
//   - Filename / Day: the readers' clock, WIB.
package san_export

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// Store saves an export's file under the caller's team and returns its expiring download link.
type Store interface {
	Store(ctx context.Context, teamID uint64, filename string, content []byte) (string, error)
}

// Batch is the rows read per step of an export — the by-ids name lookups take at most 200 ids.
const Batch = 200

// WIB is Western Indonesia Time, UTC+7 with no daylight saving — the clock the people reading a file keep, and the day a
// row belongs to (the-system-runs-on-jakarta-time).
var WIB = time.FixedZone("WIB", 7*60*60)

// Filename is `<prefix>-<yyyy-mm-dd-hhmmss>.xlsx` at `now` in WIB — the order export's shape (`orders-…`).
func Filename(prefix string, now time.Time) string {
	return prefix + "-" + now.In(WIB).Format("2006-01-02-150405") + ".xlsx"
}

// Day writes an instant as its Jakarta day, `yyyy-mm-dd`; the zero time (never happened) is an empty cell.
func Day(t time.Time) string {
	if t.IsZero() {
		return ""
	}

	return t.In(WIB).Format("2006-01-02")
}

// DayOfUnix is Day for unix seconds; 0 is an empty cell.
func DayOfUnix(unix int64) string {
	if unix <= 0 {
		return ""
	}

	return Day(time.Unix(unix, 0))
}

// Percent is a share written as its exact ratio (0.0437…) under the sheet's 0.0% format — 4,4% on screen and in the
// spreadsheet, the ratio itself in the cell.
type Percent float64

// Workbook is one .xlsx file of one or more sheets, each written top to bottom.
type Workbook struct {
	file    *excelize.File
	current *Sheet
	percent int
}

// NewWorkbook starts an empty file. Close it when done, whatever happened.
func NewWorkbook() (*Workbook, error) {
	file := excelize.NewFile()

	format := "0.0%"

	percent, err := file.NewStyle(&excelize.Style{CustomNumFmt: &format})
	if err != nil {
		_ = file.Close()

		return nil, err
	}

	return &Workbook{file: file, percent: percent}, nil
}

// Sheet is one table of the file.
type Sheet struct {
	book   *Workbook
	writer *excelize.StreamWriter
	row    int
}

// Sheet starts the next table under `name`, its first row the headers. The first sheet takes the file's default one;
// starting another ends the one before it — a stream writer writes one sheet at a time.
func (w *Workbook) Sheet(name string, headers []string) (*Sheet, error) {
	if w.current == nil {
		err := w.file.SetSheetName("Sheet1", name)
		if err != nil {
			return nil, err
		}
	} else {
		err := w.current.writer.Flush()
		if err != nil {
			return nil, err
		}

		_, err = w.file.NewSheet(name)
		if err != nil {
			return nil, err
		}
	}

	writer, err := w.file.NewStreamWriter(name)
	if err != nil {
		return nil, err
	}

	sheet := &Sheet{book: w, writer: writer, row: 1}
	w.current = sheet

	values := make([]any, len(headers))
	for i, header := range headers {
		values[i] = header
	}

	err = sheet.Row(values...)
	if err != nil {
		return nil, err
	}

	return sheet, nil
}

// Row writes the next row. A Percent is styled as one; every other value goes in as it is.
func (s *Sheet) Row(values ...any) error {
	cell, err := excelize.CoordinatesToCellName(1, s.row)
	if err != nil {
		return err
	}

	s.row++

	out := make([]any, len(values))
	for i, value := range values {
		if p, ok := value.(Percent); ok {
			out[i] = excelize.Cell{StyleID: s.book.percent, Value: float64(p)}

			continue
		}

		out[i] = value
	}

	return s.writer.SetRow(cell, out)
}

// Bytes ends the last sheet and returns the file.
func (w *Workbook) Bytes() ([]byte, error) {
	if w.current != nil {
		err := w.current.writer.Flush()
		if err != nil {
			return nil, err
		}
	}

	buf, err := w.file.WriteToBuffer()
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// Close releases the file's temporary storage.
func (w *Workbook) Close() {
	_ = w.file.Close()
}

// Send is how one export's stream carries a step: its own response message, built from the line and the progress.
type Send func(message string, done, total int64) error

// Progress is an export's running count and its log: every line a message on the stream, the count on each.
type Progress struct {
	Done, Total int64

	send   Send
	logger *slog.Logger
	err    error
}

// NewProgress binds a stream's Send to a logger.
func NewProgress(send Send) *Progress {
	p := &Progress{send: send}
	p.logger = slog.New(slog.NewTextHandler(progressWriter{p}, &slog.HandlerOptions{ReplaceAttr: dropTime}))

	return p
}

// Info sends one step. The first failed send — a closed tab — is kept and answered by Err.
func (p *Progress) Info(msg string, args ...any) {
	p.logger.Info(msg, args...)
}

// Err is the first send that failed; the export stops on it.
func (p *Progress) Err() error {
	return p.err
}

type progressWriter struct{ p *Progress }

func (w progressWriter) Write(b []byte) (int, error) {
	if w.p.err != nil {
		return len(b), nil
	}

	err := w.p.send(strings.TrimSpace(string(b)), w.p.Done, w.p.Total)
	if err != nil {
		w.p.err = fmt.Errorf("sending the progress: %w", err)
	}

	return len(b), nil
}

// dropTime keeps the time out of a message line — the screen shows its own clock.
func dropTime(_ []string, a slog.Attr) slog.Attr {
	if a.Key == slog.TimeKey {
		return slog.Attr{}
	}

	return a
}
