/* =====================================================================
   IEC Suite — Data Asset Builder: embedded SOFTWARE CATALOG
   (DrMorgan's order 2026-11-11: "embed all possible software
   carrying data").

   Built-in knowledge of the software systems that carry licensable
   data, across BOTH tracks. One entry per system:
     name, vendor, track ("medical" | "non-medical" | "both"),
     classes (the data classes it carries), routes (its export
     routes in the Layer-4 preference order — native reporting /
     export suite · API / FHIR · scheduled file / SFTP ·
     vendor-assisted), and a starter field-mapping profile into the
     model dictionary (assembled from the per-class profiles below).

   HONESTY RULE — every entry carries a confidence label:
     VERIFIED — grounded in the vendor's well-established public
                capabilities (published APIs / FHIR support).
     PATTERN  — modeled on its software class; the exact export
                features are NOT individually verified, and the
                routes are phrased generically on purpose.
   A PATTERN profile is never presented as verified vendor fact —
   the Desk page prints the label beside every system, and the
   extraction plan output carries it too.

   Operators can add their own systems (api/data-assets.js,
   action "add-system"); custom entries are stored server-side and
   merged with this seed by the API. A custom entry is always
   PATTERN — the operator asserts its routes, IEC has not verified
   them.
   ===================================================================== */

/* Route kinds, in the Layer-4 preference order (model package §4.1). */
export const ROUTE_KINDS = [
  { kind: "native", label: "Native reporting / export suite", order: 1 },
  { kind: "api",    label: "API / FHIR read-only",            order: 2 },
  { kind: "sftp",   label: "Scheduled file export (SFTP)",    order: 3 },
  { kind: "vendor", label: "Vendor-assisted extract",         order: 4 }
];
export const ROUTE_LABEL = Object.fromEntries(ROUTE_KINDS.map(r => [r.kind, r.label]));

/* ------------------------------------------------------------------ */
/* Starter mapping profiles per data class. `source` is the field    */
/* name such a system typically carries; `target` is the model       */
/* dictionary field (medical track) or model slot it feeds.          */
/* ------------------------------------------------------------------ */

