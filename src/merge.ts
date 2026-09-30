import {Specimen,fields} from './types';
import {issuesFor} from './data';

export type MergeChoice=(typeof fields)[number];
export type MergeSelections=Record<MergeChoice,0|1>;
export type MergePair=[Specimen,Specimen];
export type MergeState={pair:MergePair;keepId:string;selections:MergeSelections};

export const defaultSelections=():MergeSelections=>Object.fromEntries(fields.map(f=>[f,0])) as MergeSelections;

export function getMergePair(rows:Specimen[],ids:[string,string]):{pair?:MergePair;error?:string}{
  if(ids[0]===ids[1])return {error:'无法合并：请选择两条不同记录'};
  const pair=ids.map(id=>rows.find(r=>r.id===id)) as MergePair;
  if(!pair[0]||!pair[1])return {error:'无法合并：其中一条记录已被删除'};
  if(!pair[0].collectionNo.trim()||pair[0].collectionNo.trim()!==pair[1].collectionNo.trim()){
    return {error:'无法合并：两条记录的采集编号已不再相同'};
  }
  return {pair};
}

export function buildMergedSpecimen(pair:MergePair,keepId:string,selections:MergeSelections):Specimen{
  const kept=pair.find(r=>r.id===keepId);
  if(!kept)throw new Error('保留记录不存在');
  const keepIndex=pair.findIndex(r=>r.id===keepId) as 0|1;
  const base=Object.fromEntries(fields.map(f=>[f,pair[selections[f]][f]])) as Pick<Specimen,MergeChoice>;
  const merged:Specimen={...base,id:kept.id,resolutions:{}};
  merged.resolutions=reconcileResolutions(merged,kept,kept.resolutions,selections,keepIndex);
  return merged;
}

/**
 * 合并后按新记录的实际问题重新核对保留项带来的问题处置：
 * - 合并后已不再存在的问题，处置丢弃；
 * - 问题对应字段是从另一条记录选来的（哪怕值恰好相同），处置同样丢弃——
 *   人工处置针对的是保留项的原内容，字段来源已变，新问题必须回到“待处理”。
 */
export function reconcileResolutions(merged:Specimen,kept:Specimen,resolutions:Specimen['resolutions'],selections?:MergeSelections,keepIndex?:number):Specimen['resolutions']{
  const types=new Map(issuesFor([merged]).map(i=>[i.key,i.type]));
  const out:Specimen['resolutions']={};
  for(const[key,value]of Object.entries(resolutions)){
    const type=types.get(key);
    if(!type)continue;
    if(selections&&keepIndex!==undefined){
      const watched:MergeChoice[]=
        type==='物种名缺失'?['species']:
        type==='日期晚于当前日期'?['date']:
        type==='经纬度不合法'?['latitude','longitude']:
        ['collectionNo'];
      if(watched.some(f=>selections[f]!==keepIndex))continue;
    }
    out[key]=structuredClone(value);
  }
  return out;
}

export function mergeRows(rows:Specimen[],mergedId:string,merged:Specimen):Specimen[]{
  return rows.filter(r=>r.id!==mergedId).map(r=>r.id===merged.id?merged:r);
}

/** 被合并编号改指保留编号；指向同一记录后按首次出现去重，其他成员顺序不变 */
export function mergeBatchIds(ids:string[],mergedId:string,keepId:string):string[]{
  if(mergedId===keepId)return ids;
  const out:string[]=[];
  let keptSeen=false;
  for(const original of ids){
    const id=original===mergedId?keepId:original;
    if(id===keepId){
      if(keptSeen)continue;
      keptSeen=true;
    }
    out.push(id);
  }
  return out;
}
