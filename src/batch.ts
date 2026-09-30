import {Specimen} from './types';
import {issuesFor} from './data';

export const BATCH_KEY='plant-preflight-batch-v1';
export const LABELS_PER_PAGE=8;
// 批次在本地存储中只有两个状态：空批次（[]）与已编排（去重且保序的非空记录编号序列）
export type BatchCell={specimen:Specimen;pendingIssues:number};
export type BatchPage={index:number;cells:(BatchCell|null)[]};
export type BatchModel={pages:BatchPage[];total:number;totalPending:number;withPending:number};
export type PruneResult={ids:string[];removed:string[]};

export function loadBatch():string[]{
  try{
    const raw=localStorage.getItem(BATCH_KEY);
    if(raw===null)return [];
    const x:unknown=JSON.parse(raw);
    if(!Array.isArray(x)||!x.every(v=>typeof v==='string'))return [];
    return [...new Set(x as string[])];
  }catch{return []}
}
export function saveBatch(ids:string[]){try{localStorage.setItem(BATCH_KEY,JSON.stringify(ids))}catch{}}
/** 加入批次：已存在则保持原位置不增量，否则追加到末尾 */
export const addToBatch=(ids:string[],id:string):string[]=>ids.includes(id)?ids:[...ids,id];
export const removeFromBatch=(ids:string[],id:string):string[]=>ids.filter(x=>x!==id);
/** 清理已不存在的成员并顺带去重；严格保持加入顺序，removed 列出被剔除的失效编号（去重后） */
export function pruneBatch(ids:string[],rows:Specimen[]):PruneResult{
  const alive=new Set(rows.map(r=>r.id));
  const kept:string[]=[];const seen=new Set<string>();const removed:string[]=[];
  for(const id of ids){
    if(!alive.has(id)){if(!removed.includes(id))removed.push(id);continue}
    if(seen.has(id))continue;
    seen.add(id);kept.push(id);
  }
  return {ids:kept,removed};
}
/** 按加入顺序把有效成员确定性排入每页 8 格，末页不足补 null；未知/重复编号不进入模型 */
export function buildBatchModel(ids:string[],rows:Specimen[]):BatchModel{
  const byId=new Map(rows.map(r=>[r.id,r]));
  const pending=new Map<string,number>();
  for(const i of issuesFor(rows)){
    const r=byId.get(i.recordId);
    if(r&&(r.resolutions[i.key]?.status||'pending')==='pending')pending.set(i.recordId,(pending.get(i.recordId)||0)+1);
  }
  const seen=new Set<string>();
  const cells:BatchCell[]=[];
  for(const id of ids){
    const r=byId.get(id);
    if(!r||seen.has(id))continue;
    seen.add(id);
    cells.push({specimen:r,pendingIssues:pending.get(id)||0});
  }
  const pageCount=Math.ceil(cells.length/LABELS_PER_PAGE);
  const pages:BatchPage[]=Array.from({length:pageCount},(_,p)=>({index:p,cells:Array.from({length:LABELS_PER_PAGE},(_,k)=>cells[p*LABELS_PER_PAGE+k]??null)}));
  return {pages,total:cells.length,totalPending:cells.reduce((s,c)=>s+c.pendingIssues,0),withPending:cells.filter(c=>c.pendingIssues>0).length};
}
