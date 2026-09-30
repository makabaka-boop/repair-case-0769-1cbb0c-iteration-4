import {Specimen} from './types';
import {issuesFor} from './data';
import {NearConclusion,reconcileConclusions} from './near';
import {buildRelationReport} from './relation';

export const BATCH_KEY='plant-preflight-batch-v1';
export const LABELS_PER_PAGE=8;
// 批次在本地存储中只有两个状态：空批次（[]）与已编排（去重且保序的非空记录编号序列）
// 同点分组只是打开预览时的可选排版视图，绝不写回批次，手工批次的存储与恢复口径保持不变
export type BatchLayoutMode='sequential'|'grouped';
export type BatchCell={specimen:Specimen;pendingIssues:number;groupNo?:number};
export type BatchPage={index:number;cells:(BatchCell|null)[]};
export type BatchModel={
  mode:BatchLayoutMode;
  pages:BatchPage[];
  total:number;
  totalPending:number;
  withPending:number;
  groups:number;          // 同点分组排版中实际应用的“不跨页组”数量；顺排恒为 0
  groupedBlanks:number;   // 仅因“小组不跨页、另起一页”补出的空格数；大组连续分页与末页空格不计入
  withheldGroups:number;  // 卷入关系冲突（且批次中至少两名成员）而拒绝用于排版的同点分组数（冲突只警示，不据此合并）
};
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

