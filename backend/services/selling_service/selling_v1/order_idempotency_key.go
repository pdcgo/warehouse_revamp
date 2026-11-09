package selling_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE ORDER'S IDEMPOTENCY KEY (backlog #10, slice 1) — minted by the form inside every submit
// (the-frontend-mints-the-idempotency-key, every-submit-mints-a-new-key), stored on the order
// (the-order-stores-its-idempotency-key) and UNIQUE (the-idempotency-key-is-unique).
//
// Since slice 3 it is also the key the order's stock take is filed under (placeOrder) and released by — the cancel and
// the compensation alike (every-release-goes-by-the-key).

// filledKeyPrefix is the shape migration 00035 filled a developer's older rows with (`order:<id>`,
// revamp-has-no-real-orders-yet). A new key never takes it, so it can never meet one of those rows — nor the take such a
// row was filed under before the key existed, which was that same `order:<id>`.
const filledKeyPrefix = "order:"

var (
	errOrderNoKey = errors.New("an order must carry the idempotency key its submit minted")
	// The reserved shape, refused rather than stored: it is the migration's, not a browser's.
	errOrderReservedKey = errors.New("an idempotency key must not start with \"order:\" — that shape is reserved")
	// What a used key is refused with, worded for whoever reads the log; the form reads the KEY_USED detail instead.
	errOrderKeyUsed = errors.New("this idempotency key is already used by another order — submit again to send a new one")
)

// keyShapeError is the key's own rule, whichever door calls: required (revamp-has-no-real-orders-yet), never the
// reserved `order:` shape. The 128 cap is the request's validation.
func keyShapeError(key string) error {
	if key == "" {
		return errOrderNoKey
	}

	if strings.HasPrefix(key, filledKeyPrefix) {
		return errOrderReservedKey
	}

	return nil
}

// refuseUsedKey answers keyUsed when an order already holds `key` (the-order-refuses-a-used-key) — never that order:
// nothing is ever returned by key, so no team match is needed and no other team's order is disclosed.
//
// ⚠ AWAITS THE OWNER (#10 Q10): checked FIRST, before the owner lookup and the credit check, as recommended. A
// read-then-insert cannot stop two submits of one key in the same second; orders_idempotency_key_idx does, and its
// violation is answered with this same refusal (placeOrder).
func (s *Service) refuseUsedKey(ctx context.Context, key string) error {
	// A COUNT over a UNIQUE column: at most one row, read off orders_idempotency_key_idx alone.
	var used int64

	err := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		Where("idempotency_key = ?", key).
		Count(&used).
		Error
	if err != nil {
		return dbError(err)
	}

	if used > 0 {
		return keyUsed()
	}

	return nil
}

// keyUsed is the refusal of a used key — AlreadyExists carrying inventory's OrderTransactionRefusal with KEY_USED and
// no lines (⚠ awaits the owner, #10 Q9 — built as recommended): the same detail the take answers a used key with, so
// the order form shows its one *key already used* message whichever service refused.
func keyUsed() error {
	err := connect.NewError(connect.CodeAlreadyExists, errOrderKeyUsed)

	detail, detailErr := connect.NewErrorDetail(&inventoryv1.OrderTransactionRefusal{
		Reason: inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED,
	})
	if detailErr == nil {
		err.AddDetail(detail)
	}

	return err
}

// isUniqueViolation detects a duplicate key in BOTH forms — GORM opened with TranslateError turns the driver's 23505
// into gorm.ErrDuplicatedKey, a raw Exec may not.
func isUniqueViolation(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}

	return false
}
