const NARRATOR_TYPE = "narrator";
const COMMENT_TYPE = "comment";

function normalizedRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizedExtraType(message) {
  return normalizedRole(message?.extra?.type);
}

/**
 * Normalize SillyTavern's host message shape into BioWeave's role contract.
 *
 * `is_system` is a hidden/rendering flag in the host, not the authoritative
 * assistant-vs-system role field. Explicit host role markers therefore take
 * precedence, while the legacy `role` field is only a compatibility fallback
 * for synthetic messages that do not contain host-native role fields.
 */
export function normalizeHostMessageRole(message) {
  if (!message || typeof message !== "object") return "other";

  if (message.is_user === true) return "user";

  const type = normalizedExtraType(message);
  if (type === NARRATOR_TYPE) return "system";
  if (type === COMMENT_TYPE) return "other";
  if (type) return "other";

  if (Object.prototype.hasOwnProperty.call(message, "is_user")) {
    return "character";
  }

  const legacyRole = normalizedRole(message.role);
  if (legacyRole === "user") return "user";
  if (legacyRole === "system") return "system";
  if (legacyRole === "assistant" || legacyRole === "character") {
    return "character";
  }

  return "character";
}

export function isCharacterMessageRole(message) {
  return normalizeHostMessageRole(message) === "character";
}
