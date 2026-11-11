/* =====================================================================
   IEC Suite — Data Asset Builder: CORE ENGINE (pure functions, no
   I/O — the API handler and the local test suite both run this).

   Operationalizes IEC's model sample specimen package
   (iec-model-sample-specimen-package-2026-11-11.md, data-specialist
   edition) for BOTH tracks:

     medical     — the clinical model: Layer 1 dictionary (§§1.1–1.9),
                   Layer 2 distributions (Tables 2.1–2.6), Layer 3
                   synthetic specimens, Layer 4 extraction method.
     non-medical — the operational model built to the same standard:
                   customer / transaction / location dictionary,
                   six footing distribution tables, synthetic
                   specimens, the same Layer 4 method.

   COUNTS AND STRUCTURE ONLY. This module never sees, stores, or
   emits a patient or customer record. The PHI screen below is a hard
   gate: a document that carries row-level records BLOCKS the run
   and nothing from it is stored (enforced again in the API).

   NO ECONOMICS. There is deliberately no fee, split, price, or
   currency field, variable, or output anywhere in this tool —
   specimen packages are structural verification documents, and
   commercial material is handled elsewhere. Percentages appear
   only as per-100 distribution shares (statistics, not money).

   VALIDATION encodes the 2026-11-11 data audit's lessons in code:
     E1 — one stated denominator per table; shares are COMPUTED by
          the tool from counts, never typed; overlapping families
          are flagged as overlapping and may pass the denominator
          only with the flag on.
     E2 — a subset can never exceed its total (selected-years rows
          foot INSIDE the whole-asset totals, hard block).
     E3 — grains are structural: case-grain and encounter-grain
          values live in different tables and a mapping that mixes
          them into one table is flagged.
     E4 — payer lives on the case, never on the patient.
   ===================================================================== */

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const isInt = v => typeof v === "number" && Number.isInteger(v);
const asCount = v => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};
const sum = arr => arr.reduce((a, b) => a + b, 0);
export const fmt = n => (typeof n === "number" && Number.isFinite(n)) ? n.toLocaleString("en-US") : "—";
const share100 = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

/* ================================================================== */
/* TRACK TEMPLATES                                                     */
/* ================================================================== */

/* Distribution table definition:
   kind "partition" — rows must sum EXACTLY to the denominator total.
   kind "subset"    — rows foot INSIDE the denominator (sum ≤ total).
   kind "overlap"   — denominator stated; shares computed per 100 of
                      it; row counts may pass the denominator ONLY
                      when counts.tables[id].overlap === true.
   measure: [{ key, label, total }] — the counted columns and the
                      asset total each column foots against.
   fixedRows: rows the table always has (bands / enum rows).        */

const BANDS_VISITS = ["1 visit only", "2–5 visits", "6–12 visits", "13–24 visits", "25 or more visits"];
const BANDS_DEPTH = ["Under 6 months", "6 months to under 2 years", "2 years to under 5 years", "5 years or more"];
const BANDS_TXN = ["1 transaction only", "2–5 transactions", "6–12 transactions", "13–24 transactions", "25 or more transactions"];

export const TRACKS = {
  medical: {
    label: "Medical",
    subject: "patients",
    variables: [
      { key: "specialtyMix", label: "Specialty / sector mix", type: "text", placeholder: "Pain management; physical therapy" },
      { key: "languages", label: "Documentation languages", type: "text", placeholder: "EN, ES (native)" },
      { key: "caseTypeMixNote", label: "Case-type mix (note)", type: "text", placeholder: "Workers' comp heavy; some personal injury" },
      { key: "historyDepthYears", label: "History depth (years of records)", type: "int", placeholder: "25" },
      { key: "workforceFTE", label: "Workforce scale (full-time employees)", type: "int", placeholder: "40" },
      { key: "locationsCount", label: "Locations (count)", type: "int", placeholder: "1" }
    ],
    totals: [
      { key: "totalPatients", label: "Distinct patients (whole asset, all years)" },
      { key: "totalEncounters", label: "Encounters (whole asset)" },
      { key: "totalNotes", label: "Notes (whole asset)" },
      { key: "totalCases", label: "Distinct cases (whole asset)" }
    ],
    tables: [
      { id: "recordsByYear", num: "2.1", title: "Records by year (selected years)", kind: "subset", grain: "encounter",
        denominatorNote: "Rows are selected years; columns foot INSIDE the whole-asset totals.",
        measure: [
          { key: "encounters", label: "Encounters", total: "totalEncounters" },
          /* NOT additive across years: a patient seen in two years is
             counted in both, so this column's sum may pass the total —
             each year's value still may not. (Model §2.1.) */
          { key: "patients", label: "Distinct patients", total: "totalPatients", nonAdditive: true },
          { key: "notes", label: "Notes", total: "totalNotes" }
        ] },
      { id: "patientsByDiagnosisFamily", num: "2.2", title: "Patients by diagnosis family", kind: "overlap", grain: "patient",
        denominator: "totalPatients", denominatorLabel: "distinct patients (whole asset)",
        detailLabel: "ICD-10-CM range",
        measure: [{ key: "patients", label: "Distinct patients", total: "totalPatients" }] },
      { id: "caseTypeMix", num: "2.3", title: "Case-type mix", kind: "partition", grain: "case",
        denominator: "totalEncounters", denominatorLabel: "encounters (whole asset)",
        fixedRows: ["Workers' compensation", "Personal injury", "Commercial", "Other"],
        measure: [
          { key: "cases", label: "Distinct cases", total: "totalCases" },
          { key: "encounters", label: "Encounters", total: "totalEncounters" }
        ] },
      { id: "noteLanguageShare", num: "2.4", title: "Note-language share", kind: "partition", grain: "encounter",
        denominator: "totalNotes", denominatorLabel: "notes (whole asset)",
        fixedRows: ["English (EN)", "Spanish (ES)", "Other languages"],
        measure: [{ key: "notes", label: "Notes", total: "totalNotes" }] },
      { id: "visitsPerCaseBands", num: "2.5", title: "Visits per case — bands", kind: "partition", grain: "case",
        denominator: "totalCases", denominatorLabel: "distinct cases (whole asset)",
        fixedRows: BANDS_VISITS,
        measure: [{ key: "cases", label: "Cases", total: "totalCases" }] },
      { id: "historyDepth", num: "2.6", title: "History-depth profile", kind: "partition", grain: "patient",
        denominator: "totalPatients", denominatorLabel: "distinct patients (whole asset)",
        fixedRows: BANDS_DEPTH,
        measure: [{ key: "patients", label: "Patients", total: "totalPatients" }] }
    ]
  },

  "non-medical": {
    label: "Non-medical",
    subject: "customers",
    variables: [
      { key: "specialtyMix", label: "Sector mix", type: "text", placeholder: "Gas / convenience; home services" },
      { key: "languages", label: "Customer-facing languages", type: "text", placeholder: "EN, ES" },
      { key: "caseTypeMixNote", label: "Transaction-type mix (note)", type: "text", placeholder: "Fuel + in-store retail; repeat service contracts" },
      { key: "historyDepthYears", label: "History depth (years of records)", type: "int", placeholder: "12" },
      { key: "workforceFTE", label: "Workforce scale (full-time employees)", type: "int", placeholder: "66" },
      { key: "locationsCount", label: "Locations (count)", type: "int", placeholder: "10" }
    ],
    totals: [
      { key: "totalCustomers", label: "Distinct customers (whole asset, all years)" },
      { key: "totalTransactions", label: "Transactions (whole asset)" },
      { key: "totalRecords", label: "Records / documents (whole asset)" },
      { key: "totalLocations", label: "Locations (whole asset)" }
    ],
    tables: [
      { id: "recordsByYear", num: "2.1", title: "Records by year (selected years)", kind: "subset", grain: "transaction",
        denominatorNote: "Rows are selected years; columns foot INSIDE the whole-asset totals.",
        measure: [
          { key: "transactions", label: "Transactions", total: "totalTransactions" },
          /* NOT additive across years, as on the medical track. */
          { key: "customers", label: "Distinct customers", total: "totalCustomers", nonAdditive: true },
          { key: "records", label: "Records / documents", total: "totalRecords" }
        ] },
      { id: "customersBySegment", num: "2.2", title: "Customers by segment", kind: "overlap", grain: "customer",
        denominator: "totalCustomers", denominatorLabel: "distinct customers (whole asset)",
        detailLabel: "Segment definition",
        measure: [{ key: "customers", label: "Distinct customers", total: "totalCustomers" }] },
      { id: "transactionTypeMix", num: "2.3", title: "Transaction-type mix", kind: "partition", grain: "transaction",
        denominator: "totalTransactions", denominatorLabel: "transactions (whole asset)",
        fixedRows: ["Sale", "Service visit", "Booking", "Invoice", "Other"],
        measure: [{ key: "transactions", label: "Transactions", total: "totalTransactions" }] },
      { id: "recordsBySourceSystem", num: "2.4", title: "Records by source system", kind: "partition", grain: "record",
        denominator: "totalRecords", denominatorLabel: "records / documents (whole asset)",
        measure: [{ key: "records", label: "Records", total: "totalRecords" }],
        rowsFromSystems: true },
      { id: "transactionsPerCustomerBands", num: "2.5", title: "Transactions per customer — bands", kind: "partition", grain: "customer",
        denominator: "totalCustomers", denominatorLabel: "distinct customers (whole asset)",
        fixedRows: BANDS_TXN,
        measure: [{ key: "customers", label: "Customers", total: "totalCustomers" }] },
      { id: "historyDepth", num: "2.6", title: "History-depth profile", kind: "partition", grain: "customer",
        denominator: "totalCustomers", denominatorLabel: "distinct customers (whole asset)",
        fixedRows: BANDS_DEPTH,
        measure: [{ key: "customers", label: "Customers", total: "totalCustomers" }] }
    ]
  }
};

export function trackDef(track) {
  return TRACKS[track] || null;
}
export function tableDef(track, tableId) {
  const t = trackDef(track);
  return t ? t.tables.find(x => x.id === tableId) || null : null;
}

/* ------------------------------------------------------------------ */
/* The model dictionary, per track. Fields carry type / required /   */
/* grain exactly as the model package states them; instantiation     */
/* substitutes the asset's systems into the [bracketed] slots.       */
/* ------------------------------------------------------------------ */

const F = (name, type, required, example, notes) => ({ name, type, required, example, notes });

