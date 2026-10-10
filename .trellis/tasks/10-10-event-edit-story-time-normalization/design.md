# Technical Design

## Boundaries

UI 只收集业务事实文本和有限枚举；Runtime 是唯一的 Event edit ingress；
`story/time.js` 是唯一 Story Time 标准化 facade；`core/events.js` 负责 normalize /
validate；Floor persistence 与 Resolver 保持原所有权；Tracking/Health/Projection/UI
均为保存后的消费者。

## Data flow

```text
structured Event form
  -> {type, status, location, story_time.display}
  -> runtime.updateEvent(eventId, patch)
  -> resolve current complete Event state
  -> parseStoryTimeCandidate/display through injected Story Time facade
  -> normalizeEvent + identity/collection/time validation
  -> mutation token + commitFloorPatch(event)
  -> authoritative readback / clear invalidation
  -> refreshTrackingRegistry + app refreshBusinessState
  -> Event / Tracking Window / Registry / Health / Projection / Debug DTO
```

The edit path must distinguish an edited display-only Story Time from a caller that
supplies an already canonical internal object. For the former, construct a fresh object
from the parsed candidate and never spread the old derived fields into it. The exact
incomparability behavior remains the existing diagnostic-only contract unless the formal
parser fails completely; complete parser failure rejects the write.

## Editable/read-only contract

- Editable: existing Event type enum, existing status enum, location text, Story Time
  display text.
- Read-only presentation: Event ID, source/provenance, participants and canonical IDs,
  pregnancy relevance and derived subject/counterpart references, event judgment confidence,
  evidence text/source relationship, all Story Time derived fields.
- If repository evidence reveals a pre-existing safe participant selector during
  implementation, it may be wired without changing the identity contract; otherwise no new
  identity editor is introduced.

## Compatibility and failure behavior

Keep all existing `data-bioweave-*` action/field hooks that tests or host delegation use,
but change their values from JSON editors to ordinary controls. Runtime errors must be mapped
to explicit UI messages, including invalid Story Time and `EVENT_STORY_TIME_AFTER_CURRENT`.
No success notification or refresh occurs before the Runtime write resolves.

## Rollback and risk

Changes are limited to Event UI, edit ingress normalization, tests and affected docs/spec.
Do not alter existing Floor coordinator or window algorithm. If a new test exposes a mismatch
in the formal parser, stop at the smallest adapter boundary and preserve the existing parser
semantics; do not add a parallel regex/table.
