export const WORLD_MODEL_UI_INGRESS_VALUES = Object.freeze([
  'Species-A',
  'Value-A species description',
  'Type-A',
  'Value-A type description',
  'Value-A cycle',
  'Value-A maturation',
  'Value-A special rule',
  'Value-A mechanism',
  'Value-A pathway',
  'Value-A rule',
  'Value-A evidence',
  'Value-A medical evidence',
  'Value-A exception',
  'Value-A unknown',
  'possible_biological_change',
])

export function createWorldModelUiIngressFixture() {
  return {
    schema_version: 1,
    species: [{
      name: 'Species-A',
      description: 'Value-A species description',
      biological_types: [{
        name: 'Type-A',
        description: 'Value-A type description',
        capabilities: {
          can_produce_sperm: false,
          can_produce_ova: true,
          can_be_fertilized: true,
          can_fertilize: false,
          can_cause_pregnancy: false,
          can_carry_pregnancy: true,
        },
        reproduction_rules: {
          fertilization: 'Value-A fertilization',
          pregnancy_or_carrying: 'Value-A carrying',
          cycle: 'Value-A cycle',
          ovulation: 'Value-A ovulation',
          gestation: 'Value-A gestation',
          labor: 'Value-A labor',
        },
        lifecycle: {
          maturation: 'Value-A maturation',
          aging: 'Value-A aging',
        },
        special_rules: ['Value-A special rule'],
        reproductive_mechanisms: [{
          key: 'value-a-mechanism',
          label: 'Value-A mechanism',
          pathway: 'Value-A pathway',
          carrying_compatibility: true,
          world_model_rule_refs: ['Value-A rule'],
          evidence: ['Value-A evidence'],
        }],
      }],
    }],
    medical_context: {
      childbirth_difficulty: 'Value-A childbirth difficulty',
      care_level: 'Value-A care level',
      evidence: 'Value-A medical evidence',
    },
    exceptions: [{
      statement: 'Value-A exception',
      applies_to: 'Species-A',
      evidence: 'Value-A exception evidence',
    }],
    unknowns: ['Value-A unknown'],
    projection_rules: [{
      schema_version: 1,
      mechanism_key: 'value-a-mechanism',
      development_concern_key: 'value-a-concern',
      development_kind: 'possible_biological_change',
      trigger: {
        kind: 'story_time_reached',
        target_story_time: {day_index: 10},
      },
    }],
  }
}
