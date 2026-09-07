export function normalizeProjection(p={}) { return {...p,status:p.status??'active',confidence:Math.max(0,Math.min(1,Number(p.confidence??0)))}; }
export function activeProjections(items=[]) { return items.filter(x=>x.status==='active'); }
// Projection 不是事实：删除即从未来 Context 完整移除，不提供 accept 操作。
