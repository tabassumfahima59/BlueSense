"""Validate local submission drafts; this cannot certify event eligibility or feature claims."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

BASE = Path(__file__).resolve().parent
EXPECTED_FIELDS = {
    "project_title", "tagline", "youtube_url", "github_url", "live_demo_url", "design_url", "other_links",
    "access_note", "team_members", "nrb_member", "female_member", "prompt_strategy", "token_optimization",
    "ai_dlc", "agent_orchestration", "fine_tuning_adaptation", "evaluation_quality", "guardrails", "tunneling",
    "data_quality", "privacy_compliance", "lineage_observability",
}
MINIMUMS = {
    "token_optimization": 50, "ai_dlc": 100, "agent_orchestration": 80, "fine_tuning_adaptation": 80,
    "evaluation_quality": 80, "guardrails": 80, "tunneling": 80, "data_quality": 80,
    "privacy_compliance": 80, "lineage_observability": 80,
}
ARTIFACTS = [
    "README.md", "MASTER_PROMPT_RECONSTRUCTED.md", "COPILOT_SYSTEM_PROMPT.txt", "DEVELOPMENT_RECORD.md",
    "TRANSCRIPT_GUIDE.md", "execution_record_template.json", "submission_form.json", "FORM_DRAFT.md",
    "PITCH_DECK.md", "VIDEO_SCRIPT.md", "ARCHITECTURE_DIAGRAM.mmd", "EVIDENCE_MATRIX.md",
    "ORGANIZER_CLARIFICATION.md", "RELEASE_CHECKLIST.md", "evidence_snapshot.json", "validate_submission.py",
]
MANIFEST = BASE / "artifact_manifest.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid_url(value: object, key: str = "") -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    if any(marker in value.lower() for marker in ("your-frontend", "example.com", "<", ">", "todo", "placeholder")):
        return False
    if key == "github_url":
        return host == "github.com" and len(parsed.path.strip("/").split("/")) == 2
    if key == "youtube_url":
        return host in {"youtube.com", "www.youtube.com", "youtu.be"} and bool(parsed.path.strip("/"))
    return True


def render_form() -> None:
    form = json.loads((BASE / "submission_form.json").read_text(encoding="utf-8"))
    lines = ["# BlueSense submission form draft", "", f"Track: **{form['track']}**. Draft only; "
             "missing fields and eligibility remain unresolved. Structured values come from submission_form.json.", "",
             "Text length does not establish implementation points or organizer acceptance.", ""]
    for field in form["fields"].values():
        value = field.get("value")
        if value is None:
            rendered = "Missing — supply actual evidence."
        elif value == []:
            rendered = "No values supplied."
        elif isinstance(value, (list, dict)):
            rendered = "```json\n" + json.dumps(value, ensure_ascii=False, indent=2) + "\n```"
        else:
            rendered = str(value)
        lines.extend(["## " + field["label"], "", rendered, ""])
        if isinstance(value, str):
            minimum = field.get("minimum_characters")
            note = f"; stated minimum: **{minimum}**." if minimum else "; no numeric minimum stated."
            lines.extend([f"Character count: **{len(value)}**" + note, ""])
        if field.get("evidence"):
            links = [f"[{Path(p).name}]({p})" for p in field["evidence"]]
            lines.extend(["Evidence: " + ", ".join(links), ""])
    lines.extend(["## Technology disclosures", "", "```json",
                  json.dumps(form["technology_disclosures"], ensure_ascii=False, indent=2), "```", "",
                  "Use only demonstrated selections. Proposed supporting links include the published model card, "
                  "architecture and final evaluation report, once verified at the submitted revision.", ""])
    (BASE / "FORM_DRAFT.md").write_text("\n".join(lines), encoding="utf-8")


def validate() -> dict:
    errors, blockers, counts = [], [], {}
    form = json.loads((BASE / "submission_form.json").read_text(encoding="utf-8"))
    fields = form["fields"]
    if set(fields) != EXPECTED_FIELDS:
        errors.append("Form must contain exactly the 22 fields listed in the retrieved guide.")
    if form.get("track") != "Idea to Unicorn":
        errors.append("Track does not match the user's confirmed registration.")
    for name in ARTIFACTS:
        if not (BASE / name).is_file():
            errors.append(f"Missing package artifact: {name}")
    for key, field in fields.items():
        value = field.get("value")
        if field.get("required_by_guide") and (value is None or value == "" or value == []):
            blockers.append(f"Required field is missing: {key}")
        if key in MINIMUMS:
            if not isinstance(value, str) or len(value) < MINIMUMS[key]:
                errors.append(f"{key} must contain at least {MINIMUMS[key]} characters.")
            counts[key] = {"characters": len(value) if isinstance(value, str) else 0, "minimum": MINIMUMS[key]}
        if key in {"youtube_url", "github_url", "live_demo_url", "design_url"} and value is not None:
            if not valid_url(value, key):
                errors.append(f"Invalid or placeholder URL: {key}")
        for evidence in field.get("evidence", []):
            if not (BASE / evidence).exists():
                errors.append(f"Broken evidence path for {key}: {evidence}")
    other = fields.get("other_links", {}).get("value")
    if not isinstance(other, list) or len(other) > 3 or any(not valid_url(v) for v in other):
        errors.append("other_links must contain at most three non-placeholder HTTPS URLs.")
    members = fields.get("team_members", {}).get("value")
    if not isinstance(members, list) or len(members) > 5:
        errors.append("team_members must be a list with no more than five real registered members.")
    elif members:
        if any(not isinstance(m, dict) or not m.get("name") or not m.get("registration_reference") for m in members):
            errors.append("Each team member needs a name and registration evidence reference.")
    for key in ("nrb_member", "female_member"):
        if fields.get(key, {}).get("value") not in (None, True, False):
            errors.append(f"{key} must be null or an accurate boolean.")
    eligibility = form.get("eligibility", {})
    if not eligibility.get("applicable_round"):
        blockers.append("Applicable submission round/deadline is unconfirmed.")
    # A reconstructed draft or a reference to an empty template does not count as an original transcript.
    has_original = bool(eligibility.get("original_prompt_path") and eligibility.get("original_transcript_path"))
    if not has_original and not eligibility.get("organizer_acceptance_reference"):
        blockers.append("Original execution evidence is unavailable and organizer acceptance is not recorded.")
    for name in ("original_prompt_path", "original_transcript_path"):
        value = eligibility.get(name)
        if value:
            path = (BASE / value).resolve()
            if not path.is_file():
                errors.append(f"Missing claimed original evidence: {name}")
            elif path.name in {"MASTER_PROMPT_RECONSTRUCTED.md", "execution_record_template.json"}:
                errors.append(f"A reconstruction/template cannot serve as original evidence: {name}")
    for key, verified in form.get("release", {}).items():
        if verified is not True:
            blockers.append(f"Release evidence pending: {key}")
    for name in ARTIFACTS:
        if not name.endswith(".md") or not (BASE / name).is_file():
            continue
        text = (BASE / name).read_text(encoding="utf-8")
        for link in re.findall(r"\]\(([^)]+)\)", text):
            if "://" in link or link.startswith("#"):
                continue
            if not (BASE / link.split("#")[0]).exists():
                errors.append(f"Broken local Markdown link in {name}: {link}")
    if not MANIFEST.exists():
        errors.append("Artifact manifest is missing.")
    else:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for name in ARTIFACTS:
            if (BASE / name).is_file() and manifest.get("files", {}).get(name) != digest(BASE / name):
                errors.append(f"Manifest mismatch: {name}")
    return {
        "checked_at": datetime.now(ZoneInfo("Asia/Dhaka")).isoformat(),
        "scope": "Local draft structure, lengths, URL shape, paths and file integrity; no live link or eligibility certification",
        "draft_integrity_passed": not errors,
        "submission_ready": not errors and not blockers,
        "eligibility_verified": False,
        "score": None,
        "field_count": len(fields),
        "minimum_length_checks": counts,
        "errors": errors,
        "blockers": blockers,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-ready", action="store_true", help="Fail if any final submission blocker remains")
    parser.add_argument("--render-form", action="store_true", help="Regenerate form prose from structured field values")
    parser.add_argument("--refresh-manifest", action="store_true",
                        help="Record current draft integrity, not execution provenance")
    args = parser.parse_args()
    if args.render_form:
        render_form()
    if args.refresh_manifest:
        MANIFEST.write_text(json.dumps({
            "kind": "prepared_artifact_integrity_not_execution_proof",
            "files": {name: digest(BASE / name) for name in ARTIFACTS if (BASE / name).is_file()},
        }, indent=2) + "\n", encoding="utf-8")
    report = validate()
    (BASE / "validation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 1 if report["errors"] or (args.require_ready and not report["submission_ready"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
