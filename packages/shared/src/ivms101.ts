// #9 — IVMS101 (interVASP Messaging Standard 101) — the data model the Travel Rule networks (TRP, TRISA, OpenVASP,
// commercial providers) use for originator / beneficiary information. This file holds the SUBSET we use, a strict
// validator (data validation only — no cryptography here) and the builders from our own records.
// Reference: IVMS101 (2020 edition, JSON binding: camelCase element names). Not every element of the standard is
// modelled; anything outside this subset is REJECTED by the validator (no free-form blobs travel between VASPs).

export type NaturalPersonNameTypeCode = 'ALIA' | 'BIRT' | 'MAID' | 'LEGL' | 'MISC';
export type LegalPersonNameTypeCode = 'LEGL' | 'SHRT' | 'TRAD';
export type AddressTypeCode = 'HOME' | 'BIZZ' | 'GEOG';
export type NationalIdentifierTypeCode = 'ARNU' | 'CCPT' | 'RAID' | 'DRLC' | 'FIIN' | 'TXID' | 'SOCS' | 'IDCD' | 'LEIX' | 'MISC';

export interface NaturalPersonNameId {
  primaryIdentifier: string; // family name
  secondaryIdentifier?: string; // given names
  nameIdentifierType: NaturalPersonNameTypeCode;
}
export interface LegalPersonNameId {
  legalPersonName: string;
  legalPersonNameIdentifierType: LegalPersonNameTypeCode;
}
export interface GeographicAddress {
  addressType: AddressTypeCode;
  streetName?: string;
  buildingNumber?: string;
  postCode?: string;
  townName?: string;
  addressLine?: string[];
  country: string; // ISO 3166-1 alpha-2
}
export interface NationalIdentification {
  nationalIdentifier: string;
  nationalIdentifierType: NationalIdentifierTypeCode;
  countryOfIssue?: string;
}
export interface DateAndPlaceOfBirth {
  dateOfBirth: string; // YYYY-MM-DD
  placeOfBirth: string;
}
export interface NaturalPerson {
  name: { nameIdentifier: NaturalPersonNameId[] };
  geographicAddress?: GeographicAddress[];
  nationalIdentification?: NationalIdentification;
  customerIdentification?: string;
  dateAndPlaceOfBirth?: DateAndPlaceOfBirth;
  countryOfResidence?: string;
}
export interface LegalPerson {
  name: { nameIdentifier: LegalPersonNameId[] };
  geographicAddress?: GeographicAddress[];
  customerNumber?: string;
  nationalIdentification?: NationalIdentification;
  countryOfRegistration?: string;
}
export type Person = { naturalPerson: NaturalPerson } | { legalPerson: LegalPerson };

export interface Ivms101Message {
  originator: { originatorPersons: Person[]; accountNumber: string[] };
  beneficiary: { beneficiaryPersons: Person[]; accountNumber: string[] };
  originatingVASP: { originatingVASP: { legalPerson: LegalPerson } };
  beneficiaryVASP?: { beneficiaryVASP: { legalPerson: LegalPerson } };
}

// ───────────────────────────── Validation ─────────────────────────────

const NP_NAME_TYPES = ['ALIA', 'BIRT', 'MAID', 'LEGL', 'MISC'];
const LP_NAME_TYPES = ['LEGL', 'SHRT', 'TRAD'];
const ADDRESS_TYPES = ['HOME', 'BIZZ', 'GEOG'];
const NATIONAL_ID_TYPES = ['ARNU', 'CCPT', 'RAID', 'DRLC', 'FIIN', 'TXID', 'SOCS', 'IDCD', 'LEIX', 'MISC'];
const COUNTRY_RE = /^[A-Z]{2}$/;
const MAX_TEXT = 100; // IVMS101 Max100Text for names; addresses use Max70Text / Max35Text (checked below)

/** ISO 17442 LEI: 18 alphanumerics + 2 check digits (ISO 7064 MOD 97-10). */
export function isValidLei(lei: string): boolean {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) return false;
  let r = 0;
  for (const ch of lei) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) r = (r * 10 + Number(d)) % 97;
  }
  return r === 1;
}

