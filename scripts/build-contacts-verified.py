#!/usr/bin/env python3
"""Build the verified, deduplicated contacts master for the IEC Suite Desk.

Reads  desk/data/contacts-unified.json  (the raw merged CRM export — untouched)
Writes desk/data/contacts-verified.json (deduped master the Desk counts/loads)
       desk/data/contacts-verified-audit.json (what was merged / flagged)

Dedupe policy — merge ONLY true duplicates (union-find over record indices):
  two records link when
    * they share the same normalized email (trim + lowercase), OR
    * they share the same normalized phone (digits only, last 10)
      AND the same normalized name (trim + lowercase + collapsed spaces).

Shared-phone groups whose names DIFFER are NOT merged — different people can
share a phone (family / office line). Every record carrying such a phone is
flagged with  "dup_flag": "shared-phone — verify"  for a human to check.

Merge rules for a group:
  * base record = the one with an email, else the one with the longest notes,
    else the first in group order;
  * fields are then taken in base-first order: first non-empty value wins;
  * tags are unioned (comma-split, trimmed, deduped, order preserved);
  * distinct non-empty notes are joined with " | ";
  * if merged records carry different non-empty companies, the base company
    is kept and each other company is appended to notes as "Also: <company>".

Run from the repo root:  python3 scripts/build-contacts-verified.py
"""

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "desk" / "data" / "contacts-unified.json"
OUT = REPO / "desk" / "data" / "contacts-verified.json"
AUDIT = REPO / "desk" / "data" / "contacts-verified-audit.json"

FIELDS = ["name", "email", "phone", "company", "tags", "notes", "source", "category"]
FLAG_TEXT = "shared-phone — verify"


def norm_email(v):
    return (v or "").strip().lower()


def norm_phone(v):
    digits = re.sub(r"\D", "", v or "")
    return digits[-10:] if digits else ""


def norm_name(v):
    return re.sub(r"\s+", " ", (v or "").strip().lower())


class DSU:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def main():
    records = json.loads(SRC.read_text(encoding="utf-8"))
    n = len(records)
    emails = [norm_email(r.get("email")) for r in records]
    phones = [norm_phone(r.get("phone")) for r in records]
    names = [norm_name(r.get("name")) for r in records]

    dsu = DSU(n)

    # Link: same normalized email.
    by_email = {}
    for i, e in enumerate(emails):
        if e:
            by_email.setdefault(e, []).append(i)
    for idxs in by_email.values():
        for i in idxs[1:]:
            dsu.union(idxs[0], i)

    # Link: same normalized phone AND same normalized name.
    by_phone_name = {}
    for i in range(n):
        if phones[i] and names[i]:
            by_phone_name.setdefault((phones[i], names[i]), []).append(i)
    for idxs in by_phone_name.values():
        for i in idxs[1:]:
            dsu.union(idxs[0], i)

    # Shared-phone groups (names differ) — flag, never merge.
    by_phone = {}
    for i in range(n):
        if phones[i]:
            by_phone.setdefault(phones[i], []).append(i)
    shared_phone_groups = []
    shared_phones = set()
    for phone, idxs in by_phone.items():
        distinct_names = sorted({records[i].get("name", "") for i in idxs if names[i]})
        if len({names[i] for i in idxs if names[i]}) > 1:
            shared_phones.add(phone)
            shared_phone_groups.append({"phone": phone, "names": distinct_names})
    shared_phone_groups.sort(key=lambda g: g["phone"])

    # Collect groups.
    groups = {}
    for i in range(n):
        groups.setdefault(dsu.find(i), []).append(i)

    out_records = []
    merged_groups = []
    flagged = 0

    for root in sorted(groups, key=lambda r: min(groups[r])):
        idxs = sorted(groups[root])
        if len(idxs) == 1:
            rec = dict(records[idxs[0]])
        else:
            # Base-first order: email first, then longest notes, then group order.
            def base_key(i):
                return (0 if emails[i] else 1, -len(records[i].get("notes") or ""), i)

            ordered = sorted(idxs, key=base_key)
            base = records[ordered[0]]
            rec = {}
            for f in FIELDS:
                if f in ("tags", "notes"):
                    continue
                val = ""
                for i in ordered:
                    v = (records[i].get(f) or "").strip()
                    if v:
                        val = records[i].get(f)
                        break
                rec[f] = val
            # Tags: union, order preserved.
            seen_tags, tags = set(), []
            for i in ordered:
                for t in (records[i].get("tags") or "").split(","):
                    t = t.strip()
                    if t and t.lower() not in seen_tags:
                        seen_tags.add(t.lower())
                        tags.append(t)
            rec["tags"] = ",".join(tags)
            # Notes: distinct non-empty, joined.
            seen_notes, notes = set(), []
            for i in ordered:
                v = (records[i].get("notes") or "").strip()
                if v and v not in seen_notes:
                    seen_notes.add(v)
                    notes.append(v)
            # Different companies: keep base company, append others to notes.
            companies = []
            for i in ordered:
                c = (records[i].get("company") or "").strip()
                if c and c not in companies:
                    companies.append(c)
            kept_company = (base.get("company") or "").strip()
            if kept_company:
                rec["company"] = base.get("company")
                others = [c for c in companies if c != kept_company]
            else:
                others = companies[1:] if len(companies) > 1 else []
            for c in others:
                notes.append(f"Also: {c}")
            rec["notes"] = " | ".join(notes)
            # Reorder fields to the canonical order.
            rec = {f: rec.get(f, "") for f in FIELDS}
            # Audit entry for this merge.
            key = next((emails[i] for i in ordered if emails[i]), "")
            if not key:
                key = f"{phones[ordered[0]]}|{names[ordered[0]]}"
            merged_groups.append({
                "key": key,
                "names": sorted({records[i].get("name", "") for i in idxs}),
                "emails": sorted({emails[i] for i in idxs if emails[i]}),
                "phones": sorted({phones[i] for i in idxs if phones[i]}),
            })
        # Flag records on a shared (mixed-name) phone.
        if norm_phone(rec.get("phone")) in shared_phones:
            rec["dup_flag"] = FLAG_TEXT
            flagged += 1
        out_records.append(rec)

    OUT.write_text(json.dumps(out_records, ensure_ascii=False, indent=1), encoding="utf-8")
    audit = {
        "built_from": "contacts-unified.json",
        "input_records": n,
        "output_records": len(out_records),
        "merged_groups": merged_groups,
        "merged_away_count": n - len(out_records),
        "shared_phone_flagged_records": flagged,
        "shared_phone_groups": shared_phone_groups,
    }
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"input={n} output={len(out_records)} merged_away={n - len(out_records)} "
          f"merged_groups={len(merged_groups)} flagged={flagged} "
          f"shared_phone_groups={len(shared_phone_groups)}")


if __name__ == "__main__":
    main()
