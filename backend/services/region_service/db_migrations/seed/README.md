# `regions.csv` — Indonesian administrative regions seed (#113)

`regions.csv` is **generated, not hand-edited**. It is the reference data behind `region_service`:
every provinsi → kabupaten/kota → kecamatan → desa/kelurahan in Indonesia, with a kode pos on each
desa. [#114](https://github.com/pdcgo/warehouse_revamp/issues/114)'s goose migration loads it.

## Regenerate

From `./backend`:

```sh
go run ./cmd/tool region build-seed
```

That is the whole step — it downloads the two pinned dumps, converts them, checks the result, and
rewrites this file. Same SHAs in, same CSV out.

## Source

The Kemendagri-official, actively maintained pair by cahya dsn (MIT licensed):

| | Repo | Pinned commit |
| --- | --- | --- |
| regions | [`cahyadsn/wilayah`](https://github.com/cahyadsn/wilayah) | `d68e8d5516f969d1905d0b2940f20034becb0db7` |
| kode pos | [`cahyadsn/wilayah_kodepos`](https://github.com/cahyadsn/wilayah_kodepos) | `e007157ccd3b3fdade7277245a35cd9d89fbf15a` |

Both dumps declare **Kepmendagri No 300.2.2-2138 Tahun 2025**. Same maintainer and the same 10-digit
kode wilayah key, so a kode pos **joins onto its desa row** rather than being name-matched.

> **Pinned by commit SHA, never a branch.** `master` moves whenever the government revises the
> wilayah (roughly yearly). An unpinned fetch would silently change the country under us. Bumping the
> edition is a deliberate act: change the SHA constants in
> [`cmd/tool/region_seed.go`](../../../../cmd/tool/region_seed.go) (or pass `--wilayah-sha` /
> `--kodepos-sha`), re-run, and review the diff.

> The #112 plan cites Kepmendagri "300.2.2-2430/2025"; what upstream actually ships is **2138/2025**,
> and its volume matches the plan's expected counts exactly (below). Flagged rather than silently
> reconciled.

## Shape

```
code,parent_code,level,name,kode_pos
11,,1,Aceh,
11.01,11,2,Kabupaten Aceh Selatan,
11.01.01,11.01,3,Bakongan,
11.01.01.2001,11.01.01,4,Keude Bakongan,23773
```

- `code` — the dotted kode wilayah; the primary key.
- `parent_code` — **empty for a provinsi**; otherwise the code with its last segment removed. The
  hierarchy is derived from the code itself, which is what makes the single self-referential
  `regions` table (plan §4.2 option A) a near-verbatim load of the source.
- `level` — `1` provinsi · `2` kabupaten/kota · `3` kecamatan · `4` desa/kelurahan.
- `kode_pos` — **level 4 only**, empty elsewhere.

Rows are sorted by `code`, so the file is deterministic **and** every parent appears before its
children.

## What the generator guarantees

- **No silent row loss.** 475 names contain an apostrophe, escaped SQL-style as a doubled quote
  (`'Pasi Kuala Ba''u'`). A name pattern that forbids quotes parses the file happily and drops all
  475 villages. The parser therefore counts the dump's tuple lines and **fails** unless it produced
  exactly that many rows — so a future upstream quoting change breaks loudly instead of seeding a
  country with holes in it.
- **The tree hangs together.** Every non-provinsi row's `parent_code` must exist and sit exactly one
  level up; no duplicate codes. An orphan is a picker that dead-ends.

## Current contents (edition 300.2.2-2138/2025)

| Level | Rows |
| --- | --- |
| provinsi | 38 |
| kabupaten/kota | 514 |
| kecamatan | 7 285 |
| desa/kelurahan | 83 762 |
| **total** | **91 599** |

Kode pos covers **83 762 of 83 762 desa** — complete for this edition. (The plan expected a few to
lack one; none do. The generator prints the shortfall, so a future edition's gaps will show up.)

Officially one kode pos per desa/kelurahan, so it is a **column on the desa row**, not a table. In
big cities a kelurahan can span several postcodes — the source maps one best-effort code per desa,
which is fine for shipping. A precise multi-postcode model needs PT Pos data and is out of scope
(plan §3).