export const DICTIONARIES = {
  medical: [
    { id: "patient", num: "1.1", title: "Patient dimension — one row per person", grain: "patient", fields: [
      F("patient_key", "string", "Required", "PT-000000", "Pseudonymous linkage key: a random token, or a keyed hash (HMAC) with a secret held inside the practice's environment. The mapping to identity is generated and retained only inside the practice; a licensed extract contains no mapping, and the keys cannot be reversed from the extract alone."),
      F("sex", "enum: F / M / unknown", "Required", "F", "As recorded in the source system; unknown where the source records no value."),
      F("zip3", "string (3 digits)", "Nullable", "NNN (format only)", "First three digits of postal code, retained under the expert-certification analysis. Nullable where the source holds no postal code."),
      F("primary_language", "enum: EN / ES / other / unknown", "Required", "EN", "Patient's primary language as recorded at intake.")
    ]},
    { id: "encounter", num: "1.2", title: "Encounter dimension — one row per visit", grain: "encounter", fields: [
      F("encounter_key", "string", "Required", "EN-000000", "Pseudonymous key for one visit; the atomic unit of the extract."),
      F("patient_key", "string", "Required", "PT-000000", "Foreign key to the patient dimension. Many encounters per patient."),
      F("case_key", "string", "Required", "CS-000000", "Foreign key to the case dimension. Every encounter belongs to exactly one case."),
      F("encounter_period", "string (YYYY-MM)", "Required", "2021-03", "Year and month of the encounter, after the per-patient date shift. Exact dates are never carried; month grain is retained under the expert-certification analysis."),
      F("age_band_at_encounter", "enum (ten-year bands)", "Required", "45–54", "Age band at this encounter, computed before de-identification; neither underlying date is carried."),
      F("setting", "enum: office / procedure_suite / telehealth / other", "Required", "office", "Where the encounter occurred."),
      F("provider_role", "enum: physician / physician_assistant / physical_therapist / other", "Required", "physician", "Role of the documenting clinician. Clinician names are never carried."),
      F("visit_number_in_case", "integer (≥ 1)", "Required", "7", "Sequence position of this visit within its case, across all encounter types — PT encounters increment this counter exactly as office visits do."),
      F("source_system", "string", "Required", "[EHR name]", "The system of record this encounter was extracted from; the authoritative provenance field, and the one reconciliation foots against.")
    ]},
    { id: "clinical", num: "1.3", title: "Clinical content — carried on the encounter", grain: "encounter", fields: [
      F("diagnosis_codes", "list of {code, code_system, code_version}", "Required (≥ 1 on every clinical encounter)", "M54.16 (ICD-10-CM)", "Diagnosis codes as documented at the encounter, primary first. Codes are never bare strings."),
      F("procedure_codes", "list of {code, code_system, code_version}", "Nullable", "99213 (CPT), 62323 (CPT)", "Procedure codes as documented; empty where the encounter carried no billable procedure."),
      F("note_type", "enum: initial_evaluation / follow_up / procedure_note / pt_note / impairment_rating / other", "Required", "follow_up", "The documentation genre of the encounter."),
      F("note_language", "enum: EN / ES / other", "Required", "ES", "Language the note was natively written in — not translated after the fact."),
      F("note_text", "text", "Nullable", "(Layer 3 specimens)", "De-identified note body, delivered where the license scope includes note text. In specimen packages, note text appears only inside synthetic specimens."),
      F("note_origin_system", "string", "Nullable", "[EHR name]", "System in which the note was originally authored, populated only where it is known to differ from source_system.")
    ]},
    { id: "case", num: "1.4", title: "Case dimension — one row per case", grain: "case", fields: [
      F("case_key", "string", "Required", "CS-000000", "Pseudonymous key for the case; same keying mechanism as patient_key."),
      F("patient_key", "string", "Required", "PT-000000", "Foreign key to the patient dimension. Many cases per patient."),
      F("case_type", "enum: workers_comp / personal_injury / commercial / other", "Required", "workers_comp", "The case construct: a workers' comp case is the accepted claim for one injury event; a personal-injury case arises from one incident; a commercial case is one problem-oriented episode of care, closing after twelve consecutive months without an encounter for that problem."),
      F("payer_class", "enum: workers_comp_carrier / personal_injury_lien / commercial_insurer / medicare / medicaid / self_pay / other", "Required", "workers_comp_carrier", "Funding source of the case. Payer is a property of the case, never of the patient. Carrier names are never carried."),
      F("case_open_period", "string (YYYY-MM)", "Required", "2021-03", "Period of the first encounter in the case, after the date shift."),
      F("case_close_period", "string (YYYY-MM)", "Nullable", "2022-02", "Period of the last encounter in the case. Null while the case is open."),
      F("case_status", "enum: open / closed_at_rating / closed_other", "Required", "open", "Status of the case at extract time.")
    ]},
    { id: "wc-case", num: "1.5", title: "Workers' compensation case extension — case grain", grain: "case", fields: [
      F("case_key", "string", "Required", "CS-000000", "Foreign key to the case dimension. One extension row per compensation case."),
      F("injury_period", "string (YYYY-MM)", "Required", "2021-03", "Period of the injury — or, for cumulative trauma, of the onset — after the per-patient date shift, read together with injury_date_basis."),
      F("injury_date_basis", "enum: injury_date / onset / first_treatment", "Required", "injury_date", "What injury_period records, so the field is never misread as a discrete injury date when the basis is onset."),
      F("body_part_code", "enum (controlled region list)", "Required", "lumbar_spine", "Anatomical region of the accepted injury, mapped at transformation from source wording to the controlled list."),
      F("body_part_side", "enum: left / right / bilateral / not_applicable", "Required", "right", "Laterality of the accepted injury, where the region has one."),
      F("body_part_text", "string", "Nullable", "lumbar spine", "The anatomical region in the source's own wording, retained verbatim beside the controlled code."),
      F("nature_of_injury", "string", "Nullable", "sprain / strain with radiculopathy", "Documented nature of the injury, retained verbatim by design; aggregation over injuries is carried by diagnosis_codes.")
    ]},
    { id: "wc-encounter", num: "1.6", title: "Workers' compensation encounter observations — encounter grain", grain: "encounter", fields: [
      F("work_status", "enum: full_duty / light_duty / out_of_work", "Nullable", "light_duty", "Work status recorded at the encounter; always populated at initial_evaluation and impairment_rating encounters."),
      F("mmi_flag", "boolean", "Required (on compensation-case encounters)", "false", "Whether maximum medical improvement had been declared as of this encounter."),
      F("impairment_rating_wpi", "integer", "Nullable", "7", "Whole-person impairment rating under the applicable schedule. Populated only on the impairment_rating encounter; null on every other encounter.")
    ]},
    { id: "pt", num: "1.8", title: "Physical therapy submodule — one row per PT session", grain: "encounter", fields: [
      F("encounter_key", "string", "Required", "EN-000000", "Foreign key to the PT encounter. A PT session is an encounter like any other and increments visit_number_in_case."),
      F("modality_codes", "list of {code, code_system, code_version}", "Required (≥ 1 entry)", "97110 (CPT), 97140 (CPT)", "Codes for therapeutic exercise, manual therapy, and other modalities as documented at the session."),
      F("pt_visit_number", "integer (≥ 1)", "Required", "5", "Sequence position of the session within the PT plan of care — a separate counter, never a substitute for visit_number_in_case."),
      F("functional_measures", "list of {measure_name, value, unit}", "Nullable", "{lumbar_flexion, 40, degrees}", "Functional findings parsed at transformation into name, value, and unit so they can be aggregated."),
      F("functional_measure_text", "string", "Nullable", "lumbar flexion 40 degrees", "The functional finding in the clinician's recorded form, retained verbatim beside the parsed measures."),
      F("plan_status", "enum: active / completed / discharged", "Required", "active", "Status of the plan of care after the session.")
    ]}
  ],

  "non-medical": [
    { id: "customer", num: "1.1", title: "Customer dimension — one row per customer", grain: "customer", fields: [
      F("customer_key", "string", "Required", "CU-000000", "Pseudonymous linkage key: a random token, or a keyed hash (HMAC) with a secret held inside the business's environment. The mapping to identity is generated and retained only inside the business; a licensed extract contains no mapping, and the keys cannot be reversed from the extract alone."),
      F("customer_type", "enum: individual / household / business / other / unknown", "Required", "individual", "As recorded in the source system."),
      F("region_code", "string (area prefix)", "Nullable", "NNN (format only)", "Coarse geography only — the first three characters of the postal code or equivalent area prefix. Full addresses are never carried."),
      F("primary_language", "enum: EN / ES / other / unknown", "Required", "EN", "Customer's primary language as recorded at intake, where the source records it."),
      F("first_period", "string (YYYY-MM)", "Required", "2019-05", "Period of the customer's first recorded transaction, after the per-customer date shift.")
    ]},
    { id: "transaction", num: "1.2", title: "Transaction dimension — one row per transaction", grain: "transaction", fields: [
      F("transaction_key", "string", "Required", "TX-000000", "Pseudonymous key for one transaction; the atomic unit of the extract."),
      F("customer_key", "string", "Required", "CU-000000", "Foreign key to the customer dimension. Many transactions per customer. Nullable only for anonymous cash transactions where the source carries no customer link — recorded as the reserved key CU-ANON."),
      F("location_key", "string", "Required", "LC-000000", "Foreign key to the location dimension."),
      F("period", "string (YYYY-MM)", "Required", "2023-08", "Year and month of the transaction, after the per-customer date shift. Exact timestamps are never carried."),
      F("channel", "enum: in_store / online / phone / field / other", "Required", "in_store", "Where the transaction happened."),
      F("sequence_in_relationship", "integer (≥ 1)", "Required", "12", "Sequence position of this transaction in the customer's history — the field that makes repeat behaviour readable."),
      F("source_system", "string", "Required", "[POS name]", "The system of record this transaction was extracted from; the authoritative provenance field, and the one reconciliation foots against.")
    ]},
    { id: "content", num: "1.3", title: "Transaction content — carried on the transaction", grain: "transaction", fields: [
      F("record_type", "enum: sale / service_visit / booking / invoice / other", "Required", "sale", "The kind of record this transaction is."),
      F("category_codes", "list of {code, code_system, code_version}", "Required (≥ 1 entry)", "FUEL-REG (internal taxonomy)", "Product or service categories, carried as structured codes against the business's category taxonomy — never bare strings."),
      F("service_type", "enum (sector list, set at instantiation)", "Nullable", "recurring_service", "For service transactions: the service performed, from the sector's controlled list set in the per-system mapping table."),
      F("payment_method_class", "enum: card / cash / account / wallet / other", "Required", "card", "How the transaction was settled, at class level. Account and card numbers are never carried."),
      F("verification_method", "enum: gps / app_checkin / phone_ivr / signature / none / other", "Nullable", "gps", "For service visits: how the visit's occurrence was verified (EVV-style), where the source records it.")
    ]},
    { id: "location", num: "1.4", title: "Location dimension — one row per location", grain: "location", fields: [
      F("location_key", "string", "Required", "LC-000000", "Pseudonymous key for the location."),
      F("location_type", "enum: retail / fuel_site / restaurant / service_base / office / other", "Required", "fuel_site", "The kind of location."),
      F("region_code", "string (area prefix)", "Nullable", "NNN (format only)", "Coarse geography only, as on the customer dimension."),
      F("open_period", "string (YYYY-MM)", "Nullable", "2015-03", "Period the location entered the business's records.")
    ]},
    { id: "referral", num: "1.5", title: "Referral & relationship — customer grain", grain: "customer", fields: [
      F("referral_source", "enum: walk_in / referral_partner / online / advertising / repeat / other / unknown", "Nullable", "referral_partner", "How the customer relationship began, where the source records it. Partner names are never carried."),
      F("relationship_status", "enum: active / lapsed / closed", "Required", "active", "Status of the relationship at extract time."),
      F("repeat_flag", "boolean", "Required", "true", "Whether the customer carries more than one transaction in the extract window.")
    ]}
  ]
};

