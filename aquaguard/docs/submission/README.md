# BlueSense submission package

Track: **Idea to Unicorn**, confirmed by the project owner. Repository: [tabassumfahima59/BlueSense](https://github.com/tabassumfahima59/BlueSense). Prepared 17 November 2026.

This package supplies drafts and evidence for the fetched CloudCamp BD rules. It is **not ready for final submission**: the original build prompt/transcript is unavailable, the applicable deadline or extension is unconfirmed, several public artifacts are missing and technical failures remain in the current audit.

## Artifacts

| File | Purpose and status |
|---|---|
| [Reconstructed master prompt](MASTER_PROMPT_RECONSTRUCTED.md) | Eight required sections; retrospective draft, not the original and not executed |
| [Runtime Copilot prompt](COPILOT_SYSTEM_PROMPT.txt) | Exact prompt recovered from current code; not the build master prompt |
| [Development record](DEVELOPMENT_RECORD.md) | Non-verbatim evidence summary, with actual Git history references |
| [Transcript recovery and capture guide](TRANSCRIPT_GUIDE.md) | Recover genuine history or capture an organizer-approved fresh run |
| [Execution record template](execution_record_template.json) | Empty template with no fabricated messages or timestamps |
| [Submission form draft](FORM_DRAFT.md) / [structured fields](submission_form.json) | All 22 official fields, character counts, evidence and unresolved values |
| [Pitch deck outline](PITCH_DECK.md) | Nine slides and presenter notes; product/market hypotheses are labelled |
| [Submission video script](VIDEO_SCRIPT.md) | 2:45 narration and screen sequence; not a recorded/uploaded video |
| [Evidence matrix](EVIDENCE_MATRIX.md) | Mandatory requirements, truthful technology claims and missing deliverables |
| [Release checklist](RELEASE_CHECKLIST.md) | Publication, evidence and final portal tasks |
| [Organizer clarification draft](ORGANIZER_CLARIFICATION.md) | Unsent draft concerning history, deadline and scoring ambiguities |
| [Evidence snapshot](evidence_snapshot.json) | Actual local HEAD/branch, source-prompt hashes and recent commits |
| [Artifact manifest](artifact_manifest.json) | SHA-256 integrity of prepared package files |
| [Validation report](validation_report.json) | Draft integrity, field lengths, URL shape and unresolved release blockers |

## Local validation

From `aquaguard/`:

```powershell
.\.venv\Scripts\python.exe docs/submission/validate_submission.py
.\.venv\Scripts\python.exe docs/submission/validate_submission.py --require-ready
```

The default checks draft integrity and prints remaining blockers. `--require-ready` also fails when required links, team facts or evidence are missing. Neither mode certifies eligibility, proves feature implementation or checks live links. Manifest hashes identify this preparation snapshot; after intentional artifact edits, regenerate the manifest using the validator's explicit `--refresh-manifest` option and retain an explanation in version control. That operation records file integrity, not execution provenance.

After editing `submission_form.json`, use `--render-form --refresh-manifest` to regenerate the readable form and its integrity record. Do not place private registration documents or sensitive personal information in this public package; use non-sensitive evidence references.

## Completion order

1. Recover any authentic original prompt/history, or obtain organizer acceptance of a reconstruction or a fresh run. Confirm the applicable round and deadline; the fetched preliminary deadline was 31 October 2026.
2. Resolve current data/test and mandatory-feature gaps in [the source-based alignment](../CLOUDCAMP_SUBMISSION.md) and [technical audit](../SUBMISSION_AUDIT.md).
3. Replace missing links and team facts in `submission_form.json`. Do not infer membership or demographic status from repository ownership.
4. Publish the reviewed source revision, correct the unrelated GitHub About description, verify live/design/evidence access and record/upload the video. Prepared scripts and outlines alone do not satisfy these deliverables.
5. Refresh this evidence package and verify the actual portal form before submitting. Nothing has been pushed, uploaded, sent to organizers or submitted by this preparation.
