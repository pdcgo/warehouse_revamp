package settlement_importer_v1

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sort"
	"strconv"
	"time"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// importRequest is one import, whichever platform — the same two fields for both
// (an-import-request-is-a-shop-and-its-file), and the reader the RPC picks.
type importRequest struct {
	teamID   uint64
	shopID   uint64
	content  []byte
	platform marketplacev1.Marketplace
	read     statementReader
}

// importStatement is ONE import, streamed.
//
//  1. the shop check — before anything is stored (the-shop-is-checked-before-the-file-is-stored)
//  2. the file stored, named by its hash (the-file-is-named-by-its-content-hash)
//  3. its own row, running
//  4. the rest DETACHED from the request (an-import-finishes-whether-anyone-watches): read, resolve, check,
//     post — see runStatement
//
// ⚠ A REFUSAL ENDS THE STREAM ON AN ERROR LINE, never a connect error. Before the file is stored there is
// no row, and the ERROR line is the whole answer; after, the row reads FAILED. The screen tells the two
// apart by whether a file came with it.
func (s *Service) importStatement(ctx context.Context, in importRequest, sink *streamSink) error {
	uploader := uploaderFrom(ctx)
	log := newStreamLogger(sink,
		slog.Uint64("team_id", in.teamID),
		slog.Uint64("shop_id", in.shopID),
		slog.Uint64("uploader", uploader),
	)

	// 1 · THE SHOP CHECK.
	shop, refusal := s.checkShop(ctx, in, uploader)
	if refusal != "" {
		log.ErrorContext(ctx, refusal)

		return nil
	}

	log.InfoContext(ctx, "Shop checked — "+shop.Name)

	// 2 · STORED FIRST, so a file the reader refuses is still kept — that is exactly the file a developer
	// needs. Nothing looks the hash up: the same file again is a second upload (the-row-key-is-the-only-dedupe).
	sum := sha256.Sum256(in.content)
	hash := hex.EncodeToString(sum[:])

	documentID, err := s.store.StoreStatement(ctx, in.teamID, hash+".xlsx", in.content)
	if err != nil {
		log.ErrorContext(ctx, "The file could not be stored — nothing was imported: "+rpcMessage(err))

		return nil
	}

	// 3 · ITS OWN ROW — what the list pages over, and what makes an interrupted import visible.
	file := settlement_importer_service_models.UploadedFile{
		TeamID:          in.teamID,
		ShopID:          shop.ID,
		Platform:        san_marketplace.ToText(in.platform),
		DocumentID:      documentID,
		ContentSha256:   hash,
		Status:          statusRunning,
		CreatedByUserID: uploader,
		PrimaryUserID:   shop.PrimaryUserID,
	}

	err = s.db.WithContext(ctx).Create(&file).Error
	if err != nil {
		log.ErrorContext(ctx, "The file was stored but could not be recorded — nothing was imported: "+err.Error())

		return nil
	}

	log = log.With(slog.Uint64("uploaded_file_id", file.ID))
	log.InfoContext(ctx, "File stored — "+groupDigits(len(in.content))+" bytes", "file", fileToProto(&file, s.now()))

	// 4 · DETACHED. WithoutCancel keeps the uploader's identity and token for every call the import makes
	// and drops only the cancellation — a fresh Background would post as nobody. A closed tab ends the
	// stream, never the import.
	work := context.WithoutCancel(ctx)
	done := make(chan struct{})

	s.running.Add(1)

	go func() {
		defer s.running.Done()
		defer close(done)
		defer s.recoverImport(work, &file, log)

		s.runStatement(work, &file, shop, in, log)
	}()

	select {
	case <-done:
	case <-ctx.Done():
	}

	// Nothing may write to the stream once this handler returns.
	sink.detach()

	return nil
}