type Errs = string[];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (e: Errs, p: string, v: unknown, max: number, required = true) => {
  if (v === undefined && !required) return;
  if (typeof v !== 'string' || !v.trim()) return void e.push(`${p}: required non-empty text`);
  if (v.length > max) e.push(`${p}: longer than ${max} characters`);
  if (/[\u0000-\u001f\u007f]/.test(v)) e.push(`${p}: control characters are not allowed`);
};
const onlyKeys = (e: Errs, p: string, o: Record<string, unknown>, allowed: string[]) => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) e.push(`${p}.${k}: element not allowed in this IVMS101 subset`);
};
const country = (e: Errs, p: string, v: unknown, required = true) => {
  if (v === undefined && !required) return;
  if (typeof v !== 'string' || !COUNTRY_RE.test(v)) e.push(`${p}: ISO 3166-1 alpha-2 country code expected`);
};

function validateAddress(e: Errs, p: string, a: unknown) {
  if (!isObj(a)) return void e.push(`${p}: object expected`);
  onlyKeys(e, p, a, ['addressType', 'streetName', 'buildingNumber', 'postCode', 'townName', 'addressLine', 'country']);
  if (!ADDRESS_TYPES.includes(a.addressType as string)) e.push(`${p}.addressType: one of ${ADDRESS_TYPES.join(', ')}`);
  text(e, `${p}.streetName`, a.streetName, 70, false);
  text(e, `${p}.buildingNumber`, a.buildingNumber, 16, false);
  text(e, `${p}.postCode`, a.postCode, 16, false);
  text(e, `${p}.townName`, a.townName, 35, false);
  if (a.addressLine !== undefined) {
    if (!Array.isArray(a.addressLine) || a.addressLine.length < 1 || a.addressLine.length > 7) e.push(`${p}.addressLine: 1 to 7 lines`);
    else a.addressLine.forEach((l, i) => text(e, `${p}.addressLine[${i}]`, l, 70));
  }
  country(e, `${p}.country`, a.country);
  // IVMS101 constraint ValidAddress: either address lines, or (street name or building name) + town name.
  const structured = typeof a.streetName === 'string' && typeof a.townName === 'string';
  if (!structured && a.addressLine === undefined) e.push(`${p}: give addressLine, or streetName + townName`);
}

function validateNationalId(e: Errs, p: string, n: unknown, legal: boolean) {
  if (!isObj(n)) return void e.push(`${p}: object expected`);
  onlyKeys(e, p, n, ['nationalIdentifier', 'nationalIdentifierType', 'countryOfIssue']);
  text(e, `${p}.nationalIdentifier`, n.nationalIdentifier, 35);
  if (!NATIONAL_ID_TYPES.includes(n.nationalIdentifierType as string)) e.push(`${p}.nationalIdentifierType: invalid code`);
  if (legal && !['RAID', 'MISC', 'LEIX', 'TXID'].includes(n.nationalIdentifierType as string)) e.push(`${p}.nationalIdentifierType: a legal person uses RAID, MISC, LEIX or TXID`);
  if (n.nationalIdentifierType === 'LEIX' && !isValidLei(String(n.nationalIdentifier))) e.push(`${p}.nationalIdentifier: not a valid LEI (ISO 17442 check digits)`);
  country(e, `${p}.countryOfIssue`, n.countryOfIssue, false);
}

