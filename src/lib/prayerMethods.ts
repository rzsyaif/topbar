import type { CalculationMethod } from "adhan";

export type MethodId =
  | "kemenag"
  | "muis"
  | "mwl"
  | "isna"
  | "umm"
  | "egypt"
  | "karachi"
  | "dubai"
  | "qatar"
  | "kuwait"
  | "turkey"
  | "tehran"
  | "moonsighting";

type Base = keyof typeof CalculationMethod;

/** Calculation methods, named the way people know them. */
export const METHODS: { id: MethodId; label: string; region: string; base: Base; ihtiyat?: number }[] = [
  // Kemenag uses Fajr 20° / Isha 18° plus a ~2 minute safety margin (ihtiyat).
  { id: "kemenag", label: "Kemenag", region: "Indonesia", base: "Singapore", ihtiyat: 2 },
  { id: "muis", label: "MUIS / JAKIM", region: "Singapore, Malaysia, Brunei", base: "Singapore" },
  { id: "mwl", label: "Muslim World League", region: "Europe, Far East, much of the world", base: "MuslimWorldLeague" },
  { id: "isna", label: "ISNA", region: "North America", base: "NorthAmerica" },
  { id: "moonsighting", label: "Moonsighting Committee", region: "UK, North America", base: "MoonsightingCommittee" },
  { id: "umm", label: "Umm al-Qura", region: "Saudi Arabia", base: "UmmAlQura" },
  { id: "egypt", label: "Egyptian Authority", region: "Egypt, parts of Africa", base: "Egyptian" },
  { id: "karachi", label: "Karachi", region: "Pakistan, India, Bangladesh", base: "Karachi" },
  { id: "dubai", label: "Dubai", region: "United Arab Emirates", base: "Dubai" },
  { id: "qatar", label: "Qatar", region: "Qatar", base: "Qatar" },
  { id: "kuwait", label: "Kuwait", region: "Kuwait", base: "Kuwait" },
  { id: "turkey", label: "Diyanet", region: "Turkey", base: "Turkey" },
  { id: "tehran", label: "Tehran", region: "Iran", base: "Tehran" },
];

export const methodById = (id: MethodId) => METHODS.find((m) => m.id === id) ?? METHODS[0];

/** A sensible default for a country (ISO code). People can always change it. */
export function suggestMethod(country?: string | null): { method: MethodId; madhab: "shafi" | "hanafi" } {
  const c = (country ?? "").toUpperCase();
  const hanafi = ["PK", "IN", "BD", "AF", "TR"].includes(c);
  const map: Record<string, MethodId> = {
    ID: "kemenag",
    MY: "muis",
    SG: "muis",
    BN: "muis",
    SA: "umm",
    US: "isna",
    CA: "isna",
    GB: "moonsighting",
    EG: "egypt",
    PK: "karachi",
    IN: "karachi",
    BD: "karachi",
    AF: "karachi",
    AE: "dubai",
    QA: "qatar",
    KW: "kuwait",
    TR: "turkey",
    IR: "tehran",
  };
  return { method: map[c] ?? "mwl", madhab: hanafi ? "hanafi" : "shafi" };
}
