# Audit Closure

- Initial symptom: World Model appeared lost after ordinary message lifecycle changes.
- Actual root cause: host message role classification treated SillyTavern's `is_system` hidden/display flag as a semantic system role, causing a valid Character Floor to be rejected as `NO_CHARACTER_FLOOR`.
- Data status: the persisted World Model remained intact; no migration or recovery was required.
- Fix: Character/Floor eligibility and host message role consumers use shared host role normalization.
- Cleanup: `ai/input-builder.js` and `ai/worldbook.js` now consume the shared normalization contract.
- Migration: none.
- Real-host deployment smoke: pending; local validation does not replace testing the installed SillyTavern instance.