function validateNatural(e: Errs, p: string, np: unknown, role: 'originator' | 'beneficiary') {
  if (!isObj(np)) return void e.push(`${p}: object expected`);
  onlyKeys(e, p, np, ['name', 'geographicAddress', 'nationalIdentification', 'customerIdentification', 'dateAndPlaceOfBirth', 'countryOfResidence']);
  const ids = isObj(np.name) ? (np.name as any).nameIdentifier : undefined;
  if (!Array.isArray(ids) || !ids.length) e.push(`${p}.name.nameIdentifier: at least one name`);
  else {
    if (isObj(np.name)) onlyKeys(e, `${p}.name`, np.name, ['nameIdentifier']);
    ids.forEach((n: unknown, i: number) => {
      const q = `${p}.name.nameIdentifier[${i}]`;
      if (!isObj(n)) return void e.push(`${q}: object expected`);
      onlyKeys(e, q, n, ['primaryIdentifier', 'secondaryIdentifier', 'nameIdentifierType']);
      text(e, `${q}.primaryIdentifier`, n.primaryIdentifier, MAX_TEXT);
      text(e, `${q}.secondaryIdentifier`, n.secondaryIdentifier, MAX_TEXT, false);
      if (!NP_NAME_TYPES.includes(n.nameIdentifierType as string)) e.push(`${q}.nameIdentifierType: one of ${NP_NAME_TYPES.join(', ')}`);
    });
    // IVMS101 constraint ValidNaturalPersonNameIdentifierType: at least one legal name (LEGL).
    if (!ids.some((n: any) => n?.nameIdentifierType === 'LEGL')) e.push(`${p}.name: a legal name (nameIdentifierType LEGL) is required`);
  }
  if (np.geographicAddress !== undefined) {
    if (!Array.isArray(np.geographicAddress) || !np.geographicAddress.length) e.push(`${p}.geographicAddress: non-empty array expected`);
    else np.geographicAddress.forEach((a, i) => validateAddress(e, `${p}.geographicAddress[${i}]`, a));
  }
  if (np.nationalIdentification !== undefined) validateNationalId(e, `${p}.nationalIdentification`, np.nationalIdentification, false);
  text(e, `${p}.customerIdentification`, np.customerIdentification, 50, false);
  if (np.dateAndPlaceOfBirth !== undefined) {
    const d = np.dateAndPlaceOfBirth;
    if (!isObj(d)) e.push(`${p}.dateAndPlaceOfBirth: object expected`);
    else {
      onlyKeys(e, `${p}.dateAndPlaceOfBirth`, d, ['dateOfBirth', 'placeOfBirth']);
      const dob = String(d.dateOfBirth ?? '');
      const t = Date.parse(`${dob}T00:00:00Z`);
      // IVMS101 constraint ValidDateOfBirth: a date in the past.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== dob || t >= Date.now()) e.push(`${p}.dateAndPlaceOfBirth.dateOfBirth: a past date YYYY-MM-DD`);
      text(e, `${p}.dateAndPlaceOfBirth.placeOfBirth`, d.placeOfBirth, 70);
    }
  }
  country(e, `${p}.countryOfResidence`, np.countryOfResidence, false);
  // IVMS101 constraint ValidNaturalPersonOriginator: the originator carries an address, a customer id, a national id
  // or a date and place of birth (in addition to the name).
  if (role === 'originator' && np.geographicAddress === undefined && np.customerIdentification === undefined && np.nationalIdentification === undefined && np.dateAndPlaceOfBirth === undefined)
    e.push(`${p}: the originator needs an address, a customer identification, a national identification or a date and place of birth`);
}

