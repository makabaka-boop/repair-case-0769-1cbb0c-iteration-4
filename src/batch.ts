import {Specimen} from './types';
import {issuesFor} from './data';
import {RelationGroup} from './relation';

export const BATCH_KEY='plant-preflight-batch-v1';
export const LABELS_PER_PAGE=8;
// 批次在本地存储中只有两个状态：空批次（[]）与已编排（去重且保序的非空记录编号序列）
export type BatchLayoutMode='sequence'|'grouped';
export type BatchCell={specimen:Specimen;pendingIssues:number;groupIndex?:number};
// 参与同点排版的采集点组（组号沿用关系检查编号），成员为组内实际进入批次的编号，按批次顺序排列
export type BatchGroup={index:number;ids:string[]};
export type BatchPage={index:number;cells:(BatchCell|null)[]};
export type BatchModel={pages:BatchPage[];total:number;totalPending:number;withPending:number;mode:BatchLayoutMode;groups:BatchGroup[]};
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
/** 把去重保序的批次编号解析为标签格；未知/重复编号不进入模型 */
function batchCells(ids:string[],rows:Specimen[]):BatchCell[]{
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
  return cells;
}
function paginate(cells:(BatchCell|null)[]):BatchPage[]{
  const pageCount=Math.ceil(cells.length/LABELS_PER_PAGE);
  return Array.from({length:pageCount},(_,p)=>({index:p,cells:Array.from({length:LABELS_PER_PAGE},(_,k)=>cells[p*LABELS_PER_PAGE+k]??null)}));
}
const summarize=(cells:BatchCell[])=>cells.reduce((m,c)=>({total:m.total+1,totalPending:m.totalPending+c.pendingIssues,withPending:m.withPending+(c.pendingIssues>0?1:0)}),{total:0,totalPending:0,withPending:0});
/** 按加入顺序把有效成员确定性排入每页 8 格，末页不足补 null；未知/重复编号不进入模型 */
export function buildBatchModel(ids:string[],rows:Specimen[]):BatchModel{
  const cells=batchCells(ids,rows);
  const s=summarize(cells);
  return {...s,pages:paginate(cells),mode:'sequence',groups:[]};
}
/**
 * 同点分组排版：只按传入的“当前有效且无矛盾”同点组形成组，其它记录保持散张。
 * - 组顺序按组内成员在手工批次中的最早位置确定，组内维持原批次顺序；
 * - 不超过 8 张的组（含散张）不得跨页：当前页放不下时以空格补齐、整组另起页；
 * - 超过 8 张的组按原顺序连续分页，中间不补空格。
 * 纯函数：不读写浏览器存储，不改变手工批次。
 */
export function buildGroupedBatchModel(ids:string[],rows:Specimen[],siteGroups:RelationGroup[]):BatchModel{
  const cells=batchCells(ids,rows);
  const cellOf=new Map(cells.map(c=>[c.specimen.id,c]));
  // 成员在手工批次中的位置：组顺序与组内顺序一律以此为准
  const posOf=new Map(cells.map((c,i)=>[c.specimen.id,i]));
  // 编号 → 所属同点组；只保留组内实际进入批次 ≥2 张的组，单张按散张处理
  const groupOf=new Map<string,RelationGroup>();
  for(const g of siteGroups){
    const inBatch=g.memberIds.filter(id=>cellOf.has(id));
    if(inBatch.length>=2)for(const id of inBatch)groupOf.set(id,g);
  }
  // 依批次顺序产生排版块：首次遇到某组即整组取出；组编号按“最早批次位置”重排，组内维持原批次顺序
  const blocks:{cells:BatchCell[];groupIndex?:number}[]=[];
  const emitted=new Set<string>();let groupNo=0;
  const batchGroups:BatchGroup[]=[];
  for(const c of cells){
    const id=c.specimen.id;
    if(emitted.has(id))continue;
    const g=groupOf.get(id);
    if(!g){blocks.push({cells:[c]});emitted.add(id);continue}
    groupNo+=1;
    const members=g.memberIds.filter(x=>cellOf.has(x)).sort((a,b)=>posOf.get(a)!-posOf.get(b)!);
    blocks.push({cells:members.map(x=>({...cellOf.get(x)!,groupIndex:groupNo})),groupIndex:groupNo});
    batchGroups.push({index:groupNo,ids:members});
    members.forEach(x=>emitted.add(x));
  }
  const out:(BatchCell|null)[]=[];let used=0;
  for(const b of blocks){
    const remaining=LABELS_PER_PAGE-used%LABELS_PER_PAGE;
    // 仅“不超过八张”的组享受不跨页保护：当前页放不下时补空格后另起页；
    // 超过八张的组按原顺序连续分页，页中起步也不补空格
    if(b.cells.length<=LABELS_PER_PAGE&&remaining<b.cells.length){
      out.push(...Array<null>(remaining).fill(null));
      used+=remaining;
    }
    out.push(...b.cells);
    used+=b.cells.length;
  }
  const s=summarize(cells);
  return {...s,pages:paginate(out),mode:'grouped',groups:batchGroups};
}