export const CLASS_PROFILES = {
  "EHR clinical": [
    { source: "Patient internal ID", target: "patient_key" },
    { source: "Date of service", target: "encounter_period" },
    { source: "Diagnosis codes (ICD-10)", target: "diagnosis_codes" },
    { source: "Procedure codes (CPT/HCPCS)", target: "procedure_codes" },
    { source: "Note type / document type", target: "note_type" },
    { source: "Note author role", target: "provider_role" }
  ],
  "PT / rehabilitation": [
    { source: "Therapy visit date", target: "encounter_period" },
    { source: "Modality / treatment codes (CPT)", target: "modality_codes" },
    { source: "Visit number in plan of care", target: "pt_visit_number" },
    { source: "Functional measures / goals", target: "functional_measures" },
    { source: "Plan of care status", target: "plan_status" }
  ],
  "Billing / practice management": [
    { source: "Claim / case type", target: "case_type" },
    { source: "Payer / funding source", target: "payer_class" },
    { source: "Date of injury / onset", target: "injury_period" },
    { source: "Case open / close dates", target: "case_open_period" }
  ],
  "Scheduling": [
    { source: "Appointment date", target: "encounter_period" },
    { source: "Appointment / visit type", target: "note_type" },
    { source: "Location / setting", target: "setting" }
  ],
  "EVV": [
    { source: "Visit date", target: "period" },
    { source: "Service type", target: "service_type" },
    { source: "Visit verification method", target: "verification_method" },
    { source: "Scheduled vs actual duration", target: "duration_band" }
  ],
  "Payments": [
    { source: "Payment date", target: "period" },
    { source: "Payment method class", target: "payment_method_class" },
    { source: "Transaction count / volume band", target: "transaction_count" }
  ],
  "Home health": [
    { source: "Episode / period start", target: "period" },
    { source: "Visit type (SN / PT / OT / aide)", target: "service_type" },
    { source: "OASIS assessment items", target: "assessment_items" },
    { source: "Diagnosis codes (ICD-10)", target: "diagnosis_codes" }
  ],
  "Long-term care": [
    { source: "Resident internal ID", target: "customer_key" },
    { source: "Assessment date (MDS)", target: "period" },
    { source: "Care level / acuity", target: "service_type" }
  ],
  "Behavioral health": [
    { source: "Session date", target: "encounter_period" },
    { source: "Session type", target: "note_type" },
    { source: "Diagnosis codes (ICD-10)", target: "diagnosis_codes" }
  ],
  "POS": [
    { source: "Transaction timestamp", target: "period" },
    { source: "Basket / item categories", target: "category_codes" },
    { source: "Register / location ID", target: "location_key" },
    { source: "Tender type", target: "payment_method_class" }
  ],
  "Convenience / fuel back-office": [
    { source: "Day-close / shift period", target: "period" },
    { source: "Department sales categories", target: "category_codes" },
    { source: "Fuel grade volumes", target: "category_codes" },
    { source: "Store ID", target: "location_key" }
  ],
  "Restaurant POS": [
    { source: "Check timestamp", target: "period" },
    { source: "Menu item categories", target: "category_codes" },
    { source: "Daypart", target: "daypart" },
    { source: "Location ID", target: "location_key" }
  ],
  "CRM": [
    { source: "Account / contact internal ID", target: "customer_key" },
    { source: "Referral source", target: "referral_source" },
    { source: "First-touch date", target: "first_period" },
    { source: "Pipeline stage history", target: "stage_history" }
  ],
  "Payroll / HR": [
    { source: "Pay period", target: "period" },
    { source: "Headcount by role", target: "workforce_by_role" },
    { source: "Hours by class (FT / PT / per-diem)", target: "hours_by_class" },
    { source: "Location / department", target: "location_key" }
  ],
  "Accounting": [
    { source: "Posting period", target: "period" },
    { source: "Account / category codes", target: "category_codes" },
    { source: "Transaction counts by category", target: "transaction_count" }
  ],
  "E-commerce": [
    { source: "Order timestamp", target: "period" },
    { source: "Product categories", target: "category_codes" },
    { source: "Customer internal ID", target: "customer_key" },
    { source: "Channel (web / POS / marketplace)", target: "channel" }
  ],
  "Field service": [
    { source: "Job / work-order date", target: "period" },
    { source: "Service type", target: "service_type" },
    { source: "Job status history", target: "stage_history" },
    { source: "Repeat-visit linkage", target: "customer_key" }
  ],
  "Booking / scheduling": [
    { source: "Appointment / booking date", target: "period" },
    { source: "Service booked", target: "service_type" },
    { source: "Repeat-booking linkage", target: "customer_key" },
    { source: "Location", target: "location_key" }
  ]
};

/* Assemble one system's starter mapping profile from its classes:
   class profiles merged in class order, first mapping per target
   wins, capped so the review screen stays readable. */