// checkShop is ShopAccessCheck, read as the importer's four refusals. The empty string is a pass.
func (s *Service) checkShop(ctx context.Context, in importRequest, uploader uint64) (ShopCheck, string) {
	shop, err := s.shops.CheckShop(ctx, in.teamID, in.shopID, uploader)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeNotFound {
			return ShopCheck{}, "This shop is not one of your team's shops — nothing was stored"
		}

		return ShopCheck{}, "The shop could not be checked — nothing was stored: " + rpcMessage(err)
	}

	switch {
	case !shop.HasAccess:
		// a-write-needs-a-grant-or-a-manager
		return shop, fmt.Sprintf("You have no access to %s — ask the team's owner or admin for it — nothing was stored", shop.Name)
	case shop.Marketplace != in.platform:
		return shop, fmt.Sprintf("%s is not a %s shop — nothing was stored", shop.Name, platformName(in.platform))
	case shop.PrimaryUserID == 0:
		// a-shop-with-no-primary-cs-cannot-import — the owner's words, the shop's name in front.
		return shop, fmt.Sprintf("%s has no primary CS — choose a primary CS first", shop.Name)
	}

	return shop, ""
}

// runStatement is the import's detached half: read, resolve every ref, check the file, post every line.
func (s *Service) runStatement(
	ctx context.Context,
	file *settlement_importer_service_models.UploadedFile,
	shop ShopCheck,
	in importRequest,
	log *slog.Logger,
) {
	// 5 · READ IT — the Excel Reader, and the importer's policy over it.
	stmt, err := in.read(in.content)
	if err != nil {
		var refused errNotThisStatement
		if errors.As(err, &refused) {
			s.fail(ctx, file, refused.message+" — nothing was posted", log)

			return
		}

		s.fail(ctx, file, "The file could not be read — nothing was posted: "+err.Error(), log)

		return
	}

	count := len(stmt.records)
	file.PeriodFrom = dateOf(stmt.periodFrom)
	file.PeriodTo = dateOf(stmt.periodTo)
	file.RowsTotal = count

	err = s.saveFile(ctx, file)
	if err != nil {
		s.stopped(ctx, 0, err, log)

		return
	}

	log.InfoContext(ctx, fmt.Sprintf("Read %d rows%s", count, periodText(file)),
		"count", count, "file", fileToProto(file, s.now()))

	// 6 · EVERY REF, ONE CALL (critique 4) — it addresses each line AND names its person.
	found, err := s.orders.OrdersByRefs(ctx, file.TeamID, refsOf(stmt.records))
	if err != nil {
		s.fail(ctx, file, "The orders could not be looked up — nothing was posted: "+rpcMessage(err), log)

		return
	}

	// 7 · THE FILE CHECK (a-file-with-another-shops-orders-is-refused) — one ref whose order is in another
	// shop of the team means the wrong file, before anything posts.
	foreign, refs := foreignShop(found, shop.ID)
	if foreign != 0 {
		s.fail(ctx, file, fmt.Sprintf("%d of this file's orders belong to %s — the whole file is refused, nothing was posted",
			refs, s.shopName(ctx, file.TeamID, foreign, file.CreatedByUserID)), log)

		return
	}

	// 8 · EVERY LINE — posted, already there, held or skipped, each a step on the stream. A line that
	// cannot post never ends it (critique 7).
	for i := range stmt.records {
		level, text, err := s.importLine(ctx, file, shop, i+1, &stmt.records[i], found)
		if err != nil {
			s.stopped(ctx, i+1, err, log)

			return
		}

		log.Log(ctx, level, fmt.Sprintf("Row %d: %s", i+1, text),
			"step", i+1, "count", count, "file", fileToProto(file, s.now()))
	}

	// 9 · DONE.
	finished := s.now()
	file.Status = statusDone
	file.FinishedAt = &finished

	err = s.saveFile(ctx, file)
	if err != nil {
		s.stopped(ctx, count, err, log)

		return
	}

	log.InfoContext(ctx,
		fmt.Sprintf("Done — %d posted, %d already there, %d held, %d skipped",
			file.RowsPosted, file.RowsExisting, file.RowsHeld, file.RowsSkipped),
		"step", count, "count", count, "file", fileToProto(file, s.now()))
}

