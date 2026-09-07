export const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
export const deepClone=x=>structuredClone(x);
export const safeText=x=>String(x??'');
