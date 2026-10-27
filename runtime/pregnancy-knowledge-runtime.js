import {reduceState} from '../core/state.js';
import {normalizeCharacterRegistry} from '../core/identity.js';
import {buildPregnancyKnowledgeSnapshot, mergePregnancyKnowledgeSnapshots, projectPregnancyKnowledgeForPrompt} from '../core/pregnancy-knowledge.js';

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function narrativeFrom(input = {}) {
  return [input?.current_floor?.narrative ?? '', ...(Array.isArray(input?.recent_context) ? input.recent_context.map(item => item?.content ?? item?.narrative ?? '') : [])].filter(Boolean).join('\n');
}
function fingerprint(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}
function matchesNames(candidate, entity) {
  const wanted = [candidate?.display_name, ...(candidate?.aliases ?? [])].map(text).filter(Boolean);
  const names = [entity?.display_name, ...(entity?.aliases ?? [])].map(text).filter(Boolean);
  return wanted.some(name => names.includes(name));
}
function explicitKnowledge(observation, narrative) {
  const value = text(observation);
  // The model contract decides whether this excerpt establishes explicit
  // awareness. Host validation only proves that it is an exact excerpt from
  // the current narrative; keyword reclassification would reject valid
  // world-specific wording and misread surrounding negation.
  return Boolean(value && narrative.includes(value));
}

export function createPregnancyKnowledgeRuntime({persistence, trace = () => {}} = {}) {
  if (!persistence || typeof persistence.getSnapshot !== 'function' || typeof persistence.saveSnapshot !== 'function') throw new TypeError('PREGNANCY_KNOWLEDGE_PERSISTENCE_REQUIRED');

  async function processCandidates({target, analysisInput, candidates = [], events = [], execution = null} = {}) {
    const registry = normalizeCharacterRegistry(analysisInput?.character_registry);
    const entities = Object.values(registry.entities ?? {});
    const narrative = narrativeFrom(analysisInput);
    const currentState = reduceState({events});
    const additions = [];
    const diagnostics = [];
    for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
      const subjectMatches = entities.filter(entity => matchesNames(candidate?.pregnant_character, entity));
      const knowerMatches = entities.filter(entity => matchesNames(candidate?.knower, entity));
      if (subjectMatches.length !== 1 || knowerMatches.length !== 1) {
        diagnostics.push({index, reason_code: subjectMatches.length !== 1 ? 'subject_ambiguous_or_missing' : 'knower_ambiguous_or_missing'});
        continue;
      }
      const subject = subjectMatches[0];
      const knower = knowerMatches[0];
      if (!explicitKnowledge(candidate.observation, narrative)) {
        diagnostics.push({index, subject_id: subject.character_id, knower_id: knower.character_id, reason_code: 'observation_not_explicit'});
        continue;
      }
      const episodes = currentState.characters?.[subject.character_id]?.pregnancy?.episodes ?? {};
      const confirmed = Object.values(episodes).filter(episode => episode?.status === 'confirmed' && text(episode?.pregnancy_id));
      if (confirmed.length !== 1) {
        diagnostics.push({index, subject_id: subject.character_id, reason_code: confirmed.length ? 'confirmed_pregnancy_ambiguous' : 'confirmed_pregnancy_not_found'});
        continue;
      }
      const episode = confirmed[0];
      additions.push({
        subject_id: subject.character_id,
        pregnancy_id: episode.pregnancy_id,
        knowers: [{character_id: knower.character_id, learned_at_floor_version: target.version, evidence_fingerprint: fingerprint({observation: candidate.observation})}],
        updated_at_floor_version: target.version,
      });
    }
    if (!additions.length) {
      trace({stage: 'PREGNANCY_KNOWLEDGE_CANDIDATES', status: 'no_qualified_candidates', accepted_count: 0, rejected_count: diagnostics.length});
      return {status: 'unchanged', diagnostics, additions: []};
    }
    const previous = await persistence.getSnapshot({chatId: target.version.chat_id, endpointIndex: target.index, endpointFloor: target.version.floor});
    const next = mergePregnancyKnowledgeSnapshots(previous, additions, target.version);
    const previousText = JSON.stringify(previous ?? null);
    const nextText = JSON.stringify(next);
    if (previousText === nextText) {
      trace({stage: 'PREGNANCY_KNOWLEDGE_READBACK', status: 'unchanged', accepted_count: additions.length, rejected_count: diagnostics.length});
      return {status: 'unchanged', diagnostics, additions};
    }
    const saved = await persistence.saveSnapshot({ownerFloor: {message_index: target.index, message_id: target.version.message_id}, floorVersion: target.version, snapshot: next, mergeEntries: true});
    trace({stage: 'PREGNANCY_KNOWLEDGE_READBACK', status: saved.status, accepted_count: additions.length, rejected_count: diagnostics.length});
    return {status: 'saved', diagnostics, additions, snapshot: saved.snapshot};
  }

  async function getPromptProjection({snapshot, registry, events = null}) {
    return projectPregnancyKnowledgeForPrompt(snapshot, registry, events);
  }

  return {processCandidates, getPromptProjection, buildSnapshot: buildPregnancyKnowledgeSnapshot};
}