export function profileFor(system) {
  const seen = new Set();
  const out = [];
  for (const cls of (system && system.classes) || []) {
    for (const m of CLASS_PROFILES[cls] || []) {
      if (seen.has(m.target)) continue;
      seen.add(m.target);
      out.push({ source: m.source, target: m.target, viaClass: cls });
      if (out.length >= 10) return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The seed catalog.                                                 */
/* routes: the kinds the system offers, in Layer-4 preference        */
/* order, each with a short note. VERIFIED entries may name the      */
/* vendor's published capability; PATTERN entries stay generic.      */
/* ------------------------------------------------------------------ */

const R = (kind, note) => ({ kind, note });
const NATIVE_FIRST = [
  R("native", "Scheduled report exports from the built-in reporting suite."),
  R("sftp", "Recurring report files over a secure channel, where offered."),
  R("vendor", "Vendor-assisted extract under the practice's authorization.")
];

export const SEED_SYSTEMS = [
  /* ---------------- Medical ---------------- */
  { id: "epic", name: "Epic", vendor: "Epic Systems", track: "medical", confidence: "VERIFIED",
    classes: ["EHR clinical", "Scheduling", "Billing / practice management"],
    routes: [R("api", "FHIR R4 APIs and bulk data export are published, well-established capabilities."),
             R("native", "Reporting workbench / Clarity-Caboodle reporting exports."),
             R("vendor", "Vendor-assisted extract under the organization's authorization.")] },
  { id: "oracle-health", name: "Oracle Health (Cerner)", vendor: "Oracle", track: "medical", confidence: "VERIFIED",
    classes: ["EHR clinical", "Scheduling", "Billing / practice management"],
    routes: [R("api", "FHIR APIs are a published capability of the platform."),
             R("native", "Millennium / HealtheIntent reporting exports."),
             R("vendor", "Vendor-assisted extract under the organization's authorization.")] },
  { id: "athenahealth", name: "athenahealth", vendor: "athenahealth", track: "medical", confidence: "VERIFIED",
    classes: ["EHR clinical", "Scheduling", "Billing / practice management"],
    routes: [R("api", "Published API platform, including FHIR endpoints."),
             R("native", "Built-in report builder with scheduled exports."),
             R("sftp", "Scheduled file delivery where configured.")] },
  { id: "eclinicalworks", name: "eClinicalWorks", vendor: "eClinicalWorks", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "drchrono", name: "DrChrono", vendor: "DrChrono", track: "medical", confidence: "VERIFIED",
    classes: ["EHR clinical", "PT / rehabilitation", "Scheduling", "Billing / practice management"],
    routes: [R("api", "Public REST API is a published capability of the platform."),
             R("native", "Built-in reporting with CSV exports."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "aprima", name: "Aprima", vendor: "Aprima Medical Software", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "practice-fusion", name: "Practice Fusion", vendor: "Practice Fusion (Veradigm)", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Scheduling"], routes: NATIVE_FIRST },
  { id: "tebra", name: "Tebra (Kareo)", vendor: "Tebra", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Billing / practice management", "Scheduling"], routes: NATIVE_FIRST },
  { id: "advancedmd", name: "AdvancedMD", vendor: "AdvancedMD", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Billing / practice management", "Scheduling"], routes: NATIVE_FIRST },
  { id: "nextgen", name: "NextGen", vendor: "NextGen Healthcare", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Billing / practice management", "Scheduling"], routes: NATIVE_FIRST },
  { id: "veradigm", name: "Veradigm (Allscripts)", vendor: "Veradigm", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "wellsky", name: "WellSky", vendor: "WellSky", track: "medical", confidence: "PATTERN",
    classes: ["Home health", "EVV", "Scheduling"], routes: NATIVE_FIRST },
  { id: "axxess", name: "Axxess", vendor: "Axxess", track: "medical", confidence: "PATTERN",
    classes: ["Home health", "EVV", "Scheduling"], routes: NATIVE_FIRST },
  { id: "matrixcare", name: "MatrixCare", vendor: "MatrixCare (ResMed)", track: "medical", confidence: "PATTERN",
    classes: ["Home health", "Long-term care", "Scheduling"], routes: NATIVE_FIRST },
  { id: "pointclickcare", name: "PointClickCare", vendor: "PointClickCare", track: "medical", confidence: "PATTERN",
    classes: ["Long-term care", "EHR clinical", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "simplepractice", name: "SimplePractice", vendor: "SimplePractice", track: "medical", confidence: "PATTERN",
    classes: ["Behavioral health", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "therapynotes", name: "TherapyNotes", vendor: "TherapyNotes", track: "medical", confidence: "PATTERN",
    classes: ["Behavioral health", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "webpt", name: "WebPT", vendor: "WebPT", track: "medical", confidence: "PATTERN",
    classes: ["PT / rehabilitation", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "clinicient", name: "Clinicient", vendor: "Clinicient (Raintree)", track: "medical", confidence: "PATTERN",
    classes: ["PT / rehabilitation", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "hhaexchange", name: "HHAeXchange", vendor: "HHAeXchange", track: "medical", confidence: "PATTERN",
    classes: ["EVV", "Home health", "Scheduling"], routes: NATIVE_FIRST },
  { id: "sandata", name: "Sandata", vendor: "Sandata Technologies", track: "medical", confidence: "PATTERN",
    classes: ["EVV", "Home health"], routes: NATIVE_FIRST },
  { id: "rectangle-health", name: "Rectangle Health", vendor: "Rectangle Health", track: "medical", confidence: "PATTERN",
    classes: ["Payments"], routes: NATIVE_FIRST },
  { id: "modmed", name: "ModMed", vendor: "Modernizing Medicine", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Scheduling", "Billing / practice management"], routes: NATIVE_FIRST },
  { id: "greenway", name: "Greenway Health", vendor: "Greenway Health", track: "medical", confidence: "PATTERN",
    classes: ["EHR clinical", "Billing / practice management", "Scheduling"], routes: NATIVE_FIRST },

  /* ---------------- Non-medical ---------------- */
  { id: "square", name: "Square", vendor: "Block, Inc.", track: "non-medical", confidence: "VERIFIED",
    classes: ["POS", "Payments", "E-commerce"],
    routes: [R("api", "Published developer APIs for orders, payments and customers."),
             R("native", "Dashboard exports (CSV) for transactions and items."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "toast", name: "Toast", vendor: "Toast, Inc.", track: "non-medical", confidence: "PATTERN",
    classes: ["Restaurant POS", "Payments"], routes: NATIVE_FIRST },
  { id: "clover", name: "Clover", vendor: "Fiserv", track: "non-medical", confidence: "PATTERN",
    classes: ["POS", "Payments"], routes: NATIVE_FIRST },
  { id: "lightspeed", name: "Lightspeed", vendor: "Lightspeed Commerce", track: "non-medical", confidence: "PATTERN",
    classes: ["POS", "E-commerce"], routes: NATIVE_FIRST },
  { id: "shopify", name: "Shopify", vendor: "Shopify", track: "non-medical", confidence: "VERIFIED",
    classes: ["E-commerce", "POS"],
    routes: [R("api", "Published Admin API (REST / GraphQL) for orders, products and customers."),
             R("native", "Admin exports (CSV) for orders, products and customers."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "quickbooks", name: "QuickBooks", vendor: "Intuit", track: "both", confidence: "VERIFIED",
    classes: ["Accounting", "Payroll / HR"],
    routes: [R("api", "Published API for accounting and payroll data."),
             R("native", "Built-in report exports."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "xero", name: "Xero", vendor: "Xero", track: "both", confidence: "VERIFIED",
    classes: ["Accounting"],
    routes: [R("api", "Published API for invoices, accounts and contacts."),
             R("native", "Built-in report exports."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "adp", name: "ADP", vendor: "ADP, Inc.", track: "both", confidence: "VERIFIED",
    classes: ["Payroll / HR"],
    routes: [R("api", "Published API programme for worker and payroll data."),
             R("native", "Built-in report exports."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "gusto", name: "Gusto", vendor: "Gusto", track: "both", confidence: "PATTERN",
    classes: ["Payroll / HR"], routes: NATIVE_FIRST },
  { id: "paychex", name: "Paychex", vendor: "Paychex", track: "both", confidence: "PATTERN",
    classes: ["Payroll / HR"], routes: NATIVE_FIRST },
  { id: "salesforce", name: "Salesforce", vendor: "Salesforce", track: "both", confidence: "VERIFIED",
    classes: ["CRM"],
    routes: [R("api", "Published REST / Bulk APIs are a core platform capability."),
             R("native", "Report and list-view exports."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "hubspot", name: "HubSpot", vendor: "HubSpot", track: "both", confidence: "VERIFIED",
    classes: ["CRM"],
    routes: [R("api", "Published CRM APIs for objects and associations."),
             R("native", "Built-in export tools for lists and reports."),
             R("sftp", "Scheduled file export where configured.")] },
  { id: "servicetitan", name: "ServiceTitan", vendor: "ServiceTitan", track: "non-medical", confidence: "PATTERN",
    classes: ["Field service", "Scheduling", "CRM"], routes: NATIVE_FIRST },
  { id: "jobber", name: "Jobber", vendor: "Jobber", track: "non-medical", confidence: "PATTERN",
    classes: ["Field service", "Scheduling"], routes: NATIVE_FIRST },
  { id: "mindbody", name: "Mindbody", vendor: "Mindbody", track: "non-medical", confidence: "PATTERN",
    classes: ["Booking / scheduling", "Payments"], routes: NATIVE_FIRST },
  { id: "vagaro", name: "Vagaro", vendor: "Vagaro", track: "non-medical", confidence: "PATTERN",
    classes: ["Booking / scheduling", "POS", "Payments"], routes: NATIVE_FIRST },
  { id: "pdi", name: "PDI (Envoy / back-office)", vendor: "PDI Technologies", track: "non-medical", confidence: "PATTERN",
    classes: ["Convenience / fuel back-office", "Accounting"], routes: NATIVE_FIRST },
  { id: "gilbarco-passport", name: "Gilbarco Passport", vendor: "Gilbarco Veeder-Root", track: "non-medical", confidence: "PATTERN",
    classes: ["Convenience / fuel back-office", "POS"], routes: NATIVE_FIRST },
  { id: "verifone", name: "Verifone (Commander / Ruby)", vendor: "Verifone", track: "non-medical", confidence: "PATTERN",
    classes: ["Convenience / fuel back-office", "POS", "Payments"], routes: NATIVE_FIRST },
  { id: "oracle-micros", name: "Oracle MICROS", vendor: "Oracle", track: "non-medical", confidence: "PATTERN",
    classes: ["Restaurant POS", "Payments"], routes: NATIVE_FIRST },
  { id: "aloha-ncr", name: "Aloha / NCR Voyix", vendor: "NCR Voyix", track: "non-medical", confidence: "PATTERN",
    classes: ["Restaurant POS", "POS", "Payments"], routes: NATIVE_FIRST },

  /* ---------------- Generic fallback ---------------- */
  { id: "custom-other", name: "Custom / other system", vendor: "—", track: "both", confidence: "PATTERN",
    classes: [],
    routes: [R("native", "Start from whatever reporting or export the system itself offers."),
             R("api", "If the vendor publishes an API, read through it under a read-only credential."),
             R("sftp", "Recurring report files over a secure channel."),
             R("vendor", "Vendor-assisted extract under the operator's authorization — the last resort for legacy systems without export tooling.")] }
];

/* A system entry with its assembled starter mapping profile. */
export function withProfile(system) {
  return { ...system, mappingProfile: profileFor(system) };
}

export const SEED_CATALOG = SEED_SYSTEMS.map(withProfile);

/* ------------------------------------------------------------------ */
/* Sanitizer for operator-added systems. A custom entry can never    */
/* claim VERIFIED — IEC has not verified it; the operator asserts    */
/* its classes and routes.                                           */
/* ------------------------------------------------------------------ */

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const TRACKS = ["medical", "non-medical", "both"];
const CLASS_NAMES = Object.keys(CLASS_PROFILES);

export function sanitizeCustomSystem(input) {
  if (!input || typeof input !== "object") return null;
  const name = str(input.name, 60);
  if (!name) return null;
  const classes = Array.isArray(input.classes)
    ? [...new Set(input.classes.map(c => str(c, 40)).filter(c => CLASS_NAMES.includes(c)))].slice(0, 5)
    : [];
  const kinds = Array.isArray(input.routes)
    ? [...new Set(input.routes.map(r => str(typeof r === "string" ? r : r && r.kind, 20)).filter(k => ROUTE_LABEL[k]))]
    : ["native", "vendor"];
  const routes = (kinds.length ? kinds : ["native", "vendor"])
    .sort((a, b) => (ROUTE_KINDS.find(r => r.kind === a)?.order || 9) - (ROUTE_KINDS.find(r => r.kind === b)?.order || 9))
    .map(kind => ({ kind, note: "Operator-supplied route — asserted by the operator, not verified by IEC." }));
  const id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!id || id === "custom-") return null;
  return withProfile({
    id,
    name,
    vendor: str(input.vendor, 60) || "Operator-supplied",
    track: TRACKS.includes(input.track) ? input.track : "both",
    confidence: "PATTERN",
    custom: true,
    classes,
    routes
  });
}

export const _internals = { CLASS_PROFILES, ROUTE_KINDS, sanitizeCustomSystem, profileFor };
