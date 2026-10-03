# UI Preference Isolation Refactor Design

## Boundary

Keep the existing small realm resolver as an internal dependency of a single
device-local preference implementation. The implementation owns only durable
preference IO; it does not own Theme UI validation/rendering or Launcher
pointer/layout/clamp behavior.

## Proposed API

```js
createDeviceLocalPreferences({documentRef, windowRef, storageRef})
```

Returns:

```js
{
  readTheme,
  writeTheme,
  readLauncherPosition,
  writeLauncherPosition,
}
```

The factory resolves storage once. Raw keys, JSON conversion, exception
handling, verification, and diagnostics remain private to the implementation.

## Composition

`index.js` creates one preferences instance and passes it to both `createApp`
and `registerFloatingLauncher`. Direct feature modules retain their UI-only
responsibilities and receive a small injected port for tests and composition.

## Compatibility

Keep `bioweave_ui_theme`, `bioweave-floating-launcher-position`, and the legacy
absolute `{x,y}` format. No migration or storage mechanism change.

## Explicit non-goals

Do not move viewport geometry, clamp, reclamp, pointer lifecycle, DOM state,
Floor/World/Chat persistence, or SillyTavern settings into the preference port.