// 有效成员（去重、保序、未知编号剔除）及其待处理问题数；两种排版共用同一份入模数据
function flatCells(ids:string[],rows:Specimen[]):BatchCell[]{
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
const statOf=(mode:BatchLayoutMode,cells:BatchCell[],pages:BatchPage[],extra?:{groups?:number;groupedBlanks?:number;withheldGroups?:number}):BatchModel=>({
  mode,pages,total:cells.length,
  totalPending:cells.reduce((s,c)=>s+c.pendingIssues,0),
  withPending:cells.filter(c=>c.pendingIssues>0).length,
  groups:extra?.groups??0,groupedBlanks:extra?.groupedBlanks??0,withheldGroups:extra?.withheldGroups??0,
});
const paginateSequential=(cells:BatchCell[]):BatchPage[]=>{
  const pageCount=Math.ceil(cells.length/LABELS_PER_PAGE);
  return Array.from({length:pageCount},(_,p)=>({index:p,cells:Array.from({length:LABELS_PER_PAGE},(_,k)=>cells[p*LABELS_PER_PAGE+k]??null)}));
};

/** 按加入顺序把有效成员确定性排入每页 8 格，末页不足补 null；未知/重复编号不进入模型 */
export function buildBatchModel(ids:string[],rows:Specimen[]):BatchModel{
  const cells=flatCells(ids,rows);
  return statOf('sequential',cells,paginateSequential(cells));
}

/**
 * 同点分组排版（纯推导，不写回任何存储）：
 * - 仅使用当前有效（指纹核对通过）且“无矛盾”的同点复采关系：
 *   连通分量任一端存在“确为两份”矛盾（即出现在关系冲突路径上），整组拒绝用于排版，成员按手工批次顺序散排，冲突仍只由警示呈现；
 * - 组顺序按组内成员在手工批次中的最早位置确定，组内维持原批次顺序；不属于任何无矛盾组的成员作为单张序列穿插其间；
 * - 不超过 8 张的组不得跨页：当前页剩余格放不下时，当前页以空格补齐后另起页；
 * - 超过 8 张的组按原顺序连续分页（中段页自然填满，不加补白）；
 * - 空格只出现在小组另起页时的当前页，以及不足 8 格的末页。
 */
export function buildGroupedBatchModel(ids:string[],rows:Specimen[],entries:NearConclusion[]):BatchModel{
  const cells=flatCells(ids,rows);
  const live=reconcileConclusions(entries,rows);
  const report=buildRelationReport(live);
  // 卷入任一冲突路径的同点分组整组视为“有矛盾”，不用于合并排版
  const conflictedComps=new Set<number>();
  for(const c of report.conflicts)for(const id of c.path){
    const g=report.groups.find(grp=>grp.memberIds.includes(id));
    if(g)conflictedComps.add(g.index-1);
  };
  const compOf=new Map<string,number>();
  report.groups.forEach((g,i)=>{if(!conflictedComps.has(i))for(const id of g.memberIds)compOf.set(id,i)});
  const inModel=new Set(cells.map(c=>c.specimen.id));
  // 只保留批次中至少有两名成员的可用组（单名成员不构成同点排版组，按单张散排）；
  // 按组内最早批次位置确定组顺序
  const pos=new Map(cells.map((c,i)=>[c.specimen.id,i]));
  const groupIdx=[...new Set(compOf.values())]
    .filter(i=>report.groups[i].memberIds.filter(id=>inModel.has(id)).length>1)
    .sort((a,b)=>Math.min(...report.groups[a].memberIds.map(id=>pos.get(id)??Infinity))-Math.min(...report.groups[b].memberIds.map(id=>pos.get(id)??Infinity)));
  // 序列块：组块（成员按批次顺序）与单张块交错，整体顺序由“块首在批次中的最早位置”决定
  type Block={start:number;cells:BatchCell[];group?:number};
  const blocks:Block[]=[];
  const consumed=new Set<string>();
  groupIdx.forEach((gi,order)=>{
    const members=report.groups[gi].memberIds.filter(id=>inModel.has(id)).sort((x,y)=>pos.get(x)!-pos.get(y)!);
    members.forEach(id=>consumed.add(id));
    blocks.push({start:pos.get(members[0])!,cells:members.map(id=>cells[pos.get(id)!]),group:order+1});
  });
  cells.forEach((c,i)=>{if(!consumed.has(c.specimen.id))blocks.push({start:i,cells:[c]})});
  blocks.sort((a,b)=>a.start-b.start);
  // 把组号写回单元格（单张组的成员不标记，避免把散排误读为合并排版）
  for(const b of blocks)if(b.group&&b.cells.length>1)for(const c of b.cells)c.groupNo=b.group;

  // 分页：小组（≤8）不跨页，放不下先补白另起页；大组（>8）按原顺序连续分页，
  // 从当前页剩余格直接排入，跨页处自然换页、不补白（连续分页允许跨页）
  const pages:BatchPage[]=[];let cur:(BatchCell|null)[]=[];let groupedBlanks=0;
  const newPage=()=>{pages.push({index:pages.length,cells:cur});cur=[]};
  const padAndTurn=()=>{const n=LABELS_PER_PAGE-cur.length;if(n>0){cur.push(...Array(n).fill(null));groupedBlanks+=n}newPage()};
  for(const b of blocks){
    if(b.cells.length>LABELS_PER_PAGE){
      for(const c of b.cells){
        cur.push(c);
        if(cur.length===LABELS_PER_PAGE)newPage();
      }
    }else{
      if(cur.length+b.cells.length>LABELS_PER_PAGE)padAndTurn();
      cur.push(...b.cells);
    }
  }
  if(cur.length>0){const n=LABELS_PER_PAGE-cur.length;cur.push(...Array(n).fill(null));newPage()}
  return statOf('grouped',cells,pages,{
    groups:blocks.filter(b=>b.group&&b.cells.length>1).length,
    groupedBlanks,
    withheldGroups:report.groups.filter((_,i)=>conflictedComps.has(i)&&report.groups[i].memberIds.filter(id=>inModel.has(id)).length>1).length,
  });
}

/**
 * 页模型时效指纹：预览打开期间，批次成员、记录（含问题处置）或有效同点关系任一变化都会改变指纹。
 * 预览与实际打印共用同一模型：指纹不符时调用方必须立即废弃旧模型，不能再用旧页打印。
 * entries 为存储中的近地点结论，是否仍有效以当前 rows 重新核对（指纹失效条目不复活、也不参与排版）。
 */
export function batchModelSignature(mode:BatchLayoutMode,ids:string[],rows:Specimen[],entries:NearConclusion[]):string{
  const alive=new Set(rows.map(r=>r.id));
  const seen=new Set<string>();const kept:string[]=[];
  for(const id of ids)if(alive.has(id)&&!seen.has(id)){seen.add(id);kept.push(id)}
  const rowsKey=[...rows].map(r=>JSON.stringify(r)).sort().join('|');
  const liveKey=reconcileConclusions(entries,rows).map(c=>c.pairKey+':'+c.verdict).sort().join('|');
  return `${mode} ${kept.join(',')} ${rowsKey} ${liveKey}`;
}