// importLine settles one line — posts it, or records why not — and writes it down.
func (s *Service) importLine(
	ctx context.Context,
	file *settlement_importer_service_models.UploadedFile,
	shop ShopCheck,
	lineNo int,
	rec *record,
	found map[string][]OrderRef,
) (slog.Level, string, error) {
	line := settlement_importer_service_models.UploadedFileLine{
		UploadedFileID: file.ID,
		LineNo:         lineNo,
		Sheet:          rec.sheet,
		UniqueID:       rec.key,
		OrderRef:       rec.orderRef,
		PlatformType:   rec.platformType,
		Description:    rec.description,
		SettlementType: settlementTypeText[rec.settlementType],
		Change:         rec.change,
		OccurredOn:     dateOf(rec.occurredOn),
		Outcome:        rec.outcome,
		Reason:         rec.reason,
		Detail:         rec.detail,
	}

	var (
		level slog.Level
		text  string
	)

	switch rec.outcome {
	case outcomeSkipped:
		level, text = skippedLine(rec)
	case outcomeHeld:
		level, text = slog.LevelWarn, heldLine(rec)
	default:
		level, text = s.postLine(ctx, file, shop, rec, found, &line)
	}

	err := s.db.WithContext(ctx).Create(&line).Error
	if err != nil {
		return level, text, err
	}

	tally(file, &line)

	return level, text, s.saveFile(ctx, file)
}

// postLine is one SettlementPost, under the uploader's token. A ref that finds its order posts to that
// order — counted for its creator; any other line posts to the shop — counted for the shop's primary CS,
// which settlement asks for itself (user-id-is-the-orders-creator-else-the-shops-primary-cs).
func (s *Service) postLine(
	ctx context.Context,
	file *settlement_importer_service_models.UploadedFile,
	shop ShopCheck,
	rec *record,
	found map[string][]OrderRef,
	line *settlement_importer_service_models.UploadedFileLine,
) (slog.Level, string) {
	post := LedgerPost{
		TeamID:         file.TeamID,
		ShopID:         shop.ID,
		UniqueID:       rec.key,
		SettlementType: rec.settlementType,
		Change:         rec.change,
		OccurredOn:     rec.occurredOn.Format(dateLayout),
		Note:           truncate(rec.description, noteMaxRunes),
	}

	order, hasOrder := orderInShop(found[rec.orderRef], shop.ID)
	if rec.orderRef != "" && hasOrder {
		post.OrderID = order.OrderID
		post.CreatedByUserID = order.CreatedByUserID
		line.OrderID = order.OrderID
	}

	result, err := s.ledger.Post(ctx, post)
	if err != nil {
		// HELD — settlement refused it. The same file again posts it once the cause is gone.
		line.Outcome = outcomeHeld
		line.Reason = reasonRefused
		line.Detail = rpcMessage(err)

		return slog.LevelWarn, fmt.Sprintf("%s — refused by settlement: %s — held", subject(rec), line.Detail)
	}

	line.SettlementLogID = result.LogID

	if !result.Created {
		line.Outcome = outcomeExisting

		return slog.LevelInfo, subject(rec) + " — already there"
	}

	line.Outcome = outcomePosted

	switch {
	case rec.orderRef != "" && !hasOrder:
		// an-unmatched-ref-posts-to-the-shop — posted, and a WARN, so the closing summary names it.
		line.Reason = reasonNoOrder

		return slog.LevelWarn, fmt.Sprintf("no order %s — posted to the shop", rec.orderRef)
	case hasOrder:
		return slog.LevelInfo, subject(rec) + " — posted"
	default:
		return slog.LevelInfo, subject(rec) + " — posted to the shop"
	}
}

// ── what a line becomes, in words ──────────────────────────────────────────────────────────────────

func subject(rec *record) string {
	if rec.orderRef == "" {
		return rec.platformType
	}

	return rec.platformType + " " + rec.orderRef
}