function validateLegal(e: Errs, p: string, lp: unknown, role: 'originator' | 'beneficiary' | 'vasp') {
  if (!isObj(lp)) return void e.push(`${p}: object expected`);
  onlyKeys(e, p, lp, ['name', 'geographicAddress', 'customerNumber', 'nationalIdentification', 'countryOfRegistration']);
  const ids = isObj(lp.name) ? (lp.name as any).nameIdentifier : undefined;
  if (!Array.isArray(ids) || !ids.length) e.push(`${p}.name.nameIdentifier: at least one name`);
  else {
    if (isObj(lp.name)) onlyKeys(e, `${p}.name`, lp.name, ['nameIdentifier']);
    ids.forEach((n: unknown, i: number) => {
      const q = `${p}.name.nameIdentifier[${i}]`;
      if (!isObj(n)) return void e.push(`${q}: object expected`);
      onlyKeys(e, q, n, ['legalPersonName', 'legalPersonNameIdentifierType']);
      text(e, `${q}.legalPersonName`, n.legalPersonName, MAX_TEXT);
      if (!LP_NAME_TYPES.includes(n.legalPersonNameIdentifierType as string)) e.push(`${q}.legalPersonNameIdentifierType: one of ${LP_NAME_TYPES.join(', ')}`);
    });
    if (!ids.some((n: any) => n?.legalPersonNameIdentifierType === 'LEGL')) e.push(`${p}.name: a legal name (LEGL) is required`);
  }
  if (lp.geographicAddress !== undefined) {
    if (!Array.isArray(lp.geographicAddress) || !lp.geographicAddress.length) e.push(`${p}.geographicAddress: non-empty array expected`);
    else lp.geographicAddress.forEach((a, i) => validateAddress(e, `${p}.geographicAddress[${i}]`, a));
  }
  text(e, `${p}.customerNumber`, lp.customerNumber, 50, false);
  if (lp.nationalIdentification !== undefined) validateNationalId(e, `${p}.nationalIdentification`, lp.nationalIdentification, true);
  country(e, `${p}.countryOfRegistration`, lp.countryOfRegistration, role === 'vasp');
  // Our subset: a VASP is identified by its LEI.
  if (role === 'vasp' && (lp.nationalIdentification as any)?.nationalIdentifierType !== 'LEIX') e.push(`${p}.nationalIdentification: a VASP is identified by its LEI (LEIX)`);
}

function validatePersons(e: Errs, p: string, arr: unknown, role: 'originator' | 'beneficiary') {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 4) return void e.push(`${p}: 1 to 4 persons`);
  arr.forEach((x, i) => {
    const q = `${p}[${i}]`;
    if (!isObj(x)) return void e.push(`${q}: object expected`);
    const keys = Object.keys(x);
    if (keys.length !== 1 || !['naturalPerson', 'legalPerson'].includes(keys[0])) return void e.push(`${q}: exactly one of naturalPerson / legalPerson`);
    if ('naturalPerson' in x) validateNatural(e, `${q}.naturalPerson`, x.naturalPerson, role);
    else validateLegal(e, `${q}.legalPerson`, x.legalPerson, role);
  });
}

function validateAccounts(e: Errs, p: string, arr: unknown) {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 4) return void e.push(`${p}: 1 to 4 account numbers`);
  arr.forEach((a, i) => text(e, `${p}[${i}]`, a, 100));
}

/** Validates an IVMS101 message against our subset. Returns the list of errors (empty = valid). */
export function validateIvms101(msg: unknown, opts: { requireBeneficiaryVasp?: boolean } = {}): string[] {
  const e: Errs = [];
  if (!isObj(msg)) return ['message: object expected'];
  onlyKeys(e, 'message', msg, ['originator', 'beneficiary', 'originatingVASP', 'beneficiaryVASP']);
  const o = msg.originator;
  if (!isObj(o)) e.push('originator: required');
  else {
    onlyKeys(e, 'originator', o, ['originatorPersons', 'accountNumber']);
    validatePersons(e, 'originator.originatorPersons', o.originatorPersons, 'originator');
    validateAccounts(e, 'originator.accountNumber', o.accountNumber);
  }
  const b = msg.beneficiary;
  if (!isObj(b)) e.push('beneficiary: required');
  else {
    onlyKeys(e, 'beneficiary', b, ['beneficiaryPersons', 'accountNumber']);
    validatePersons(e, 'beneficiary.beneficiaryPersons', b.beneficiaryPersons, 'beneficiary');
    validateAccounts(e, 'beneficiary.accountNumber', b.accountNumber);
  }
  const ov = msg.originatingVASP;
  if (!isObj(ov) || !isObj(ov.originatingVASP) || !isObj((ov.originatingVASP as any).legalPerson)) e.push('originatingVASP.originatingVASP.legalPerson: required');
  else {
    onlyKeys(e, 'originatingVASP', ov, ['originatingVASP']);
    onlyKeys(e, 'originatingVASP.originatingVASP', ov.originatingVASP as Record<string, unknown>, ['legalPerson']);
    validateLegal(e, 'originatingVASP.originatingVASP.legalPerson', (ov.originatingVASP as any).legalPerson, 'vasp');
  }
  const bv = msg.beneficiaryVASP;
  if (bv === undefined) {
    if (opts.requireBeneficiaryVasp) e.push('beneficiaryVASP: required for a VASP-to-VASP transfer');
  } else if (!isObj(bv) || !isObj(bv.beneficiaryVASP) || !isObj((bv.beneficiaryVASP as any).legalPerson)) e.push('beneficiaryVASP.beneficiaryVASP.legalPerson: required');
  else {
    onlyKeys(e, 'beneficiaryVASP', bv, ['beneficiaryVASP']);
    onlyKeys(e, 'beneficiaryVASP.beneficiaryVASP', bv.beneficiaryVASP as Record<string, unknown>, ['legalPerson']);
    validateLegal(e, 'beneficiaryVASP.beneficiaryVASP.legalPerson', (bv.beneficiaryVASP as any).legalPerson, 'vasp');
  }
  return e;
}