/* Per-practice variable rows for the instantiated §1.9 table. */
export function variableRows(track, variables, systems) {
  const v = variables || {};
  const sysNames = (systems || []).map(s => s.name).join(", ") || "[systems of record]";
  if (track === "medical") {
    return [
      ["Specialty mix", v.specialtyMix || "[set at instantiation]", "Diagnosis families in Layer 2 are drawn from the practice's actual specialty range."],
      ["Source systems", sysNames, "The bracketed system slots in the dictionary are replaced by these systems of record, each named in source_system."],
      ["Documentation languages", v.languages || "[set at instantiation]", "note_language values reflect the languages clinicians natively document in."],
      ["Case-type mix", v.caseTypeMixNote || "[from the counts below]", "The relative weight of workers_comp, personal_injury, commercial, and other case types."],
      ["History depth", v.historyDepthYears ? `${v.historyDepthYears} years` : "[set at instantiation]", "Earliest encounter_period available, by source system."],
      ["Employee / workforce scale", v.workforceFTE ? `${fmt(v.workforceFTE)} full-time employees` : "[set at instantiation]", "Number of documenting clinicians and staff whose records the asset contains."],
      ["Software count", String((systems || []).length || 0), "Distinct software systems the asset's records live in — the count of systems selected for this asset."]
    ];
  }
  return [
    ["Sector mix", v.specialtyMix || "[set at instantiation]", "Customer segments in Layer 2 are drawn from the business's actual sectors."],
    ["Source systems", sysNames, "The bracketed system slots in the dictionary are replaced by these systems of record, each named in source_system."],
    ["Customer-facing languages", v.languages || "[set at instantiation]", "primary_language values reflect the languages the business serves customers in."],
    ["Transaction-type mix", v.caseTypeMixNote || "[from the counts below]", "The relative weight of sale, service_visit, booking, invoice, and other record types."],
    ["History depth", v.historyDepthYears ? `${v.historyDepthYears} years` : "[set at instantiation]", "Earliest period available, by source system."],
    ["Employee / workforce scale", v.workforceFTE ? `${fmt(v.workforceFTE)} full-time employees` : "[set at instantiation]", "Staff whose work the asset's records document."],
    ["Software count", String((systems || []).length || 0), "Distinct software systems the asset's records live in — the count of systems selected for this asset."]
  ];
}
/* ================================================================== */
/* VALIDATION — the audit's arithmetic lessons, enforced.              */
/*                                                                     */
/* validateAsset(track, variables, counts, systems) returns:           */
/*   { errors:   [{check, table, message}],   — hard blocks            */
/*     warnings: [{check, table, message}],   — proceed, but shown     */
/*     computed: { <tableId>: { rows: [{label, detail, values,         */
/*                    shares}], denominator } } }  — shares COMPUTED    */
/* Shares are never accepted as input (audit E1). Counts are the       */
/* only numbers an operator or a document can supply.                  */
/* ================================================================== */

export function emptyCounts(track) {
  const t = trackDef(track);
  const totals = {};
  for (const tot of t.totals) totals[tot.key] = null;
  const tables = {};
  for (const td of t.tables) {
    tables[td.id] = {
      overlap: false,
      rows: (td.fixedRows || []).map(label => {
        const row = { label };
        for (const m of td.measure) row[m.key] = null;
        return row;
      })
    };
  }
  return { totals, tables };
}

function countVal(raw, where, errors) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = asCount(raw);
  if (!Number.isFinite(n)) {
    errors.push({ check: "not-a-number", message: `${where}: "${raw}" is not a number — counts must be whole numbers.` });
    return null;
  }
  if (!Number.isInteger(n)) {
    errors.push({ check: "not-integer", message: `${where}: ${n} is not a whole number — counts are integers.` });
    return null;
  }
  if (n < 0) {
    errors.push({ check: "negative", message: `${where}: ${n} is negative — counts cannot be negative.` });
    return null;
  }
  return n;
}

export function validateAsset(track, variables, counts, systems) {
  const t = trackDef(track);
  const errors = [];
  const warnings = [];
  const computed = {};
  if (!t) return { errors: [{ check: "track", message: `Unknown track "${track}".` }], warnings, computed };
  const v = variables || {};
  const c = counts || { totals: {}, tables: {} };
  const totalsIn = c.totals || {};
  const totals = {};

  /* --- totals: required, whole, non-negative --- */
  for (const tot of t.totals) {
    const n = countVal(totalsIn[tot.key], tot.label, errors);
    if (n === null && !errors.some(e => e.message.startsWith(tot.label))) {
      errors.push({ check: "total-missing", message: `${tot.label}: no count entered — every distribution table foots against the asset totals, so the totals come first.` });
    }
    totals[tot.key] = n;
  }

  /* --- variables --- */
  for (const varDef of t.variables) {
    if (varDef.type === "int") {
      const raw = v[varDef.key];
      if (raw !== null && raw !== undefined && raw !== "") {
        const n = asCount(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          errors.push({ check: "variable", message: `${varDef.label}: must be a whole number, 0 or more.` });
        } else if (varDef.key === "historyDepthYears" && n > 100) {
          errors.push({ check: "variable", message: `${varDef.label}: ${n} years is not plausible — check the figure.` });
        }
      }
    }
  }
  if (!Array.isArray(systems) || systems.length === 0) {
    warnings.push({ check: "no-systems", message: "No software systems are selected for this asset — the extraction plan will be generic. Add the systems of record so the plan and the software count are real." });
  }

  const systemNames = new Set((systems || []).map(s => String(s.name || "").trim().toLowerCase()));

  /* --- tables --- */
  for (const td of t.tables) {
    const tc = (c.tables && c.tables[td.id]) || { rows: [] };
    const rowsIn = Array.isArray(tc.rows) ? tc.rows : [];
    const rows = [];
    const seenLabels = new Set();

    rowsIn.forEach((r, i) => {
      const label = String((r && r.label) ?? "").trim();
      const where = `${td.title} row ${i + 1}${label ? ` ("${label}")` : ""}`;
      if (!label) {
        errors.push({ check: "row-label", table: td.id, message: `${td.title} row ${i + 1}: the row has no label.` });
        return;
      }
      if (seenLabels.has(label.toLowerCase())) {
        errors.push({ check: "row-duplicate", table: td.id, message: `${td.title}: the row "${label}" appears twice — merge its counts into one row.` });
        return;
      }
      seenLabels.add(label.toLowerCase());
      const row = { label, detail: String((r && r.detail) ?? "").trim() };
      for (const m of td.measure) row[m.key] = countVal(r ? r[m.key] : null, `${where} — ${m.label}`, errors);
      rows.push(row);
    });

    /* fixed-row tables must carry exactly the fixed set (no gaps,
       no overlaps — audit W13/S3: bands are structural). */
    if (td.fixedRows) {
      const want = td.fixedRows.map(x => x.toLowerCase());
      const got = rows.map(r => r.label.toLowerCase());
      const missing = td.fixedRows.filter(x => !got.includes(x.toLowerCase()));
      const extra = rows.filter(r => !want.includes(r.label.toLowerCase()));
      if (missing.length) {
        errors.push({ check: "fixed-rows", table: td.id, message: `${td.title}: missing row(s) ${missing.map(x => `"${x}"`).join(", ")} — this table's rows are fixed so the bands can never gap or overlap.` });
      }
      if (extra.length) {
        errors.push({ check: "fixed-rows", table: td.id, message: `${td.title}: unexpected row(s) ${extra.map(r => `"${r.label}"`).join(", ")} — this table's rows are fixed.` });
      }
    }

    /* every measured column foots against its total */
    const comp = { rows: [], denominator: null };
    for (const m of td.measure) {
      const total = totals[m.total];
      const colSum = sum(rows.map(r => r[m.key] || 0));
      if (td.kind === "partition") {
        if (total !== null && rows.length && colSum !== total) {
          errors.push({ check: "footing", table: td.id, message: `${td.title}: the ${m.label} column sums to ${fmt(colSum)} but the asset total is ${fmt(total)} — variance ${fmt(Math.abs(colSum - total))}. A partition must foot exactly; find the missing or double-counted rows.` });
        }
      } else if (td.kind === "subset") {
        if (!m.nonAdditive && total !== null && colSum > total) {
          errors.push({ check: "subset-exceeds-total", table: td.id, message: `${td.title}: the ${m.label} column sums to ${fmt(colSum)}, which EXCEEDS the whole-asset total of ${fmt(total)} by ${fmt(colSum - total)}. A subset can never be larger than its total — check the document values.` });
        }
        rows.forEach(r => {
          if (total !== null && (r[m.key] || 0) > total) {
            errors.push({ check: "subset-exceeds-total", table: td.id, message: `${td.title}: row "${r.label}" carries ${fmt(r[m.key])} ${m.label}, more than the whole-asset total of ${fmt(total)}.` });
          }
        });
      } else if (td.kind === "overlap") {
        rows.forEach(r => {
          if (total !== null && (r[m.key] || 0) > total) {
            errors.push({ check: "row-exceeds-denominator", table: td.id, message: `${td.title}: row "${r.label}" counts ${fmt(r[m.key])}, more than the stated denominator of ${fmt(total)} — no single category can hold more subjects than the asset has.` });
          }
        });
        if (total !== null && rows.length) {
          if (!tc.overlap && colSum !== total) {
            errors.push({ check: "overlap-off-mismatch", table: td.id, message: `${td.title}: categories are marked NON-overlapping but sum to ${fmt(colSum)} against a denominator of ${fmt(total)} (variance ${fmt(Math.abs(colSum - total))}). Either the counts are wrong, or the categories overlap — turn the overlap flag on and the shares will be computed per 100 of the denominator.` });
          }
          if (tc.overlap && colSum === total) {
            warnings.push({ check: "overlap-sums-exact", table: td.id, message: `${td.title}: overlap is ON but the counts sum EXACTLY to the denominator (${fmt(total)}). Genuinely overlapping categories almost never do that — confirm the categories really overlap, or turn the flag off.` });
          }
          if (tc.overlap && colSum < total) {
            warnings.push({ check: "overlap-sums-under", table: td.id, message: `${td.title}: overlap is ON and the counts sum to ${fmt(colSum)}, below the denominator of ${fmt(total)} — some subjects fall in no category. That is possible, but confirm it is real.` });
          }
        }
      }
    }

    /* selected-years tables: years must be years, and plausible */
    if (td.id === "recordsByYear") {
      const now = new Date().getFullYear();
      const depth = asCount(v.historyDepthYears);
      for (const r of rows) {
        if (!/^\d{4}$/.test(r.label)) {
          errors.push({ check: "year-label", table: td.id, message: `${td.title}: row label "${r.label}" is not a four-digit year.` });
        } else {
          const y = Number(r.label);
          if (y > now) errors.push({ check: "year-label", table: td.id, message: `${td.title}: year ${y} is in the future.` });
          if (Number.isFinite(depth) && depth >= 0 && y < now - depth - 1) {
            warnings.push({ check: "year-depth", table: td.id, message: `${td.title}: year ${y} predates the stated history depth (${depth} years) — either the depth or the year is wrong.` });
          }
        }
      }
    }

    /* records-by-system rows must name systems on the asset */
    if (td.rowsFromSystems && systemNames.size) {
      for (const r of rows) {
        if (!systemNames.has(r.label.toLowerCase())) {
          errors.push({ check: "system-row", table: td.id, message: `${td.title}: row "${r.label}" does not match any system selected for this asset. Rows are the asset's systems of record — add the system to the asset, or correct the row.` });
        }
      }
    }

    /* computed shares — always from counts, never from input */
    const denomKey = td.kind === "partition" || td.kind === "overlap" ? td.denominator : null;
    comp.denominator = denomKey ? totals[denomKey] : null;
    comp.rows = rows.map(r => {
      const shares = {};
      for (const m of td.measure) {
        const d = totals[m.total];
        shares[m.key] = (d && r[m.key] !== null && r[m.key] !== undefined) ? share100(r[m.key], d) : null;
      }
      return { ...r, shares };
    });
    computed[td.id] = comp;
  }

  return { errors, warnings, computed, totals };
}

/* ================================================================== */
/* DOCUMENT PARSING                                                    */
/*                                                                     */
/* Every parser returns { tables: [{name, columns, rows}], kv:         */
/* [{label, value}], warnings: [] }. Parsers extract TABLES,           */
/* HEADERS and COUNT VALUES — never a judgement about the content;     */
/* the PHI screen below makes that call before anything is stored.     */
/* ================================================================== */

import zlib from "node:zlib";
import { ROUTE_LABEL } from "./_data-assets-catalog.js";

/* --- CSV / TSV: one table, first row is the header. --- */
export function parseDelimited(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      if (row.some(c => String(c).trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => String(c).trim() !== "")) rows.push(row);
  if (!rows.length) return { tables: [], kv: [], warnings: ["The file contained no rows."] };
  const columns = rows[0].map(c => String(c).trim());
  return { tables: [{ name: "Table 1", columns, rows: rows.slice(1) }], kv: [], warnings: [] };
}