// skippedLine — a failed withdrawal is a WARN, worth a look (only-a-successful-withdrawal-is-recorded);
// the rows that only repeat the order rows are routine, and stay out of the closing summary.
func skippedLine(rec *record) (slog.Level, string) {
	switch rec.reason {
	case reasonFailedWithdrawal:
		return slog.LevelWarn, fmt.Sprintf("a withdrawal that did not succeed (%s) — skipped", rec.detail)
	case reasonRepeatsOrderDetails:
		return slog.LevelInfo, rec.platformType + " repeat the order rows — skipped"
	default:
		return slog.LevelInfo, subject(rec) + " — skipped"
	}
}

func heldLine(rec *record) string {
	switch rec.reason {
	case reasonUnmappedType:
		return fmt.Sprintf("type %q is not mapped — held", rec.platformType)
	case reasonFractionalAmount:
		return fmt.Sprintf("%s — a fraction of a rupiah (%s) is never rounded — held", subject(rec), rec.detail)
	default:
		return subject(rec) + " — held"
	}
}

// ── the file's row ─────────────────────────────────────────────────────────────────────────────────

func tally(file *settlement_importer_service_models.UploadedFile, line *settlement_importer_service_models.UploadedFileLine) {
	switch line.Outcome {
	case outcomePosted:
		file.RowsPosted++

		if line.Reason == reasonNoOrder {
			file.RowsPostedToShop++
		}
	case outcomeExisting:
		file.RowsExisting++
	case outcomeHeld:
		file.RowsHeld++
	case outcomeSkipped:
		file.RowsSkipped++
	}
}

// saveFile writes the row's moving parts, and moves updated_at with them — a running row that stops
// moving reads interrupted.
func (s *Service) saveFile(ctx context.Context, file *settlement_importer_service_models.UploadedFile) error {
	file.UpdatedAt = s.now()

	return s.db.WithContext(ctx).
		Model(&settlement_importer_service_models.UploadedFile{}).
		Where("id = ?", file.ID).
		Updates(map[string]any{
			"period_from":         file.PeriodFrom,
			"period_to":           file.PeriodTo,
			"status":              file.Status,
			"failure":             file.Failure,
			"rows_total":          file.RowsTotal,
			"rows_posted":         file.RowsPosted,
			"rows_existing":       file.RowsExisting,
			"rows_held":           file.RowsHeld,
			"rows_skipped":        file.RowsSkipped,
			"rows_posted_to_shop": file.RowsPostedToShop,
			"updated_at":          file.UpdatedAt,
			"finished_at":         file.FinishedAt,
		}).
		Error
}

// fail refuses the file as a whole: its row reads FAILED with why, and the stream ends on that ERROR line.
func (s *Service) fail(
	ctx context.Context,
	file *settlement_importer_service_models.UploadedFile,
	why string,
	log *slog.Logger,
) {
	finished := s.now()
	file.Status = statusFailed
	file.Failure = why
	file.FinishedAt = &finished

	err := s.saveFile(ctx, file)
	if err != nil {
		slog.ErrorContext(ctx, "settlement import: the file failed and its row could not say so",
			"uploaded_file_id", file.ID, "failure", why, "error", err)
	}

	log.ErrorContext(ctx, why, "file", fileToProto(file, s.now()))
}

// stopped is the import halting on its own storage — lines already posted stay posted, and the row is
// left running, so it reads interrupted: the same file again finishes it.
func (s *Service) stopped(ctx context.Context, lineNo int, err error, log *slog.Logger) {
	log.ErrorContext(ctx, fmt.Sprintf("The import stopped at row %d — upload the same file again to finish it: %v", lineNo, err))
}

// recoverImport keeps a panic in one import from taking the server down with it — the goroutine is
// detached, so nothing above it would recover.
func (s *Service) recoverImport(ctx context.Context, file *settlement_importer_service_models.UploadedFile, log *slog.Logger) {
	r := recover()
	if r == nil {
		return
	}

	slog.ErrorContext(ctx, "settlement import panicked", "uploaded_file_id", file.ID, "panic", r, "stack", string(debug.Stack()))

	s.fail(ctx, file, "The import stopped on an internal error — upload the same file again to finish it", log)
}

