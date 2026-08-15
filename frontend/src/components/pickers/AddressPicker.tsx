import { useEffect, useRef, useState } from "react";
import {
  Combobox,
  Field,
  Portal,
  Span,
  Spinner,
  Stack,
  Textarea,
  useListCollection,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { regionClient, rpcError } from "../../api/clients";
import { useRegionByKodePos } from "../../features/region/queries";
import { useDebounced } from "../../lib/useDebounced";
import type { Region, RegionAncestry } from "../../gen/warehouse/region/v1/region_pb";

// What the picker emits — codes AND names, so a consumer can SNAPSHOT the address onto its own
// record without a second round-trip (plans/region_service/brainstorming.md §5: a saved address is
// frozen text, never a live FK into the region tree).
export type AddressValue = {
  provinsiCode: string;
  provinsiName: string;
  kabupatenCode: string;
  kabupatenName: string;
  kecamatanCode: string;
  kecamatanName: string;
  desaCode: string;
  desaName: string;
  /** Auto-filled from the chosen desa, but EDITABLE — a kelurahan is not strictly 1:1 with one
   * postcode (§3), so the person typing gets the last word. */
  kodePos: string;
  /** Jalan, no. rumah, RT/RW — the part no dataset can supply. */
  addressLine: string;
};

export const emptyAddress: AddressValue = {
  provinsiCode: "",
  provinsiName: "",
  kabupatenCode: "",
  kabupatenName: "",
  kecamatanCode: "",
  kecamatanName: "",
  desaCode: "",
  desaName: "",
  kodePos: "",
  addressLine: "",
};

export interface AddressPickerProps {
  /** The current address. CONTROLLED — the consumer owns the value so it can snapshot it. */
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
}

// A level is dozens of rows (a kecamatan's desa), never the whole 83.762 — so one page per level is
// the whole story, no pager in the picker.
//
// 200 is the CEILING PageFilter allows (common/v1/page.proto: lte 200), and it is comfortably enough:
// the largest level in the real dataset is Abenaho's 108 desa, and NO region anywhere has more than
// 200 children. If a future Kepmendagri edition ever crosses that, this silently truncates a level —
// so the number is checked, not guessed.
const LEVEL_LIMIT = 200;
// A typeahead is capped, not paged: it can never return "everything" (HARD RULE 9).
const SEARCH_LIMIT = 10;
// Three digits before we ask — the floor the proto enforces. One digit covers a tenth of the
// country's desa, and twenty rows out of thousands is a lottery, not a suggestion.
const SEARCH_MIN_DIGITS = 3;
// An Indonesian kode pos is five digits, always.
const KODE_POS_DIGITS = 5;
const SEARCH_DEBOUNCE_MS = 250;

// Module scope on purpose: useListCollection memoizes the collection on this reference, so an inline
// arrow would rebuild the collection on every render.
const containsFilter = (itemText: string, filterText: string) =>
  itemText.toLowerCase().includes(filterText.toLowerCase());

// The deepest level the value carries a code for, with that level's name. Drives hydration: a code
// with no name is a saved snapshot that arrived as codes only.
function deepestLevel(v: AddressValue): { code: string; name: string } {
  if (v.desaCode) return { code: v.desaCode, name: v.desaName };
  if (v.kecamatanCode) return { code: v.kecamatanCode, name: v.kecamatanName };
  if (v.kabupatenCode) return { code: v.kabupatenCode, name: v.kabupatenName };
  if (v.provinsiCode) return { code: v.provinsiCode, name: v.provinsiName };
  return { code: "", name: "" };
}

// A search hit's own name — the deepest level it fills in.
function hitName(a: RegionAncestry): string {
  return a.desaName || a.kecamatanName || a.kabupatenName || a.provinsiName;
}

// Everything ABOVE the hit, nearest first ("Bakongan, Kabupaten Aceh Selatan, Aceh"). 83.762 desa
// share a lot of names, so a bare name is ambiguous — the path is what makes a hit pickable.
function hitPath(a: RegionAncestry): string {
  const above = a.desaCode
    ? [a.kecamatanName, a.kabupatenName, a.provinsiName]
    : a.kecamatanCode
      ? [a.kabupatenName, a.provinsiName]
      : a.kabupatenCode
        ? [a.provinsiName]
        : [];

  return above.filter(Boolean).join(", ");
}

interface LevelSelectProps {
  label: string;
  placeholder: string;
  testId: string;
  /** Whose children to list. Empty + enabled is the top level — the 38 provinsi. */
  parentCode: string;
  /** False until the level above resolves: the select is disabled and loads nothing. */
  enabled: boolean;
  code: string;
  name: string;
  onPick: (region: Region | null) => void;
  disabled?: boolean;
}

// One rung of the cascade. Loads its level by parent_code — NEVER the whole tree: regions are ~84k
// nodes, so this is deliberately not the CategorySelect full-tree pattern (brainstorming §2).
function LevelSelect({
  label,
  placeholder,
  testId,
  parentCode,
  enabled,
  code,
  name,
  onPick,
  disabled,
}: LevelSelectProps) {
  const { t } = useTranslation();
  // The text the user is typing. null = "not typing" → show the selected name from the value prop.
  // Controlling the input this way keeps the label correct even when the options haven't loaded yet
  // (a hydrated snapshot), which an uncontrolled input cannot do.
  const [typed, setTyped] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { collection, filter, set } = useListCollection<Region>({
    initialItems: [],
    filter: containsFilter,
    itemToString: (r) => r.name,
    itemToValue: (r) => r.code,
  });

  useEffect(() => {
    if (!enabled) {
      set([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    regionClient
      .regionList({ parentCode, page: { page: 1, limit: LEVEL_LIMIT } })
      .then((res) => {
        if (!cancelled) set(res.regions);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(rpcError(err));
          set([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [parentCode, enabled, set]);

  const off = disabled || !enabled;

  return (
    <Field.Root disabled={off} invalid={error !== ""}>
      <Field.Label>{label}</Field.Label>

      <Combobox.Root
        collection={collection}
        disabled={off}
        openOnClick
        value={code ? [code] : []}
        inputValue={typed ?? name}
        onValueChange={(e) => onPick(e.items[0] ?? null)}
        onInputValueChange={(e) => {
          // Only a keystroke is "typing". Every other reason (item-select, clear, blur-revert) means
          // the machine is settling the text — hand it back to the value prop.
          if (e.reason === "input-change") {
            setTyped(e.inputValue);
            filter(e.inputValue);
            return;
          }
          setTyped(null);
          filter("");
        }}
        onOpenChange={(e) => {
          if (!e.open) {
            setTyped(null);
            filter("");
          }
        }}
        data-testid={testId}
      >
        <Combobox.Control>
          <Combobox.Input placeholder={placeholder} />
          <Combobox.IndicatorGroup>
            {loading ? <Spinner size="xs" colorPalette="brand" /> : <Combobox.ClearTrigger />}
            <Combobox.Trigger />
          </Combobox.IndicatorGroup>
        </Combobox.Control>

        <Portal>
          <Combobox.Positioner>
            <Combobox.Content>
              <Combobox.Empty>
                {loading ? t("address.loading") : error || t("address.noResults")}
              </Combobox.Empty>
              {collection.items.map((r) => (
                <Combobox.Item item={r} key={r.code} data-testid={`${testId}-option-${r.code}`}>
                  {r.name}
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              ))}
            </Combobox.Content>
          </Combobox.Positioner>
        </Portal>
      </Combobox.Root>

      {error !== "" && <Field.ErrorText>{error}</Field.ErrorText>}
    </Field.Root>
  );
}

// THE FAST PATH, AND IT IS THE KODE POS (owner). Type the postcode, get the addresses it covers;
// picking one back-fills all four levels with NO extra round-trip.
//
// It replaced a search over region NAMES, and the reason is what people actually have in front of
// them. A buyer's message carries five digits, copied correctly. It does not carry a spelling of
// their kelurahan that matches the government's — hundreds of desa are called some variant of
// "Sukamaju", and the person typing the order cannot tell which of ten identical-looking hits is the
// right one. A postcode is unambiguous to type and narrows to a handful.
//
// ⚠ It is BOTH the search box and the field. The kode pos is part of the address, so this is not a
// jump control that throws its input away (the way the old search was) — what is typed here IS
// `value.kodePos`, and it stays editable whether or not a suggestion is ever picked: a kelurahan is
// not strictly 1:1 with one postcode (§3), so the person typing gets the last word.
function KodePosField({
  value,
  onChange,
  onPick,
  disabled,
}: {
  value: string;
  onChange: (kodePos: string) => void;
  onPick: (ancestry: RegionAncestry) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  // The text being typed. null = "not typing" → show the value prop, which is how a kode pos that
  // arrived from picking a desa below still displays here. Same shape as LevelSelect.
  const [typed, setTyped] = useState<string | null>(null);

  const { collection, set } = useListCollection<RegionAncestry>({
    initialItems: [],
    itemToString: (a) => a.kodePos,
    itemToValue: (a) => a.desaCode,
  });

  // Server-side, debounced, >= 3 digits (the proto rejects shorter). No client filter: a prefix
  // match is the server's answer, and re-filtering it here would only ever remove rows.
  const q = useDebounced((typed ?? value).replace(/\D/g, ""), SEARCH_DEBOUNCE_MS);
  const results = useRegionByKodePos({ kodePos: q, limit: SEARCH_LIMIT, minChars: SEARCH_MIN_DIGITS });
  const loading = q.length >= SEARCH_MIN_DIGITS && results.isPending;

  useEffect(() => {
    set(q.length >= SEARCH_MIN_DIGITS ? (results.data ?? []) : []);
  }, [q, results.data, set]);

  return (
    <Field.Root disabled={disabled}>
      <Field.Label>{t("address.kodePos")}</Field.Label>

      {/* `value` stays [] and every keystroke writes through to the address: the input displays the
          POSTCODE, never the chosen desa's label, so the selection is not what this control holds. */}
      <Combobox.Root
        collection={collection}
        disabled={disabled}
        value={[]}
        inputValue={typed ?? value}
        onValueChange={(e) => {
          const hit = e.items[0];
          if (hit) {
            // Back to the value prop — applying the hit sets the kode pos, and the typed prefix must
            // not linger over the top of it (picking on "2377" fills in "23773").
            setTyped(null);
            onPick(hit);
          }
        }}
        onInputValueChange={(e) => {
          if (e.reason === "input-change") {
            // Digits only. A kode pos has no other characters, and stripping here means the search,
            // the stored value and what is on screen can never disagree about what was typed.
            const digits = e.inputValue.replace(/\D/g, "").slice(0, KODE_POS_DIGITS);
            setTyped(digits);
            onChange(digits);
            return;
          }
          setTyped(null);
        }}
        onOpenChange={(e) => {
          if (!e.open) setTyped(null);
        }}
        data-testid="address-kodepos"
      >
        <Combobox.Control>
          <Combobox.Input inputMode="numeric" placeholder={t("address.kodePosPlaceholder")} />
          {loading && (
            <Combobox.IndicatorGroup>
              <Spinner size="xs" colorPalette="brand" />
            </Combobox.IndicatorGroup>
          )}
        </Combobox.Control>

        <Portal>
          <Combobox.Positioner>
            <Combobox.Content>
              <Combobox.Empty>
                {q.length < SEARCH_MIN_DIGITS
                  ? t("address.kodePosMinDigits", { min: SEARCH_MIN_DIGITS })
                  : loading
                    ? t("address.loading")
                    : t("address.kodePosNoResults")}
              </Combobox.Empty>
              {collection.items.map((a) => (
                <Combobox.Item
                  item={a}
                  key={a.desaCode}
                  data-testid={`address-kodepos-option-${a.desaCode}`}
                >
                  <Stack gap="0">
                    {/* The postcode leads: one code routinely covers several desa, so it is the
                        column the eye scans while the name is what distinguishes the rows. */}
                    <Span fontWeight="medium">
                      {a.kodePos} — {hitName(a)}
                    </Span>
                    <Span fontSize="xs" color="fg.muted">
                      {hitPath(a)}
                    </Span>
                  </Stack>
                </Combobox.Item>
              ))}
            </Combobox.Content>
          </Combobox.Positioner>
        </Portal>
      </Combobox.Root>

      <Field.HelperText>{t("address.kodePosHelp")}</Field.HelperText>
    </Field.Root>
  );
}

// AddressPicker is the shared Indonesian address entry control (#112/#117) — the one place every
// screen that takes an address (order customer, warehouse, shop, user profile) reuses, so they all
// produce the same shape.
//
// The KODE POS on top — type the postcode and the addresses it covers are suggested, one pick
// filling everything below (owner). Then four cascading searchable Selects (provinsi →
// kabupaten/kota → kecamatan → desa/kelurahan), each loading its level by parent_code as the one
// above resolves, and free text for the street. The two directions meet in the middle: the postcode
// fills the cascade, and choosing a desa fills the postcode.
export const description =
  "Indonesian address entry (#117): the kode pos on top doubles as the search — type a postcode and pick from the desa it covers, which back-fills every level. Below it four cascading searchable region Selects (provinsi → kabupaten/kota → kecamatan → desa/kelurahan) loaded level-by-level, and free-text street detail. Controlled — emits an AddressValue (codes + names) a consumer can snapshot.";

export function AddressPicker({ value, onChange, disabled }: AddressPickerProps) {
  const { t } = useTranslation();

  // Hydration guards: remember which code we already resolved, and read the live value/onChange
  // without making them effect dependencies (they change on every keystroke).
  const resolvedRef = useRef("");
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { code: deepCode, name: deepName } = deepestLevel(value);

  // A consumer can hand us a saved address as CODES ONLY. One RegionResolve back-fills the labels.
  // Guarded twice: once per code (the ref), and skipped entirely the moment a name is present — so
  // a pick, which always carries its own name, can never trigger this.
  useEffect(() => {
    if (!deepCode || deepName || resolvedRef.current === deepCode) {
      return;
    }

    // Claimed BEFORE the await: one resolve per code even under StrictMode's double-invoke.
    resolvedRef.current = deepCode;
    let cancelled = false;

    regionClient
      .regionResolve({ code: deepCode })
      .then((res) => {
        const a = res.ancestry;
        if (cancelled || !a) {
          return;
        }

        onChangeRef.current({
          ...valueRef.current,
          provinsiCode: a.provinsiCode,
          provinsiName: a.provinsiName,
          kabupatenCode: a.kabupatenCode,
          kabupatenName: a.kabupatenName,
          kecamatanCode: a.kecamatanCode,
          kecamatanName: a.kecamatanName,
          desaCode: a.desaCode,
          desaName: a.desaName,
          // A snapshot may carry an edited kode pos — never clobber it with the dataset's.
          kodePos: valueRef.current.kodePos || a.kodePos,
        });
      })
      .catch((err) => {
        void rpcError(err);
      });

    return () => {
      cancelled = true;
    };
  }, [deepCode, deepName]);

  // Picking a level CLEARS every level below it, and the kode pos with them — a kabupaten left over
  // from the previous provinsi is a wrong address that still looks filled in. addressLine survives:
  // it is free text, not something derived from the region.
  function pickProvinsi(r: Region | null) {
    onChange({
      ...emptyAddress,
      addressLine: value.addressLine,
      provinsiCode: r?.code ?? "",
      provinsiName: r?.name ?? "",
    });
  }

  function pickKabupaten(r: Region | null) {
    onChange({
      ...value,
      kabupatenCode: r?.code ?? "",
      kabupatenName: r?.name ?? "",
      kecamatanCode: "",
      kecamatanName: "",
      desaCode: "",
      desaName: "",
      kodePos: "",
    });
  }

  function pickKecamatan(r: Region | null) {
    onChange({
      ...value,
      kecamatanCode: r?.code ?? "",
      kecamatanName: r?.name ?? "",
      desaCode: "",
      desaName: "",
      kodePos: "",
    });
  }

  // The desa is what carries the kode pos, so choosing one fills it in.
  function pickDesa(r: Region | null) {
    onChange({
      ...value,
      desaCode: r?.code ?? "",
      desaName: r?.name ?? "",
      kodePos: r?.kodePos ?? "",
    });
  }

  function applyHit(a: RegionAncestry) {
    resolvedRef.current = a.desaCode || a.kecamatanCode || a.kabupatenCode || a.provinsiCode;
    onChange({
      ...value,
      provinsiCode: a.provinsiCode,
      provinsiName: a.provinsiName,
      kabupatenCode: a.kabupatenCode,
      kabupatenName: a.kabupatenName,
      kecamatanCode: a.kecamatanCode,
      kecamatanName: a.kecamatanName,
      desaCode: a.desaCode,
      desaName: a.desaName,
      kodePos: a.kodePos,
    });
  }

  return (
    <Stack gap="field">
      {/* THE KODE POS COMES FIRST, and that placement is the design (owner). It is now the way in:
          five digits off the buyer's message fill the four levels below in one pick. Leaving it at
          the bottom — where it sat when it was only an OUTPUT of choosing a desa — would hide the
          fast path behind the slow one. It is still filled in by the cascade, so a person who has no
          postcode simply works downwards and finds it filled when they arrive. */}
      <KodePosField
        value={value.kodePos}
        onChange={(kodePos) => onChange({ ...value, kodePos })}
        onPick={applyHit}
        disabled={disabled}
      />

      <LevelSelect
        label={t("address.provinsi")}
        placeholder={t("address.provinsiPlaceholder")}
        testId="address-provinsi"
        parentCode=""
        enabled
        code={value.provinsiCode}
        name={value.provinsiName}
        onPick={pickProvinsi}
        disabled={disabled}
      />

      <LevelSelect
        label={t("address.kabupaten")}
        placeholder={t("address.kabupatenPlaceholder")}
        testId="address-kabupaten"
        parentCode={value.provinsiCode}
        enabled={value.provinsiCode !== ""}
        code={value.kabupatenCode}
        name={value.kabupatenName}
        onPick={pickKabupaten}
        disabled={disabled}
      />

      <LevelSelect
        label={t("address.kecamatan")}
        placeholder={t("address.kecamatanPlaceholder")}
        testId="address-kecamatan"
        parentCode={value.kabupatenCode}
        enabled={value.kabupatenCode !== ""}
        code={value.kecamatanCode}
        name={value.kecamatanName}
        onPick={pickKecamatan}
        disabled={disabled}
      />

      <LevelSelect
        label={t("address.desa")}
        placeholder={t("address.desaPlaceholder")}
        testId="address-desa"
        parentCode={value.kecamatanCode}
        enabled={value.kecamatanCode !== ""}
        code={value.desaCode}
        name={value.desaName}
        onPick={pickDesa}
        disabled={disabled}
      />

      <Field.Root disabled={disabled}>
        <Field.Label>{t("address.addressLine")}</Field.Label>
        <Textarea
          value={value.addressLine}
          data-testid="address-line"
          rows={2}
          placeholder={t("address.addressLinePlaceholder")}
          onChange={(e) => onChange({ ...value, addressLine: e.target.value })}
        />
        <Field.HelperText>{t("address.addressLineHelp")}</Field.HelperText>
      </Field.Root>
    </Stack>
  );
}
