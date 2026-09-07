import { activeProjections } from '../core/projection.js';
export function buildContext({state,recentEvents=[],projections=[],worldRules={}}){return {current_state:state,relevant_recent_events:recentEvents,active_projections:activeProjections(projections),necessary_world_rules:worldRules};}
export function serializeContext(x){return `[BioWeave]\n${JSON.stringify(x)}\n[/BioWeave]`;}
