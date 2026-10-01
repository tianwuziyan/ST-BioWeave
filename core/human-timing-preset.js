import {normalizeCharacterTimingConfig} from './character-timing-config.js'

export const HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION = 'human-narrative-v1'
export const HUMAN_PRECONFIRMATION_TIMING_PRESET_CLASSIFICATION = 'PRODUCT_POLICY_CONSERVATIVE_NARRATIVE_PRESET'

const HUMAN_PRECONFIRMATION_TIMING_PRESET = Object.freeze({
  schema_version: 1,
  config_version: 1,
  base_min_story_days: 14,
  base_max_story_days: 42,
  variance_ratio: 0.10,
  variance_cap_story_days: 3,
  total_adjustment_cap_story_days: 3,
})

export function getHumanPreconfirmationTimingPreset() {
  return normalizeCharacterTimingConfig(HUMAN_PRECONFIRMATION_TIMING_PRESET)
}
