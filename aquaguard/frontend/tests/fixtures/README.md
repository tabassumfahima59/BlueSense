# Frontend test fixtures

`mocks/*.json` are API responses captured in Phase 0 from the backend (sample snapshot, values flagged `isSample`).
Since P4 (decision 5) they are **test fixtures only**: the app has no mock mode and never loads them at runtime.
They are kept unchanged for contract tests and offline component work.
