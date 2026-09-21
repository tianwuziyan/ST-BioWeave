# Floating Launcher Design

## Boundary

The launcher is a Host Entry module. It owns only its DOM, pointer/keyboard
events, position preference, activity subscription, visual state, and cleanup.
It receives `openBioWeave`, activity callbacks, and host dependencies by
injection. It does not import Runtime internals, Storage, Floor, Snapshot,
Event Analysis, World Model, or Projection modules.

## Runtime seam

Runtime owns a small activity coordinator with a `Map` of active task kinds and
the last terminal result/error. The public DTO contains only `busy`,
`active_tasks`, `last_result`, and `last_error`. Runtime task owners call
`startActivity(kind)`/`finishActivity(kind, result, error)` at their existing
AI task boundaries. Event Analysis is wired at its existing start/terminal
paths; World Analysis is wired at its existing request/terminal paths. No
Projection architecture is changed.

## Lifecycle

`index.js` mounts the App, registers the menu and launcher, then awaits
`runtime.init()`. Runtime failure changes the activity/status presentation but
does not unregister either entry. Destroy unregisters the menu and launcher
before destroying App and Runtime; all operations are idempotent.

## Persistence and preferences

Launcher geometry uses the device-local key
`bioweave-floating-launcher-position`. Position is normalized and clamped on
read, resize, and pointerup. Global settings own
`show_floating_launcher` and `floating_launcher_snap_to_edge`; Chat/Floor and
derived business stores are not touched.

## UI contract

The launcher is a fixed, circular, >=44px interactive button using existing
BioWeave theme tokens and `fa-dna`. It has idle/running/success/error states,
accessible labels, `aria-busy`, reduced-motion behavior, keyboard activation,
Pointer Events, a 5px drag threshold, and optional left/right edge snapping.
