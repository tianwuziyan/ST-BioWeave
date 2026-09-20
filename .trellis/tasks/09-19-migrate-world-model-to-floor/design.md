# Technical design

## Ownership boundary

`storage/store.js` remains the only business boundary for Floor persistence. `emptyFloor()` gains the two World Model fields. `emptyChat()` stops defining them as normal state slots; any legacy fields encountered in old metadata are treated as ignored compatibility residue and never returned as a runtime World Model source.

This migration does not merge the World Model domain with Character/Event Analysis. Floor Store is shared infrastructure only. The dependency direction is:

```text
             Floor infrastructure
                    |
        +-----------+-----------+
        |                       |
   World Model             Character / Event
```

World Model owns world rules, species, biological types, capability baselines,
reproduction/lifecycle/special rules, medical/world context, its own prompt,
parser, normalizer, evidence guard, Floor persistence and World resolver.
Character/Event owns character identity, Character Registry, profile/context,
participant resolution, BiologicalEvent, Tracking Subject/Candidate, and its
own prompt/parser/normalizer/validation. Event Analysis may consume an already
resolved World Model DTO as input; Character/Event code may not own, rewrite or
redefine World Model.

The authoritative chain is:

```text
message -> active swipe -> extra.bioweave -> world_model/world_model_meta
```

The resolver operates on the current host message collection, active Swipe, exact Floor slot, complete current Floor Version, and existing invalidation/reset rules. It must not use Chat metadata, runtime cache, registry, or future messages.

World Model resolvers belong to the World/Floor resolution boundary. Character
Registry previous-snapshot resolution remains independent. If identical
mechanical scanning is reused, extract only a business-neutral
`findPreviousValidFloor`-style primitive; do not create a resolver that
understands World Model, Events, analysis and Character Registry together.

## Resolver and call semantics

Add a small resolver beside the existing Floor/path helpers, exposed through the runtime API for UI and reused by Event Analysis. It accepts a target message/Floor and a mode or explicit boundary:

- current-view mode scans target through older current-path Floors, allowing the target's own valid Floor;
- historical-input mode scans strictly before target, matching the existing `findPreviousSuccessfulBioWeave()` semantics and preventing a target's stale/old model from entering its own Event Analysis input.

Each candidate must still exist, have a valid active Swipe slot, resolve to the current complete Floor Version, not be invalidated/reset, and have a non-null `world_model`. Return a cloned `{ model, meta, floor_version }` or null.

## Save path

Create one runtime/store-facing helper that captures the current Chat token, resolves the current active Floor, verifies the target remains current, reads the current Floor through `getFloor()`, writes only model and metadata through `saveFloor()` while preserving analysis/events/registry/history/snapshot/projections, and rechecks token/version after save.

AI analysis and manual section save call this helper. UI state remains transient/read projection; `worldModelState` is not a persistence owner.

Character/Event persistence remains separate: its save path may update only
`analysis`, `events`, and `character_registry`, while preserving valid
`world_model` and `world_model_meta`. No combined World + Character save/update
helper is introduced.

## Event Analysis integration

Replace `chatData.world_model` in `buildFloorAnalysisInput()` with the strict historical resolver result. Keep the normal `world_model` field in the generated analysis DTO. Existing `existing_bioweave` remains Floor-derived and independent.

## Legacy strategy

No automatic migration is performed because old Chat metadata has no reliable owning Floor identity. It is not used as fallback, not copied to current末楼, and not dual-written. Normalized Chat reads omit legacy World Model fields from the runtime shape; a legacy fixture can remain physically untouched until the next ordinary Chat metadata save or explicit clear, but it cannot influence runtime state. Tests must prove both no guessing and no new Chat writes.

## Lifecycle and documentation

Update lifecycle registry/schema documentation so World Model is classified as Floor domain. Chat World Model clear behavior is removed as a normal ownership path; clearing World data must invalidate/clear Floor-owned World Model fields according to the existing Floor walker, without inventing a parallel history. Update Floor State Ownership, Data Lifecycle, README, DATA-MODEL and relevant UI/reference wording.

## Failure and rollback shape

No destructive migration is needed. If implementation validation fails, revert only this task's files. Runtime failure before confirmed Floor save leaves the previous Floor slot intact; stale Chat/Floor/version checks prevent late writes.

## Ownership regression matrix

- Existing `{world_model: W1, events: E1, character_registry: C1}` plus Character/Event analysis update => `world_model === W1` and metadata unchanged.
- Same fixture plus World Model AI/manual update => `events === E1` and `character_registry === C1`.
- Character Registry/tracking rebuild => no `world_model` or `world_model_meta` write.
- World Model manual edit => no analysis/Event/registry write.
- Only explicit full Floor lifecycle invalidation may clear multiple business-owned Floor fields together; ordinary domain saves preserve unrelated fields.
