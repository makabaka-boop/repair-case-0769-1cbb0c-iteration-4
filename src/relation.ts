import{NearConclusion}from'./near';

// 采集点关系检查：对当前仍有效结论的纯推导——只读，不写入浏览器存储，
// 绝不改写结论、记录、撤销项与打印批次；未复核的记录对不在结论中，绝不会被自动写成已确认
export type RelationGroup={index:number;memberIds:string[]};
// 冲突 = 一条“确为两份”的两端落在同一同点复采分组；path 为连接两端的最短同点路径（含两端）
export type RelationConflict={pairKey:string;ids:[string,string];path:string[]};
export type RelationReport={
  conclusions:number;              // 参与推导的有效结论条数
  groups:RelationGroup[];          // “同点复采”连通分组，组号从 1 起、按组内最小内部 ID 排序
  conflicts:RelationConflict[];    // 按相异关系 pairKey 排序，结果确定
  involved:ReadonlySet<string>;    // 卷入任一冲突的记录内部 ID（两端与路径成员）
};

// 内部记录 ID 序列的字典序：最短路径并列时取序列最小者，保证唯一结果
const compareIdSeq=(x:string[],y:string[])=>{
  for(let i=0;i<x.length&&i<y.length;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;
  return x.length-y.length;
};

// 同点复采图上的最短路径：逐层 BFS，每个节点只保留到达它的最小 ID 序列路径
const shortestPath=(adj:ReadonlyMap<string,string[]>,from:string,to:string):string[]=>{
  let frontier=new Map<string,string[]>([[from,[from]]]);
  const seen=new Set([from]);
  while(!frontier.has(to)){
    const next=new Map<string,string[]>();
    for(const[node,path]of frontier)for(const nb of adj.get(node)??[]){
      if(seen.has(nb))continue;
      const cand=[...path,nb];
      const cur=next.get(nb);
      if(!cur||compareIdSeq(cand,cur)<0)next.set(nb,cand);
    }
    for(const n of next.keys())seen.add(n);
    frontier=next;
  }
  return frontier.get(to)!;
};

/**
 * 关系报告：仅依据传入的（已核对仍有效的）结论。
 * - 分组：以“同点复采”为边的连通分量，编号与成员顺序确定；
 * - 冲突：相异关系两端落在同组即报告，附最短同点路径，路径并列时按内部记录 ID 序列取唯一结果；
 * - 相异关系两端不在同一分组（或不在任何分组）时不构成冲突。
 */
export function buildRelationReport(entries:NearConclusion[]):RelationReport{
  const adj=new Map<string,string[]>();
  const separates:NearConclusion[]=[];
  const link=(a:string,b:string)=>{const l=adj.get(a);if(l)l.push(b);else adj.set(a,[b])};
  for(const c of entries){
    if(c.verdict==='separate'){separates.push(c);continue}
    link(c.ids[0],c.ids[1]);link(c.ids[1],c.ids[0]);
  }
  for(const list of adj.values())list.sort();
  // 连通分量：从最小的未访问内部 ID 起逐组遍历，分组顺序与输入顺序无关
  const compOf=new Map<string,number>();
  const groups:RelationGroup[]=[];
  for(const start of[...adj.keys()].sort()){
    if(compOf.has(start))continue;
    const memberIds:string[]=[];const queue=[start];compOf.set(start,groups.length);
    for(let h=0;h<queue.length;h++){
      const cur=queue[h];memberIds.push(cur);
      for(const nb of adj.get(cur)!)if(!compOf.has(nb)){compOf.set(nb,groups.length);queue.push(nb)}
    }
    memberIds.sort();
    groups.push({index:groups.length+1,memberIds});
  }
  const conflicts:RelationConflict[]=[];
  for(const c of separates){
    const[a,b]=c.ids;
    const g=compOf.get(a);
    if(g===undefined||g!==compOf.get(b))continue;
    conflicts.push({pairKey:c.pairKey,ids:[a,b],path:shortestPath(adj,a,b)});
  }
  conflicts.sort((x,y)=>x.pairKey<y.pairKey?-1:x.pairKey>y.pairKey?1:0);
  const involved=new Set<string>();
  for(const c of conflicts)for(const id of c.path)involved.add(id);
  return{conclusions:entries.length,groups,conflicts,involved};
}
