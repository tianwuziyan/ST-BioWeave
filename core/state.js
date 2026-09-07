import { sortEvents } from './events.js';
export function reduceState({snapshot=null,events=[],storyTime=null,worldModel=null,characterProfiles={}}={}) {
  const characters = structuredClone(snapshot?.characters ?? {});
  // TODO: 确定性 Reducer。AI 只提取事实，不在这里参与时间/周期/妊娠天数计算。
  return {characters,story_time:storyTime,world_model_version:worldModel?.version??null,processed_events:sortEvents(events).map(x=>x.event_id),profiles_version:Object.keys(characterProfiles).length};
}