function detectDelimiter(text) {
  const first = String(text || "").split("\n").find(l => l.trim() !== "") || "";
  const counts = { ",": 0, "\t": 0, ";": 0, "|": 0 };
  let inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/* --- TXT / MD: markdown tables, delimited blocks, label: value. --- */
export function parseTextDocument(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const tables = [];
  const kv = [];
  const warnings = [];
  let heading = "";
  let i = 0;
  const isSep = l => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes("-");
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) { heading = trimmed.replace(/^#{1,6}\s+/, "").trim(); i++; continue; }
    if (trimmed.startsWith("|") && trimmed.includes("|", 1)) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { block.push(lines[i].trim()); i++; }
      const body = block.filter(l => !isSep(l));
      if (body.length >= 2) {
        const splitRow = l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        tables.push({ name: heading || `Table ${tables.length + 1}`, columns: splitRow(body[0]), rows: body.slice(1).map(splitRow) });
      }
      continue;
    }
    if (trimmed && (trimmed.includes(",") || trimmed.includes("\t")) && !trimmed.includes(":")) {
      const block = [];
      while (i < lines.length && lines[i].trim() && (lines[i].includes(",") || lines[i].includes("\t"))) { block.push(lines[i]); i++; }
      if (block.length >= 2) {
        const parsed = parseDelimited(block.join("\n"));
        if (parsed.tables.length) {
          parsed.tables[0].name = heading || `Table ${tables.length + 1}`;
          tables.push(parsed.tables[0]);
        }
        continue;
      }
    }
    const kvMatch = trimmed.match(/^([^:|]{2,80})[:\t]\s*(.+)$/);
    if (kvMatch && !/^https?:/i.test(trimmed)) {
      kv.push({ label: kvMatch[1].trim(), value: kvMatch[2].trim() });
    } else if (trimmed && !trimmed.startsWith("|") && trimmed.length <= 80 && !/\d{3,}/.test(trimmed)) {
      heading = trimmed;
    }
    i++;
  }
  if (!tables.length && !kv.length) warnings.push("No tables or label: value lines were found in the document.");
  return { tables, kv, warnings };
}

