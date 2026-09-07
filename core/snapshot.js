export function shouldSnapshot(currentFloor,lastSnapshotFloor,interval=3,majorEvent=false){ if(majorEvent)return true; if(lastSnapshotFloor==null)return currentFloor>=interval; return currentFloor-lastSnapshotFloor>=interval; }
export function restoreFromSnapshot(snapshot, survivingEvents, reducer, extra={}) { return reducer({snapshot,events:survivingEvents,...extra}); }
