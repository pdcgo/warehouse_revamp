-- +goose Up
-- +goose StatementBegin
-- ONE COST KIND, because there was only ever one thing being described.
--
-- `cod_shipping` and `other` both meant: what the warehouse had to pay to get this delivery in.
-- Splitting them bought a dropdown with two entries and cost the ledger a real distinction — see
-- the-ledger-speaks-the-business-words, which collapsed the ledger side in 00005.
--
-- ⚠ THIS IS THE LAST STEP OF THAT DECISION. The ledger's source types moved in liability_service
-- 00005; this is the cost-line half, and it waited on a rule only the owner could set — whether a
-- line must carry a note once the kind stops saying what the money was
-- (an-incidental-line-must-say-what-it-was-for: yes).
UPDATE restock_cost_lines SET kind = 'incidental' WHERE kind IN ('cod_shipping', 'other');

-- ⚠ NO NOT-NULL / NON-EMPTY CONSTRAINT ON `note`, deliberately.
--
-- The requirement is enforced in the CONTRACT (`RestockCostLine.note` has `min_len: 1`), which binds
-- every new write. It cannot bind the rows already here: a `cod_shipping` line written before today
-- was legitimately noteless — the kind said what it was — and no migration can invent the sentence
-- that was never typed.
--
-- Adding a CHECK would therefore either fail on real history or force a made-up note onto it. A
-- fabricated explanation on a charge to another team is worse than an empty one, because it reads as
-- evidence.
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ NOT A ROUND TRIP. Every collapsed row goes back as `other`, including the ones that were
-- `cod_shipping` — nothing recorded which they had been. `other` rather than `cod_shipping` because
-- it is the safer of the two to be wrong about: `other` claims nothing about where the money went,
-- while `cod_shipping` would assert a courier was paid at the door.
UPDATE restock_cost_lines SET kind = 'other' WHERE kind = 'incidental';
-- +goose StatementEnd