// ── orders ─────────────────────────────────────────────────────────────────────────────────────────

// refsOf is every order ref the lines carry, once each.
func refsOf(records []record) []string {
	seen := map[string]bool{}
	refs := []string{}

	for i := range records {
		ref := records[i].orderRef
		if ref == "" || seen[ref] {
			continue
		}

		seen[ref] = true
		refs = append(refs, ref)
	}

	return refs
}

// foreignShop is the other shop of the team a file's orders belong to — counting only refs found in NO
// order of the chosen shop: a ref the chosen shop also has counts as the chosen shop's, so a ref two
// shops happen to share never fails a file by itself. 0 = none. The shop named is the one holding the
// most such refs, and `refs` is how many there are.
func foreignShop(found map[string][]OrderRef, shopID uint64) (uint64, int) {
	perShop := map[uint64]int{}
	refs := 0

	for _, orders := range found {
		if len(orders) == 0 {
			continue
		}

		mine := false

		for _, order := range orders {
			if order.ShopID == shopID {
				mine = true

				break
			}
		}

		if mine {
			continue
		}

		refs++
		perShop[orders[0].ShopID]++
	}

	if refs == 0 {
		return 0, 0
	}

	shops := make([]uint64, 0, len(perShop))
	for id := range perShop {
		shops = append(shops, id)
	}

	sort.Slice(shops, func(i, j int) bool {
		if perShop[shops[i]] != perShop[shops[j]] {
			return perShop[shops[i]] > perShop[shops[j]]
		}

		return shops[i] < shops[j]
	})

	return shops[0], refs
}

// orderInShop picks the order a line posts to among those its ref finds in the shop: a live one before a
// cancelled one — a cancelled order re-entered under the same ref is the re-entry's — and the newest of
// equals.
func orderInShop(orders []OrderRef, shopID uint64) (OrderRef, bool) {
	var (
		best  OrderRef
		found bool
	)

	for _, order := range orders {
		if order.ShopID != shopID {
			continue
		}

		switch {
		case !found,
			best.Cancelled && !order.Cancelled,
			best.Cancelled == order.Cancelled && order.OrderID > best.OrderID:
			best = order
			found = true
		}
	}

	return best, found
}

// shopName names another shop of the team for the refusal line — asked of the shop, and a plain id if
// it cannot say.
func (s *Service) shopName(ctx context.Context, teamID, shopID, userID uint64) string {
	shop, err := s.shops.CheckShop(ctx, teamID, shopID, userID)
	if err != nil || shop.Name == "" {
		return "shop #" + formatID(shopID)
	}

	return shop.Name
}

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────

func platformName(platform marketplacev1.Marketplace) string {
	switch platform {
	case marketplacev1.Marketplace_MARKETPLACE_TIKTOK:
		return "TikTok"
	case marketplacev1.Marketplace_MARKETPLACE_SHOPEE:
		return "Shopee"
	default:
		return platform.String()
	}
}

// rpcMessage is an error as a person reads it — a connect error's message without its code.
func rpcMessage(err error) string {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr.Message()
	}

	return err.Error()
}

func dateOf(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}

	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)

	return &day
}

func periodText(file *settlement_importer_service_models.UploadedFile) string {
	if file.PeriodFrom == nil || file.PeriodTo == nil {
		return ""
	}

	if file.PeriodFrom.Equal(*file.PeriodTo) {
		return ", " + file.PeriodFrom.Format(dateLayout)
	}

	return ", " + file.PeriodFrom.Format(dateLayout) + " – " + file.PeriodTo.Format(dateLayout)
}

// noteMaxRunes is SettlementPost's own cap on a note.
const noteMaxRunes = 500

func truncate(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}

	return string(runes[:limit])
}

func formatID(id uint64) string {
	return strconv.FormatUint(id, 10)
}

// groupDigits writes 246123 as "246,123".
func groupDigits(n int) string {
	digits := strconv.Itoa(n)

	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}

	return digits
}