// ───────────────────────────── Builders ─────────────────────────────

const LEGAL_FORM_RE = /\b(AG|SA|GmbH|Sàrl|Sarl|S\.A\.|Ltd\.?|Limited|Inc\.?|LLC|plc|BV|NV|SE|KG|AB|Oy|SpA|S\.p\.A\.|Corp\.?|Foundation|Stiftung)$/i;

/** Natural person "First Middle Last" → primary = last word, secondary = the rest; a company name → legal person. */
export function personFromName(fullName: string, extra: { address?: GeographicAddress; customerIdentification?: string; dateOfBirth?: string; countryOfResidence?: string } = {}): Person {
  const name = fullName.trim().replace(/\s+/g, ' ');
  if (LEGAL_FORM_RE.test(name))
    return { legalPerson: { name: { nameIdentifier: [{ legalPersonName: name, legalPersonNameIdentifierType: 'LEGL' }] }, ...(extra.address ? { geographicAddress: [{ ...extra.address, addressType: 'BIZZ' }] } : {}) } };
  const parts = name.split(' ');
  const primary = parts.length > 1 ? parts[parts.length - 1] : name;
  const secondary = parts.length > 1 ? parts.slice(0, -1).join(' ') : undefined;
  return {
    naturalPerson: {
      name: { nameIdentifier: [{ primaryIdentifier: primary, ...(secondary ? { secondaryIdentifier: secondary } : {}), nameIdentifierType: 'LEGL' }] },
      ...(extra.address ? { geographicAddress: [extra.address] } : {}),
      ...(extra.customerIdentification ? { customerIdentification: extra.customerIdentification } : {}),
      ...(extra.countryOfResidence ? { countryOfResidence: extra.countryOfResidence } : {}),
    },
  };
}

/** Full legal name of an IVMS101 person (for comparisons — never logged). */
export function personName(p: Person): string {
  if ('legalPerson' in p) return p.legalPerson.name.nameIdentifier.find((n) => n.legalPersonNameIdentifierType === 'LEGL')?.legalPersonName ?? '';
  const n = p.naturalPerson.name.nameIdentifier.find((x) => x.nameIdentifierType === 'LEGL');
  return n ? [n.secondaryIdentifier, n.primaryIdentifier].filter(Boolean).join(' ') : '';
}

/** "Avenue de la Gare 10, 1003 Lausanne" → address lines (our KYC registry stores a single line). */
export function addressFromLine(line: string, countryCode: string, type: AddressTypeCode = 'HOME'): GeographicAddress {
  const lines = line.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 7);
  return { addressType: type, addressLine: lines.length ? lines : [line.trim()], country: countryCode };
}

/** Structured beneficiary address from the send form (street + postcode + city + country). */
export function addressFromParts(p: { street?: string; postcode?: string; city?: string; country?: string }): GeographicAddress | undefined {
  if (!p.country || !/^[A-Z]{2}$/.test(p.country)) return undefined;
  if (p.street && p.city) return { addressType: 'HOME', streetName: p.street, ...(p.postcode ? { postCode: p.postcode } : {}), townName: p.city, country: p.country };
  return undefined;
}