/* --- XLSX: minimal reader (ZIP + shared strings + sheet XML). --- */
function zipEntries(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a ZIP/XLSX file (no end-of-directory record)");
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data = null;
    try {
      data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    } catch (e) { data = null; }
    if (data) out.set(name, data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const xmlUnescape = s => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, "&");

export function parseXLSX(buffer) {
  const entries = zipEntries(buffer);
  const warnings = [];
  let shared = [];
  const ssBuf = entries.get("xl/sharedStrings.xml");
  if (ssBuf) {
    const ss = ssBuf.toString("utf8");
    shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
      xmlUnescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")));
  }
  const sheetNames = [...entries.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const tables = [];
  for (const sheetName of sheetNames) {
    const xml = entries.get(sheetName).toString("utf8");
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = new Map();
      for (const c of rowMatch[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
        if (!ref) continue;
        const colIdx = [...ref].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
        const type = (attrs.match(/t="([^"]+)"/) || [])[1];
        const inner = c[2] || "";
        let value = "";
        if (type === "s") {
          const idx = Number((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
          value = shared[idx] ?? "";
        } else if (type === "inlineStr") {
          value = xmlUnescape([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""));
        } else {
          value = xmlUnescape((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? "");
        }
        cells.set(colIdx, value);
      }
      if (!cells.size) continue;
      const width = Math.max(...cells.keys()) + 1;
      rows.push(Array.from({ length: width }, (_, i) => cells.get(i) ?? ""));
    }
    if (rows.length >= 1) {
      tables.push({ name: sheetName.replace("xl/worksheets/", "").replace(".xml", ""), columns: rows[0].map(c => String(c).trim()), rows: rows.slice(1) });
    }
  }
  if (!tables.length) warnings.push("No worksheet tables could be read from the workbook.");
  return { tables, kv: [], warnings };
}

/* --- PDF: best-effort text-layer extraction.
   Reads uncompressed or FlateDecode content streams and pulls the
   text-showing operators (Tj / TJ). This works for the machine-
   generated report PDFs systems export. It does NOT OCR: a scanned
   or image-only PDF yields no text, and the parser says so plainly
   instead of pretending. --- */
export function parsePDF(buffer) {
  const warnings = [];
  const raw = buffer.toString("latin1");
  const chunks = [];
  let pos = 0;
  while (true) {
    const sIdx = raw.indexOf("stream", pos);
    if (sIdx < 0) break;
    let start = sIdx + 6;
    if (raw[start] === "\r") start++;
    if (raw[start] === "\n") start++;
    const eIdx = raw.indexOf("endstream", start);
    if (eIdx < 0) break;
    const bytes = Buffer.from(raw.slice(start, eIdx), "latin1");
    let decoded = null;
    try { decoded = zlib.inflateSync(bytes).toString("latin1"); } catch (e) { /* not flate */ }
    if (decoded === null) {
      try { decoded = zlib.inflateRawSync(bytes).toString("latin1"); } catch (e) { /* raw stream */ }
    }
    if (decoded === null && /BT[\s\S]*?ET/.test(bytes.toString("latin1"))) decoded = bytes.toString("latin1");
    if (decoded) chunks.push(decoded);
    pos = eIdx + 9;
  }
  const literals = [];
  const unesc = s => s.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: "\n", r: "", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" }[c] ?? c))
                     .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  for (const chunk of chunks) {
    for (const m of chunk.matchAll(/\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")|\[(?:[^\[\]]|\((?:\\.|[^\\()])*\))*\]\s*TJ/g)) {
      for (const lit of m[0].matchAll(/\((?:\\.|[^\\()])*\)/g)) {
        literals.push(unesc(lit[0].slice(1, -1)));
      }
    }
  }
  const text = literals.join("\n");
  if (text.trim().length < 40) {
    warnings.push("No extractable text layer was found in this PDF. Scanned or image-only PDFs cannot be assessed — re-export the report as CSV or XLSX from the source system.");
    return { tables: [], kv: [], warnings, textLength: text.trim().length };
  }
  const parsed = parseTextDocument(text);
  return { ...parsed, warnings: [...warnings, ...parsed.warnings], textLength: text.trim().length };
}

/* Dispatch by file name / kind. `base64` is the upload body. */
export function parseDocument(file) {
  const name = String((file && file.name) || "");
  const ext = (name.split(".").pop() || "").toLowerCase();
  const buf = Buffer.from(String((file && file.base64) || ""), "base64");
  if (buf.length === 0) return { tables: [], kv: [], warnings: [`"${name}": the file was empty.`] };
  try {
    if (ext === "csv" || ext === "tsv") return parseDelimited(buf.toString("utf8"), ext === "tsv" ? "\t" : undefined);
    if (ext === "txt" || ext === "md") return parseTextDocument(buf.toString("utf8"));
    if (ext === "xlsx") return parseXLSX(buf);
    if (ext === "pdf") return parsePDF(buf);
    return { tables: [], kv: [], warnings: [`"${name}": unsupported file type ".${ext}" — use CSV, XLSX, PDF, TXT or MD.`] };
  } catch (e) {
    return { tables: [], kv: [], warnings: [`"${name}": could not be parsed (${e && e.message}).`] };
  }
}

/* ================================================================== */
/* PHASE 2 — PHI SCREEN (hard gate).                                   */
/*                                                                     */
/* This tool assesses AGGREGATE COUNTS AND STRUCTURE ONLY. The         */
/* screen scans parsed documents for row-level record data and         */
/* identifier-like columns and values. A BLOCK finding stops the       */
/* run; the API stores NOTHING from a blocked file — not the file,     */
/* not its tables, not a run record.                                   */
/* ================================================================== */

const IDENTIFIER_HEADER = [
  { re: /(^|[\s_])(first|last|full|patient|person|member|client|customer)?[\s_]*name$/, why: "a person-name column" },
  { re: /name$/, why: "a name column" },
  { re: /dob|date[\s_]*of[\s_]*birth|birth[\s_]*date/, why: "a date-of-birth column" },
  { re: /mrn|medical[\s_]*record/, why: "a medical-record-number column" },
  { re: /ssn|social[\s_]*security/, why: "a Social Security column" },
  { re: /address|street|mailing/, why: "an address column" },
  { re: /phone|mobile|cell|fax/, why: "a phone-number column" },
  { re: /e-?mail/, why: "an email column" },
  { re: /(member|subscriber|policy|account|claim|license|certificate)[\s_]*(id|no|num|number)/, why: "an account / member identifier column" },
  { re: /(patient|encounter|visit|record|chart)[\s_]*(id|key|no|num|number)/, why: "a record-identifier column" }
];
const RECORD_ID_HEADER = /^(id|key|no|number|#)$|(^|[\s_])(id|key|no\.?|number)$/;
const SSN_VALUE = /\b\d{3}-\d{2}-\d{4}\b/;
const EMAIL_VALUE = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/;
const PHONE_VALUE = /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const FULL_DATE = /^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*$|^\s*\d{4}-\d{2}-\d{2}/;

function headerHits(columns) {
  const hits = [];
  columns.forEach((col, idx) => {
    const norm = String(col || "").trim().toLowerCase();
    if (!norm) return;
    for (const h of IDENTIFIER_HEADER) {
      if (h.re.test(norm)) { hits.push({ idx, column: col, why: h.why }); break; }
    }
  });
  return hits;
}

export function phiScreen(parsed, fileName) {
  const findings = [];
  const tables = (parsed && parsed.tables) || [];
  let ssnCount = 0, contactCount = 0;

  for (const table of tables) {
    const columns = table.columns || [];
    const rows = table.rows || [];
    const hits = headerHits(columns);

    /* value-pattern scan across every cell */
    let dobDates = 0;
    const dobColIdx = new Set(hits.filter(h => /birth/.test(h.why)).map(h => h.idx));
    rows.forEach(r => {
      (r || []).forEach((cell, ci) => {
        const s = String(cell ?? "");
        if (SSN_VALUE.test(s)) ssnCount++;
        if (EMAIL_VALUE.test(s) || PHONE_VALUE.test(s)) contactCount++;
        if (dobColIdx.has(ci) && FULL_DATE.test(s)) dobDates++;
      });
    });

    if (dobDates > 0) {
      findings.push({ severity: "block", file: fileName, table: table.name,
        message: `Table "${table.name}" carries full dates of birth (${dobDates} value(s) under a birth-date column). Dates of birth are identifiers — this is record-level data.` });
    }

    /* Row-level detection: many rows + identifier columns, or many
       rows keyed by record IDs, means one row per person/record —
       the opposite of an aggregate report. */
    const hasRecordId = columns.some(c => RECORD_ID_HEADER.test(String(c || "").trim().toLowerCase()));
    if (rows.length > 40 && hits.length > 0) {
      findings.push({ severity: "block", file: fileName, table: table.name,
        message: `Table "${table.name}" has ${rows.length} rows and ${hits.map(h => `${h.why} ("${h.column}")`).join(", ")} — that is one row per person/record, not an aggregate report.` });
    } else if (rows.length > 40 && hasRecordId) {
      findings.push({ severity: "block", file: fileName, table: table.name,
        message: `Table "${table.name}" has ${rows.length} rows keyed by a record identifier — that is a record-level export, not an aggregate report.` });
    } else if (hits.length > 0) {
      findings.push({ severity: "warn", file: fileName, table: table.name,
        message: `Table "${table.name}" has ${hits.map(h => `${h.why} ("${h.column}")`).join(", ")} but few rows — it reads as an aggregate table with identifier-shaped headers. The mapping review must not map these columns to anything; if the rows are actually individual records, stop and re-export as an aggregate report.` });
    }
  }

  if (ssnCount > 0) {
    findings.push({ severity: "block", file: fileName, table: null,
      message: `${ssnCount} value(s) in the document match the Social Security number pattern. SSNs are identifiers and have no place in a counts document.` });
  }
  if (contactCount >= 3) {
    findings.push({ severity: "block", file: fileName, table: null,
      message: `${contactCount} values in the document look like email addresses or phone numbers — that reads as a contact list, not an aggregate report.` });
  } else if (contactCount > 0) {
    findings.push({ severity: "warn", file: fileName, table: null,
      message: `${contactCount} value(s) look like an email address or phone number — confirm they are report footers/labels, not record data, before confirming the mapping.` });
  }

  return { blocked: findings.some(f => f.severity === "block"), findings };
}

export const PHI_BLOCK_MESSAGE =
  "This tool assesses aggregate counts and structure only. A document in this run carries row-level record data or identifiers, so the run is blocked and nothing from that file was stored. Re-export from the source system as an aggregate report — counts grouped by year, type, language, or category, with no person-level rows — and upload that instead.";

/* ================================================================== */
/* PHASE 3 — MAPPING                                                   */
/*                                                                     */
/* Candidates are the count values found in the uploaded documents.    */
/* A column the PHI screen identified as identifier-shaped NEVER       */
/* becomes a candidate — it cannot be mapped to anything, by           */
/* construction. The tool PROPOSES a mapping; the operator confirms    */
/* or corrects it in the review screen; assessment runs only on a      */
/* confirmed mapping (the human gate).                                 */
/* ================================================================== */

export function isIdentifierColumn(name) {
  const norm = String(name || "").trim().toLowerCase();
  return IDENTIFIER_HEADER.some(h => h.re.test(norm));
}

export function extractCandidates(parsedDocs) {
  const candidates = [];
  let n = 0;
  const push = c => { if (candidates.length < 400) candidates.push({ id: `c${++n}`, ...c }); };
  for (const doc of parsedDocs || []) {
    const parsed = doc.parsed || {};
    for (const kv of parsed.kv || []) {
      const value = asCount(kv.value);
      if (Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
        push({ file: doc.name, origin: "label: value line", label: kv.label, value });
      }
    }
    for (const table of parsed.tables || []) {
      const cols = table.columns || [];
      (table.rows || []).forEach((row, ri) => {
        const rowLabel = String((row && row[0]) ?? "").trim();
        if (!rowLabel) return;
        cols.forEach((col, ci) => {
          if (ci === 0 || isIdentifierColumn(col)) return;
          const value = asCount(row[ci]);
          if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return;
          push({ file: doc.name, origin: `table "${table.name}", row ${ri + 1}`, label: `${rowLabel} — ${col}`, value, tableName: table.name, rowLabel, columnLabel: String(col) });
        });
      });
    }
  }
  return candidates;
}

const TOTAL_RULES = [
  { re: /distinct patients|unique patients|total patients|patients,?\s*(total|all years)/i, key: "totalPatients" },
  { re: /total encounters|total visits|encounters,?\s*(total|all)/i, key: "totalEncounters" },
  { re: /total notes|notes,?\s*(total|all)/i, key: "totalNotes" },
  { re: /distinct cases|total cases|cases,?\s*(total|all)/i, key: "totalCases" },
  { re: /distinct customers|unique customers|total customers|customers,?\s*(total|all years)/i, key: "totalCustomers" },
  { re: /total transactions|transactions,?\s*(total|all)/i, key: "totalTransactions" },
  { re: /total records|total documents|records,?\s*(total|all)/i, key: "totalRecords" },
  { re: /total locations|locations,?\s*(total|all)/i, key: "totalLocations" }
];

const FIXED_ROW_RULES = {
  caseTypeMix: [
    { re: /workers?\s*comp|\bwc\b/i, row: "Workers' compensation" },
    { re: /personal\s*injury|\bpi\b/i, row: "Personal injury" },
    { re: /commercial/i, row: "Commercial" },
    { re: /other/i, row: "Other" }
  ],
  noteLanguageShare: [
    { re: /english|\ben\b/i, row: "English (EN)" },
    { re: /spanish|\bes\b|español/i, row: "Spanish (ES)" },
    { re: /other/i, row: "Other languages" }
  ],
  transactionTypeMix: [
    { re: /sale/i, row: "Sale" },
    { re: /service/i, row: "Service visit" },
    { re: /booking|appointment/i, row: "Booking" },
    { re: /invoice/i, row: "Invoice" },
    { re: /other/i, row: "Other" }
  ]
};

function bandRow(label, tableId) {
  const s = String(label || "");
  if (tableId === "historyDepth") {
    if (/under\s*6|<\s*6|0\s*(to|-|–)\s*6/i.test(s)) return "Under 6 months";
    if (/6\s*months?\s*(to|-|–)?\s*(under\s*)?2|6\s*(to|-|–)\s*24/i.test(s)) return "6 months to under 2 years";
    if (/2\s*(to|-|–)?\s*(under\s*)?5\s*years?|24\s*(to|-|–)\s*60/i.test(s)) return "2 years to under 5 years";
    if (/5\s*(\+|or more|years?\s*\+)|≥\s*5|60\s*\+/i.test(s)) return "5 years or more";
    return null;
  }
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (/25\s*(\+|or more)|≥\s*25/i.test(s)) return tableId === "visitsPerCaseBands" ? "25 or more visits" : "25 or more transactions";
  if (nums.length === 1 && nums[0] === 1) return tableId === "visitsPerCaseBands" ? "1 visit only" : "1 transaction only";
  if (nums.includes(2) && nums.includes(5)) return tableId === "visitsPerCaseBands" ? "2–5 visits" : "2–5 transactions";
  if (nums.includes(6) && nums.includes(12)) return tableId === "visitsPerCaseBands" ? "6–12 visits" : "6–12 transactions";
  if (nums.includes(13) && nums.includes(24)) return tableId === "visitsPerCaseBands" ? "13–24 visits" : "13–24 transactions";
  return null;
}

function columnKeyFor(td, columnLabel) {
  const s = String(columnLabel || "").toLowerCase();
  for (const m of td.measure) {
    const words = m.label.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (words.some(w => s.includes(w))) return m.key;
  }
  return td.measure.length === 1 ? td.measure[0].key : null;
}

/* Propose a target for every candidate. A candidate may receive no
   proposal (target null) — the operator can still map it by hand,
   or leave it unmapped. */
export function proposeMapping(track, candidates, systems) {
  const t = trackDef(track);
  if (!t) return [];
  const systemNames = (systems || []).map(s => String(s.name || "").toLowerCase());
  return (candidates || []).map(c => {
    const hay = `${c.label} ${c.rowLabel || ""}`;
    /* totals first — a "total" label wins over any table reading */
    for (const rule of TOTAL_RULES) {
      if (rule.key in Object.fromEntries(t.totals.map(x => [x.key, 1])) && rule.re.test(hay) && !/^\d{4}$/.test(String(c.rowLabel || ""))) {
        return { candidateId: c.id, target: { kind: "total", key: rule.key }, confidence: "high", reason: `Label matches the ${rule.key} total.` };
      }
    }
    /* records by year: the row label IS a year */
    if (/^\d{4}$/.test(String(c.rowLabel || ""))) {
      const td = tableDef(track, "recordsByYear");
      const col = columnKeyFor(td, c.columnLabel);
      if (col) return { candidateId: c.id, target: { kind: "cell", table: "recordsByYear", row: c.rowLabel, column: col }, confidence: "high", reason: "Row label is a year; column matched by its header." };
    }
    /* records by source system (non-medical): row label is a system */
    if (track === "non-medical" && c.rowLabel && systemNames.includes(String(c.rowLabel).toLowerCase())) {
      const td = tableDef(track, "recordsBySourceSystem");
      const col = columnKeyFor(td, c.columnLabel);
      if (col) return { candidateId: c.id, target: { kind: "cell", table: "recordsBySourceSystem", row: c.rowLabel, column: col }, confidence: "high", reason: "Row label matches a system selected for this asset." };
    }
    /* fixed-row tables */
    for (const [tableId, rules] of Object.entries(FIXED_ROW_RULES)) {
      const td = tableDef(track, tableId);
      if (!td) continue;
      for (const rule of rules) {
        if (rule.re.test(String(c.rowLabel || ""))) {
          const col = columnKeyFor(td, c.columnLabel);
          if (col) return { candidateId: c.id, target: { kind: "cell", table: tableId, row: rule.row, column: col }, confidence: "high", reason: `Row label matches the "${rule.row}" row.` };
        }
      }
    }
    /* band tables */
    for (const tableId of ["visitsPerCaseBands", "transactionsPerCustomerBands", "historyDepth"]) {
      const td = tableDef(track, tableId);
      if (!td) continue;
      const row = bandRow(c.rowLabel, tableId);
      if (row) {
        const col = columnKeyFor(td, c.columnLabel);
        if (col) return { candidateId: c.id, target: { kind: "cell", table: tableId, row, column: col }, confidence: "guess", reason: "Row label reads as a band; confirm the band edges match." };
      }
    }
    /* dynamic category tables (diagnosis families / segments) */
    const dynId = track === "medical" ? "patientsByDiagnosisFamily" : "customersBySegment";
    const dyn = tableDef(track, dynId);
    if (dyn && c.rowLabel && c.columnLabel) {
      const col = columnKeyFor(dyn, c.columnLabel);
      if (col) return { candidateId: c.id, target: { kind: "cell", table: dynId, row: c.rowLabel, column: col }, confidence: "guess", reason: `Category row — proposed for ${dyn.title}; confirm it belongs there.` };
    }
    return { candidateId: c.id, target: null, confidence: "none", reason: "No confident match — map by hand or leave unmapped." };
  });
}

/* Apply a confirmed mapping to a fresh counts object. */
export function applyMapping(track, candidates, mapping) {
  const counts = emptyCounts(track);
  const byId = new Map((candidates || []).map(c => [c.id, c]));
  const notes = [];
  const seenCells = new Set();
  let applied = 0;
  for (const m of mapping || []) {
    if (!m || m.include === false || !m.target) continue;
    const c = byId.get(m.candidateId);
    if (!c) continue;
    const tgt = m.target;
    const cellKey = tgt.kind === "total" ? `total:${tgt.key}` : `cell:${tgt.table}|${tgt.row}|${tgt.column}`;
    if (seenCells.has(cellKey)) {
      notes.push(`Two values were mapped to the same cell (${cellKey}); the later one ("${c.label}" = ${fmt(c.value)}) replaced the earlier.`);
    }
    seenCells.add(cellKey);
    if (tgt.kind === "total") {
      if (tgt.key in counts.totals) { counts.totals[tgt.key] = c.value; applied++; }
      continue;
    }
    const td = tableDef(track, tgt.table);
    if (!td || !td.measure.some(x => x.key === tgt.column)) continue;
    let tableCounts = counts.tables[tgt.table];
    if (!tableCounts) { tableCounts = counts.tables[tgt.table] = { overlap: false, rows: [] }; }
    let row = tableCounts.rows.find(r => r.label === tgt.row);
    if (!row) {
      row = { label: tgt.row };
      for (const mm of td.measure) row[mm.key] = null;
      tableCounts.rows.push(row);
    }
    row[tgt.column] = c.value;
    applied++;
  }
  return { counts, applied, notes };
}

/* ================================================================== */
/* PHASE 5 — ASSESS: the four outputs                                  */
/*                                                                     */
/* (a) the instantiated data dictionary — the model dictionary with    */
/*     the asset's variables and systems dropped in;                   */
/* (b) the populated distribution tables — the asset's real counts,    */
/*     shares computed, every table footed against its denominator;    */
/* (c) the extraction plan — Layer 4 specialized per system;           */
/* (d) the buyer-safe specimen package — the model package's           */
/*     structure, codename only, the asset's real counts (from the     */
/*     written inventory — NOT illustrative), the model's synthetic    */
/*     specimens unchanged, zero identifiers, zero economics.          */
/* ================================================================== */

const FRAMEWORK_MEDICAL =
  "De-identification is by expert certification under 45 CFR 164.514(b)(1): a qualified statistician or data scientist analyzes the specific dataset, applies the de-identification method, and certifies that the risk of re-identification is very small. The determination is documented for each asset before any licensed extract moves. The model retains structure that a mechanical checklist would strip — month-grain periods, ZIP-3 geography, per-patient date shifting, pseudonymous linkage keys — because the certification, not a field checklist, is the safeguard.";
const FRAMEWORK_NONMED =
  "The program applies the same de-identification discipline it uses for health data, modeled on expert certification under 45 CFR 164.514(b)(1): a qualified analyst reviews the specific dataset, applies the de-identification method, and documents that the risk of re-identification is very small before any licensed extract moves. Month-grain periods, coarse geography, per-customer date shifting, and pseudonymous linkage keys are retained because the documented determination, not a field checklist, is the safeguard.";

function instantiateExample(example, systems) {
  if (!example || !/\[.+\]/.test(example)) return example;
  const byClass = cls => (systems || []).find(s => (s.classes || []).includes(cls));
  let out = example;
  out = out.replace(/\[EHR name\]/g, (byClass("EHR clinical") || (systems || [])[0] || {}).name || "system of record");
  out = out.replace(/\[POS name\]/g, (byClass("POS") || byClass("Restaurant POS") || (systems || [])[0] || {}).name || "system of record");
  out = out.replace(/\[[^\]]+\]/g, (systems && systems[0] && systems[0].name) || "system of record");
  return out;
}

export function buildDictionary(track, variables, systems) {
  const sections = (DICTIONARIES[track] || []).map(sec => ({
    ...sec,
    fields: sec.fields.map(f => ({ ...f, example: instantiateExample(f.example, systems) }))
  }));
  sections.push({
    id: "longitudinal-keys", num: track === "medical" ? "1.7" : "1.6", title: "Longitudinal keys — carried on every dimension", grain: "all",
    fields: (track === "medical"
      ? [F("patient_key", "string", "Required", "PT-000000", "Identical on the patient, encounter, and case dimensions."),
         F("case_key", "string", "Required", "CS-000000", "Identical on the case dimension, its compensation extension, and every encounter in the case."),
         F("encounter_key", "string", "Required", "EN-000000", "Identical on the encounter and its PT submodule row. Joins on all three keys are transitive: any encounter resolves to exactly one case and one patient, and a case's complete visit history — office, procedure, and therapy — is one join away.")]
      : [F("customer_key", "string", "Required", "CU-000000", "Identical on the customer and transaction dimensions."),
         F("transaction_key", "string", "Required", "TX-000000", "Unique per transaction; the atomic unit of the extract."),
         F("location_key", "string", "Required", "LC-000000", "Identical on the location and transaction dimensions. Joins are transitive: any transaction resolves to exactly one customer (or the anonymous key) and one location, and a customer's complete history is one join away.")])
  });
  sections.push({
    id: "variables", num: track === "medical" ? "1.9" : "1.7", title: "Per-asset variables — this asset's values", grain: "asset",
    rows: variableRows(track, variables, systems)
  });
  return sections;
}

/* Distribution definitions — each table's own words, per the model. */
const TABLE_DEFINITIONS = {
  recordsByYear: "A unit is counted in the year of its period; a patient/customer is counted once in each year they appear, so that column is not additive across years. The years shown foot inside the whole-asset totals — the balance falls in years not shown.",
  patientsByDiagnosisFamily: "Categories are built from the diagnosis codes on each patient's encounters. Categories overlap — one patient appears in every family their diagnoses touch — and shares are computed per 100 of the stated denominator (distinct patients on the whole asset).",
  customersBySegment: "Segments overlap where the business defines them so — one customer can sit in several segments — and shares are computed per 100 of the stated denominator (distinct customers on the whole asset).",
  caseTypeMix: "Every case carries exactly one case-type value, so this table is a true partition: its cases column foots to the whole-asset case total and its encounters column to the whole-asset encounter total. Payer is a property of the case (payer_class), never a row here.",
  transactionTypeMix: "Every transaction carries exactly one record type, so this table is a true partition and foots exactly to the whole-asset transaction total.",
  noteLanguageShare: "Language is read from the note's native authorship, never from later translation. Shares are of all notes on the asset.",
  recordsBySourceSystem: "Every record carries exactly one system of record (source_system), so this table is a true partition and foots exactly to the whole-asset records total. It is also the reconciliation table: each row must equal that system's own report total at extraction.",
  visitsPerCaseBands: "Band edges are structural: the bands are contiguous and exhaustive, and the top band is open. Counting unit is the case; the visits counted are all encounters in the case, therapy sessions included.",
  transactionsPerCustomerBands: "Band edges are structural: the bands are contiguous and exhaustive, and the top band is open. Counting unit is the customer.",
  historyDepth: "Depth is the span, at extract time, between a subject's earliest and latest periods in the linked record, computed across all source systems combined — a subject documented in two systems is measured once, on the full linked history. Bands are half-open: the lower edge belongs to the band, the upper edge to the next."
};

export function buildDistributions(track, counts, validation) {
  const t = trackDef(track);
  return t.tables.map(td => {
    const comp = (validation.computed && validation.computed[td.id]) || { rows: [], denominator: null };
    let remainder = null;
    if (td.kind === "subset") {
      remainder = {};
      for (const m of td.measure) {
        const total = validation.totals[m.total];
        const shown = sum(comp.rows.map(r => r[m.key] || 0));
        /* non-additive columns (subjects by year) have no remainder —
           their column is not a partition of the total. */
        remainder[m.key] = (m.nonAdditive || total === null || total === undefined) ? null : total - shown;
      }
    }
    return {
      id: td.id, num: td.num, title: td.title, kind: td.kind, grain: td.grain,
      definition: TABLE_DEFINITIONS[td.id] || "",
      denominatorLabel: td.denominatorLabel || td.denominatorNote || "",
      denominator: comp.denominator,
      overlap: td.kind === "overlap" ? !!((counts && counts.tables && counts.tables[td.id] || {}).overlap) : null,
      detailLabel: td.detailLabel || null,
      measure: td.measure,
      rows: comp.rows,
      remainder
    };
  });
}

/* --- Output (c): the extraction plan, Layer 4 per system. --- */
export function buildExtractionPlan(track, codename, systems, catalogById) {
  const perSystem = (systems || []).map(sel => {
    const cat = (catalogById && catalogById.get(sel.id)) || sel;
    return {
      name: cat.name || sel.name,
      vendor: cat.vendor || "",
      confidence: cat.confidence || "PATTERN",
      classes: cat.classes || [],
      routes: (cat.routes || []).map(r => ({ kind: r.kind, label: ROUTE_LABEL[r.kind] || r.kind, note: r.note })),
      profile: (cat.mappingProfile || []).slice(0, 6)
    };
  });
  const names = perSystem.map(s => s.name).join(", ") || "the systems of record";
  const steps = [
    { n: 1, name: "Inventory", text: `Every source system is confirmed with the operator before anything is extracted: for ${codename}, the systems of record are ${names} (${perSystem.length} system${perSystem.length === 1 ? "" : "s"} in total). A system discovered mid-engagement is added to the inventory, mapped, and extracted separately rather than folded in silently.` },
    { n: 2, name: "Field mapping", text: "For each system, every exportable field is mapped to a dictionary field, with the transformation stated beside the mapping: verbatim for nature_of_injury and body_part_text; mapping for body_part_code; parsing for functional_measures. Fields needing clinician judgement are decided by the operator, never inferred." },
    { n: 3, name: "Extraction into staging", text: "Each system is extracted into a staging area inside the operator's own environment, using that system's first workable route in the preference order. Raw records never leave the operator's environment before de-identification." },
    { n: 4, name: "Identity resolution", text: "Records believed to describe the same person are linked inside staging — deterministic matching on strong identifiers first, then probabilistic matching on partial agreement — and a single linkage key is assigned. Collisions and uncertain matches are adjudicated by the operator, never by the extractor." },
    { n: 5, name: "Transformation", text: "Staged records are mapped into the dictionary shapes: codes as structured objects, longitudinal keys assigned, sequencing counters computed, banding applied. A per-patient (per-customer) date shift is applied at this step for every record that subject contributes." },
    { n: 6, name: "De-identification", text: track === "medical" ? FRAMEWORK_MEDICAL : FRAMEWORK_NONMED },
    { n: 7, name: "Reconciliation — exact footing", text: `Per system, the encounters, notes, and subjects extracted equal that system's own report totals for the same periods. A subject documented in more than one system is counted once in the asset total, and the arithmetic is printed with the package: the asset total equals the sum of the per-system counts minus the duplicates the linkage step resolved. Any variance stops the run — a failed reconciliation is a stopped run, not a footnoted one.` },
    { n: 8, name: "Packaging", text: "The deliverable is assembled in the license's shape: counts and inventory first; record-level delivery only where the signed agreement provides for it." }
  ];
  const governance = [
    "Written authorization from the operator and, for health data, a business associate agreement precede any extraction; the authorization names the systems in scope, and nothing outside it is touched.",
    "Extraction is read-only, runs on the operator's environment, and produces a full audit log — every job, its operator, its row counts, and its destination.",
    "Every transmission and store is encrypted in transit and at rest.",
    "Never used, on any system: screen-scraping or RPA over a clinician/operator workstation, disruption of production, and shared or individual user credentials. Where a vendor's tooling requires an interactive session, the operator's own staff run it under supervision."
  ];
  return { perSystem, steps, governance, framework: track === "medical" ? FRAMEWORK_MEDICAL : FRAMEWORK_NONMED };
}

/* ------------------------------------------------------------------ */
/* Layer 3 — the model's SYNTHETIC specimens. In an instantiated      */
/* package the specimens remain the model's synthetic ones, word      */
/* for word in structure; only Layers 1, 2 and 4 carry the asset's    */
/* real values. The non-medical specimens are written to the same     */
/* standard: invented subjects, keys, and text, no real business.     */
/* ------------------------------------------------------------------ */

const B = {
  h2: text => ({ t: "h2", text }),
  h3: text => ({ t: "h3", text }),
  p: text => ({ t: "p", text }),
  table: (head, rows) => ({ t: "table", head, rows }),
  list: items => ({ t: "list", items })
};

const MEDICAL_SPECIMENS = [
  B.h3("SPECIMEN A — SYNTHETIC — workers' compensation lumbar case, full arc (the common shape)"),
  B.p("Patient dimension (one row, in full):"),
  B.table(["Field", "Value"], [
    ["patient_key", "PT-004217"], ["sex", "M"], ["zip3", "021"], ["primary_language", "EN"]
  ]),
  B.p("Case dimension, with its compensation extension:"),
  B.table(["Field", "Value"], [
    ["case_key", "CS-001108"], ["patient_key", "PT-004217"], ["case_type", "workers_comp"],
    ["payer_class", "workers_comp_carrier"], ["case_open_period", "2021-03"], ["case_close_period", "2022-02"],
    ["case_status", "closed_at_rating"], ["injury_period", "2021-03"], ["injury_date_basis", "injury_date"],
    ["body_part_code", "lumbar_spine"], ["body_part_side", "not_applicable"], ["body_part_text", "lumbar spine"],
    ["nature_of_injury", "sprain / strain with radiculopathy"]
  ]),
  B.p("Encounter sequence (the case's twenty encounters; PT encounters occur inside the same sequence and increment the same counter):"),
  B.table(["#", "Period", "Type", "Diagnoses", "Procedures", "PT #", "Excerpt (de-identified, synthetic)"],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(n => {
      const rows = {
        1: ["2021-03", "initial_evaluation", "M54.16, M51.16", "99203", "—", "Initial evaluation (EN), 2021-03. Work status: out_of_work. \"Insidious onset after lifting at work. Pain radiating to the right lower extremity with numbness in an L5 distribution. Lumbar flexion limited to 30 degrees.\""],
        2: ["2021-03", "pt_note", "M54.16", "97161, 97110", "1", "PT evaluation and first session (EN). Plan opened (active). Measures: lumbar_flexion 30 degrees."],
        3: ["2021-03", "pt_note", "M54.16", "97110, 97140", "2", "\"Tolerating therapeutic exercise well; manual therapy to the lumbar paraspinals.\""],
        4: ["2021-04", "follow_up", "M54.16, M51.16", "99213", "—", "\"Radicular symptoms improving. Advanced to light duty with a 15-lb lifting restriction.\" work_status: light_duty."],
        5: ["2021-04", "pt_note", "M54.16", "97110, 97530", "3", "Session 3 (EN)."],
        6: ["2021-04", "pt_note", "M54.16", "97110, 97140", "4", "Session 4 (EN)."],
        7: ["2021-05", "follow_up", "M54.16", "99213", "—", "\"Continued improvement; MRI reviewed — disc herniation at L4–L5 contacting the right L5 root. Epidural steroid injection discussed.\""],
        8: ["2021-05", "pt_note", "M54.16", "97110", "5", "Session 5 (EN). Measures: lumbar_flexion 45 degrees."],
        9: ["2021-05", "pt_note", "M54.16", "97110, 97140", "6", "Session 6 (EN)."],
        10: ["2021-06", "procedure_note", "M54.16", "62323", "—", "Procedure note (EN): interlaminar epidural steroid injection, L4–L5, tolerated well."],
        11: ["2021-06", "pt_note", "M54.16", "97110", "7", "Session 7 (EN)."],
        12: ["2021-07", "follow_up", "M54.16", "99213", "—", "\"Approximately 60% relief following injection. Continue PT; work status remains light_duty.\""],
        13: ["2021-08", "pt_note", "M54.16", "97110, 97530", "8", "Session 8 (EN)."],
        14: ["2021-09", "follow_up", "M54.16", "99213", "—", "\"Plateau in progress; radicular symptoms persist at reduced intensity. Repeat injection considered.\""],
        15: ["2021-10", "procedure_note", "M54.16", "62323", "—", "Procedure note (EN): second interlaminar epidural steroid injection, L4–L5."],
        16: ["2021-11", "pt_note", "M54.16", "97110", "9", "Final PT session (EN). Plan completed. Measures: lumbar_flexion 55 degrees."],
        17: ["2021-12", "follow_up", "M54.16", "99213", "—", "\"Symptoms stable. Approaching maximum medical improvement; work status light_duty with permanent restrictions under review.\""],
        18: ["2022-01", "follow_up", "M54.16", "99213", "—", "\"No further interventional treatment planned.\" mmi_flag becomes true at this encounter."],
        19: ["2022-01", "follow_up", "M54.16", "99213", "—", "\"Restrictions finalized pending rating.\""],
        20: ["2022-02", "impairment_rating", "M54.16, M51.16", "—", "—", "Impairment rating (EN). impairment_rating_wpi: 7. The case closes at this encounter — case_status: closed_at_rating."]
      };
      const r = rows[n];
      return [String(n), r[0], r[1], r[2], r[3], r[4], r[5]];
    })),
  B.p("Twenty encounters, one sequence: five physician encounters of evaluation and follow-up, two procedure encounters, nine PT sessions, a second procedure, closing documentation, and a rating — with the dictionary's fields populated at every row and the case closing in the state its status names. The specimen's encounter rows foot exactly: 20 rows, visits 1 through 20, PT sessions 1 through 9 inside them."),

  B.h3("SPECIMEN B — SYNTHETIC — compensation shoulder case documented natively in Spanish (the bilingual shape)"),
  B.p("Patient: PT-007730 — F — zip3 021 — primary_language ES. Case: CS-002391 — case_type workers_comp; payer_class workers_comp_carrier; case_open_period 2023-01; case_close_period 2023-07; case_status closed_other. Compensation extension: injury_period 2022-12; injury_date_basis onset; body_part_code shoulder; body_part_side right; body_part_text \"hombro derecho\"; nature_of_injury \"tendinitis del manguito rotador\" (rotator-cuff tendinitis, in the source's own wording)."),
  B.p("Encounter sequence (nine encounters): 2023-01 initial_evaluation (EN chart, ES note) — \"Evaluación inicial: dolor en el hombro derecho de inicio gradual, atribuido a trabajo repetitivo por encima de la cabeza. Arco doloroso entre 70 y 120 grados de abducción.\" work_status light_duty. 2023-01 pt_note 1 (97161, 97110), plan opened, measures shoulder_abduction 110 degrees. 2023-02 follow_up — progress note in Spanish. 2023-02 pt_note 2 (97110, 97140). 2023-03 procedure_note — subacromial injection, procedure code 20610, documented in Spanish. 2023-03 pt_note 3 (97110), measures shoulder_abduction 140 degrees. 2023-04 follow_up — work_status full_duty. 2023-05 pt_note 4 (97110), plan completed. 2023-07 follow_up — closing note in Spanish, translated beside it for an English-reading reviewer: the translation rides with the note; the specimen's language is its authorship, and the note-language table counts this case's notes as Spanish because they were written in Spanish."),
  B.p("The injury_period (2022-12) precedes the first encounter (2023-01) because the basis is onset — cumulative trauma is recorded at onset, not at an injury date, and injury_date_basis says which."),

  B.h3("SPECIMEN C — SYNTHETIC — five-year chronic pain case, commercial payer (the longitudinal shape)"),
  B.p("Patient: PT-001155 — F — zip3 021 — primary_language EN. Case: CS-000204 — case_type commercial; payer_class commercial_insurer; case_open_period 2019-06; case_close_period null; case_status open. No compensation extension — the extension exists only on compensation cases."),
  B.p("Encounter history, forty-one encounters over the visible window: 2019-06 initial_evaluation (M54.16, M47.816; 99204). 2019-07 follow_up. 2019-08 procedure_note — facet joint injections, L4–L5 and L5–S1, coded as the pair is actually billed: 64493 + 64494 (CPT) — a specimen that showed only the primary code would teach the buyer the record is thinner than it is. 2019-11 follow_up. 2020-02 follow_up. 2020-05 procedure_note — medial branch radiofrequency ablation, 64635 + 64636. 2020-09 follow_up — \"Approximately nine months of relief following ablation; symptoms recurring.\" 2021-01 follow_up. 2021-04 procedure_note — radiofrequency ablation repeated, 64635 + 64636. 2021-08 follow_up. 2022-02 follow_up. 2022-06 follow_up — gabapentinoid continued; opioid therapy avoided per plan. 2022-11 procedure_note — epidural steroid injection, 62323. 2023-03 follow_up. 2023-08 follow_up. 2024-02 follow_up. 2024-05 follow_up — case remains open, management ongoing."),
  B.p("The case demonstrates what five years means in this dictionary: one thread of forty-one encounters over sixty months — a problem followed, treated, re-treated, and still open — with commercial semantics: the case is an episode of care for one problem, still inside its twelve-month window because the encounters never stop.")
];

const NONMEDICAL_SPECIMENS = [
  B.h3("SPECIMEN D — SYNTHETIC — home-services customer, six-year service relationship (the repeat shape)"),
  B.p("Customer dimension (one row, in full):"),
  B.table(["Field", "Value"], [
    ["customer_key", "CU-003512"], ["customer_type", "household"], ["region_code", "021"], ["primary_language", "EN"], ["first_period", "2019-04"]
  ]),
  B.p("Referral & relationship: referral_source referral_partner; relationship_status active; repeat_flag true. Transaction sequence (fourteen transactions over six years; sequence_in_relationship runs 1–14 on the same counter): 2019-04 service_visit (initial deep clean) — app_checkin, card. 2019-05 → 2024-11: twelve recurring service_visits on a monthly cadence, each verified by app_checkin, category codes SVC-RECURRING (internal taxonomy). 2021-09: one invoice transaction (account) for a one-off project, category SVC-PROJECT. The specimen demonstrates the repeat behaviour buyers measure: one acquisition, six years of retained recurring transactions, a single location (LC-000077, service_base), channel field throughout."),
  B.h3("SPECIMEN E — SYNTHETIC — fuel & convenience location, one quarter of day-close records (the volume shape)"),
  B.p("Location dimension: location_key LC-000031; location_type fuel_site; region_code 066; open_period 2015-03. Day-close records are aggregate documents, not transactions: one record per location per day, carrying category totals — FUEL-REG, FUEL-PREM, FUEL-DSL, RET-TOBACCO, RET-BEV, RET-FOOD (internal taxonomy) — with payment_method_class shares at class level (card / cash / wallet) and no customer linkage (anonymous retail volume is recorded against the reserved customer key CU-ANON). Ninety-two day-close records cover the quarter; the specimen shows three: 2024-01-02 (weekday pattern), 2024-02-17 (weekend pattern), 2024-03-29 (holiday-weekend pattern). Category shares move between the three exactly as fuel-led retail volume moves — weekday fuel-heavy, weekend basket-heavy — which is the pattern a buyer verifies in the full extract."),
  B.p("The two specimens together show the non-medical model's two shapes: identified longitudinal relationships (Specimen D) and anonymous high-volume aggregates (Specimen E), both carried on the same keys and the same period grain.")
];

/* ------------------------------------------------------------------ */
/* The specimen package document (block structure) + MD renderer.      */
/* One block structure feeds BOTH renderers (Markdown here, PDF in     */
/* _data-assets-pdf.js) so the formats can never drift apart.          */
/* ------------------------------------------------------------------ */

function dictionaryBlocks(dictionary) {
  const blocks = [];
  for (const sec of dictionary) {
    blocks.push(B.h3(`§${sec.num} — ${sec.title}`));
    if (sec.fields) {
      blocks.push(B.table(["Field", "Type", "Required", "Format example", "Definition"],
        sec.fields.map(f => [f.name, f.type, f.required, f.example, f.notes])));
    }
    if (sec.rows) {
      blocks.push(B.table(["Variable", "This asset's value", "What it instantiates"], sec.rows));
    }
  }
  return blocks;
}

function distributionBlocks(distributions) {
  const blocks = [];
  for (const d of distributions) {
    blocks.push(B.h3(`Table ${d.num} — ${d.title}`));
    blocks.push(B.p(`**Definition.** ${d.definition}`));
    if (d.overlap === true) blocks.push(B.p("**The categories in this table overlap.** A subject belonging to two categories is counted in both, so the counts sum past the denominator exactly as far as the overlap carries them; shares are computed per 100 of the stated denominator."));
    if (d.overlap === false) blocks.push(B.p("**The categories in this table are mutually exclusive** for this asset, and the counts partition the denominator exactly."));
    const head = ["Row", ...(d.detailLabel ? [d.detailLabel] : []),
      ...d.measure.flatMap(m => [`${m.label} (count)`, "Per 100"])];
    const rows = d.rows.map(r => [
      r.label,
      ...(d.detailLabel ? [r.detail || "—"] : []),
      ...d.measure.flatMap(m => [r[m.key] === null || r[m.key] === undefined ? "—" : fmt(r[m.key]),
                                 r.shares && r.shares[m.key] !== null && r.shares[m.key] !== undefined ? String(r.shares[m.key]) : "—"])
    ]);
    blocks.push(B.table(head, rows));
    if (d.denominatorLabel) blocks.push(B.p(`**Denominator:** ${d.denominatorLabel}${d.denominator !== null && d.denominator !== undefined ? ` = ${fmt(d.denominator)}` : ""}. Shares are computed from the counts against this denominator and rounded to whole numbers; rounded shares may not sum to exactly 100.`));
    if (d.remainder) {
      const parts = d.measure
        .filter(m => d.remainder[m.key] !== null && d.remainder[m.key] !== undefined)
        .map(m => `${fmt(d.remainder[m.key])} ${m.label.toLowerCase()} fall in years not shown`);
      if (parts.length) blocks.push(B.p(`**Remainder:** ${parts.join("; ")} (whole-asset total less the years shown).`));
    }
  }
  return blocks;
}

function planBlocks(plan) {
  const blocks = [];
  blocks.push(B.h3("Extraction routes — preference order"));
  blocks.push(B.p("For every system, the routes are preferred in this order: (1) the system's native reporting and export tools; (2) vendor API or FHIR access, read-only and scoped; (3) scheduled file extracts over a secure channel; (4) vendor-assisted database extracts where no self-service tooling exists. Never used, on any system: screen-scraping or RPA over a workstation, disruption of production, and shared or individual user credentials."));
  for (const s of plan.perSystem) {
    blocks.push(B.h3(`${s.name}${s.vendor ? ` (${s.vendor})` : ""} — catalog confidence: ${s.confidence}`));
    blocks.push(B.p(`Data classes carried: ${s.classes.join(", ") || "general"}. Catalog confidence ${s.confidence}${s.confidence === "VERIFIED" ? " — grounded in the vendor's well-established public capabilities." : " — modeled on its software class; exact export features not individually verified, routes phrased generically."}`));
    blocks.push(B.table(["Route (preference order)", "For this system"],
      s.routes.map((r, i) => [`${i + 1}. ${r.label || r.kind}`, r.note || ""])));
    if (s.profile && s.profile.length) {
      blocks.push(B.p("Starter field mapping (confirmed field by field at the mapping step):"));
      blocks.push(B.table(["Source field", "Dictionary target"], s.profile.map(m => [m.source, m.target])));
    }
  }
  blocks.push(B.h3("The pipeline"));
  for (const step of plan.steps) blocks.push(B.p(`**Step ${step.n} — ${step.name}.** ${step.text}`));
  blocks.push(B.h3("Governance"));
  for (const g of plan.governance) blocks.push(B.p(`- ${g}`));
  return blocks;
}

export function buildPackageDocument(asset, outputs) {
  const { codename, track, variables } = asset;
  const today = new Date().toISOString().slice(0, 10);
  const blocks = [
    B.h2(`Sample Specimen Package — ${codename}`),
    B.p(`**Asset codename:** ${codename}. The asset is identified by codename only; no practice, business, or person is named anywhere in this package.`),
    B.p(`**Prepared by:** IEC, Inc. — Data Network · ${today}`),
    B.p(`**Track:** ${trackDef(track).label}.`),
    B.p("**What this package is.** This package shows a prospective licensee exactly what data a licensed extract from this asset contains, at three depths: a data dictionary (Layer 1), the asset's real counts in distribution tables (Layer 2), and complete specimen records (Layer 3) — plus the method by which the real extract is produced and certified (Layer 4). It is the structural verification document for a licensing evaluation."),
    B.p("**Counts.** The Layer 2 counts are the asset's actual counts, taken from the asset's written inventory at the date above. They are counts, not records: this package contains no patient or customer record, no name, and no identifier of any kind. The Layer 3 specimens are synthetic records written to the dictionary, marked SYNTHETIC on their face."),
    B.p("**Scope.** Commercial terms are handled separately and do not appear in this document."),
    B.h2("Layer 1 — Data dictionary (instantiated for this asset)"),
    B.p("Types, required/nullable status, and coded vocabularies are stated for every field. Format examples show shape only and name no real subject. Bracketed slots from the model have been replaced by this asset's values (final section)."),
    ...dictionaryBlocks(outputs.dictionary),
    B.h2("Layer 2 — Distributions (this asset's real counts)"),
    B.p("Each table states its own denominator, and shares are computed from the counts against it. Where categories overlap, the definition says so and the counts are allowed to pass the denominator — the overlap is a property of the data, stated, never hidden in the arithmetic."),
    ...distributionBlocks(outputs.distributions),
    B.h2("Layer 3 — Specimen records (synthetic)"),
    B.p("Three complete specimens — invented patients/customers, invented text, written to the dictionary field by field, internally consistent and arithmetically exact. Nothing in this layer describes a real subject."),
    ...(track === "medical" ? MEDICAL_SPECIMENS : NONMEDICAL_SPECIMENS),
    B.h2("Layer 4 — Extraction method (this asset's plan)"),
    ...planBlocks(outputs.extractionPlan),
    B.p("— End of package —")
  ];
  return blocks;
}

export function renderMarkdown(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.t === "h2") out.push(`\n## ${b.text}\n`);
    else if (b.t === "h3") out.push(`\n### ${b.text}\n`);
    else if (b.t === "p") out.push(`${b.text}\n`);
    else if (b.t === "list") out.push(b.items.map(i => `- ${i}`).join("\n") + "\n");
    else if (b.t === "table") {
      const esc = c => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      out.push(`| ${b.head.map(esc).join(" | ")} |`);
      out.push(`| ${b.head.map(() => "---").join(" | ")} |`);
      for (const r of b.rows) out.push(`| ${r.map(esc).join(" | ")} |`);
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* One call → all four outputs for a validated asset. */
export function assessAsset(asset, catalogById) {
  const validation = validateAsset(asset.track, asset.variables, asset.counts, asset.systems);
  const dictionary = buildDictionary(asset.track, asset.variables, asset.systems);
  const distributions = buildDistributions(asset.track, asset.counts, validation);
  const extractionPlan = buildExtractionPlan(asset.track, asset.codename, asset.systems, catalogById);
  const outputs = { dictionary, distributions, extractionPlan };
  const document = buildPackageDocument(asset, outputs);
  return { validation, outputs, document, markdown: renderMarkdown(document) };
}

/* ================================================================== */
/* COMPARE — the tool's assessment vs an EXTERNAL assessment of the   */
/* same asset (e.g., DataSupply's), recorded by the operator.          */
/*                                                                     */
/* INTERNAL ONLY. Comparisons never enter the specimen package: the    */
/* package builder above takes the asset alone, by construction. An   */
/* external party's stated value conclusion is recorded as THEIR      */
/* figure, labeled as theirs — it is not IEC economics, and it is     */
/* never exported.                                                     */
/*                                                                     */
/* BLIND-FREEZE: an asset's assessment can be FROZEN (locked,          */
/* timestamped — enforced in the API). The intended workflow freezes   */
/* the tool's assessment BEFORE the external assessment is entered.    */
/* The comparison reports both timestamps and flags "not blind"        */
/* whenever the external entry predates the freeze — or no freeze      */
/* exists at all.                                                      */
/* ================================================================== */

export const COMPARE_MEASURES = [
  { key: "subjects", label: "Subjects (patients / customers)", tool: a => (a.counts.totals || {}).totalPatients ?? (a.counts.totals || {}).totalCustomers ?? null },
  { key: "transactions", label: "Encounters / transactions", tool: a => (a.counts.totals || {}).totalEncounters ?? (a.counts.totals || {}).totalTransactions ?? null },
  { key: "documents", label: "Notes / records & documents", tool: a => (a.counts.totals || {}).totalNotes ?? (a.counts.totals || {}).totalRecords ?? null },
  { key: "cases", label: "Cases (medical track)", tool: a => (a.counts.totals || {}).totalCases ?? null },
  { key: "systems", label: "Software systems", tool: a => (a.systems || []).length },
  { key: "employees", label: "Employees (FTE)", tool: a => asCount((a.variables || {}).workforceFTE) },
  { key: "yearsOfHistory", label: "Years of history", tool: a => asCount((a.variables || {}).historyDepthYears) }
];

export function toolDataClasses(asset, catalogById) {
  const set = new Set();
  for (const sel of asset.systems || []) {
    const cat = (catalogById && catalogById.get(sel.id)) || sel;
    for (const c of cat.classes || []) set.add(c);
  }
  return [...set].sort();
}

export function compareAssessments(asset, external, thresholds, catalogById) {
  const matchPct = thresholds && Number.isFinite(thresholds.matchPct) ? thresholds.matchPct : 2;
  const closePct = thresholds && Number.isFinite(thresholds.closePct) ? thresholds.closePct : 10;
  const ext = (external && external.measures) || {};
  const rows = [];
  for (const m of COMPARE_MEASURES) {
    const toolVal = m.tool(asset);
    const extVal = asCount(ext[m.key]);
    if (toolVal === null || toolVal === undefined || !Number.isFinite(toolVal)) continue;
    if (!Number.isFinite(extVal)) continue;
    const diff = extVal - toolVal;
    const pct = toolVal !== 0 ? Math.abs(diff) / Math.abs(toolVal) * 100 : (extVal === 0 ? 0 : Infinity);
    const status = pct <= matchPct ? "MATCH" : pct <= closePct ? "CLOSE" : "DIVERGENT";
    rows.push({ key: m.key, label: m.label, tool: toolVal, external: extVal, diff, pct: pct === Infinity ? null : Math.round(pct * 10) / 10, status });
  }
  /* data classes: set overlap */
  const toolClasses = toolDataClasses(asset, catalogById);
  const extClasses = Array.isArray(ext.classesFound) ? ext.classesFound.map(String) : [];
  let classesRow = null;
  if (toolClasses.length || extClasses.length) {
    const tSet = new Set(toolClasses.map(c => c.toLowerCase()));
    const eSet = new Set(extClasses.map(c => c.toLowerCase()));
    const shared = [...tSet].filter(c => eSet.has(c)).length;
    const union = new Set([...tSet, ...eSet]).size || 1;
    const overlapPct = Math.round((shared / union) * 100);
    const status = overlapPct === 100 ? "MATCH" : overlapPct >= 80 ? "CLOSE" : "DIVERGENT";
    classesRow = { key: "classesFound", label: "Data classes found", tool: toolClasses, external: extClasses, overlapPct, status };
  }
  const all = classesRow ? [...rows, classesRow] : rows;
  const summary = {
    compared: all.length,
    matched: all.filter(r => r.status === "MATCH").length,
    close: all.filter(r => r.status === "CLOSE").length,
    divergent: all.filter(r => r.status === "DIVERGENT").length
  };
  const largestFirst = [...rows].sort((a, b) => (b.pct ?? Infinity) - (a.pct ?? Infinity));
  const frozenAt = asset.frozen && asset.frozen.at ? asset.frozen.at : null;
  const enteredAt = external && external.enteredAt ? external.enteredAt : null;
  const blind = !!(frozenAt && enteredAt && new Date(frozenAt).getTime() <= new Date(enteredAt).getTime());
  return {
    thresholds: { matchPct, closePct },
    rows, classesRow, summary, largestFirst,
    blind: { isBlind: blind, frozenAt, externalEnteredAt: enteredAt,
      note: !frozenAt ? "Not blind — the tool's assessment has not been frozen."
        : !enteredAt ? "The external assessment carries no entry timestamp."
        : blind ? "Blind — the tool's assessment was frozen before the external assessment was entered."
        : "Not blind — the external assessment was entered before the tool's assessment was frozen." },
    valueConclusion: external && external.valueConclusion ? String(external.valueConclusion) : "",
    source: external && external.source ? String(external.source) : ""
  };
}

export const _internals = {
  TRACKS, DICTIONARIES, validateAsset, emptyCounts, parseDelimited, parseTextDocument,
  parseXLSX, parsePDF, parseDocument, phiScreen, extractCandidates, proposeMapping,
  applyMapping, buildDictionary, buildDistributions, buildExtractionPlan, assessAsset,
  buildPackageDocument, renderMarkdown, compareAssessments, toolDataClasses, COMPARE_MEASURES
};
