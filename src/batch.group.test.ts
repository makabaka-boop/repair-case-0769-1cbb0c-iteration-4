import{beforeEach,describe,expect,it}from'vitest';
import{LABELS_PER_PAGE,batchModelSignature,buildBatchModel,buildGroupedBatchModel}from'./batch';
import{NEAR_KEY,buildConclusion,saveConclusions}from'./near';
import{Specimen}from'./types';

const row=(id:string,no?:string):Specimen=>({id,collectionNo:no??`N-${id}`,species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'0',longitude:'0',habitat:'',resolutions:{}});
const rows=(ids:string[])=>ids.map(id=>row(id));
const dup=(rs:Specimen[],a:string,b:string)=>buildConclusion(rs,a,b,'duplicate')!;
const sep=(rs:Specimen[],a:string,b:string)=>buildConclusion(rs,a,b,'separate')!;
const idsOf=(m:{pages:{cells:({specimen:{id:string}}|null)[]}[]})=>m.pages.map(p=>p.cells.map(c=>c?c.specimen.id:null));
const blanksPerPage=(m:{pages:{cells:unknown[]}[]})=>m.pages.map(p=>p.cells.filter(c=>c===null).length);

beforeEach(()=>localStorage.clear());

describe('同点分组排版：组顺序与组内顺序',()=>{
  it('组按组内成员最早批次位置排序，组内维持原批次顺序；无组成员作为单张穿插',()=>{
    const rs=rows(['a','b','c','x','y']);
    // 同点组：b-c、x-y；批次顺序 a, c, b, y, x（b 在 c 后、x 在 y 后）
    const entries=[dup(rs,'b','c'),dup(rs,'x','y')];
    const m=buildGroupedBatchModel(['a','c','b','y','x'],rs,entries);
    expect(m.mode).toBe('grouped');
    expect(m.groups).toBe(2);
    // 组 bc 的最早位置是 1（c），组 xy 的最早位置是 3（y）→ bc 在前；组内按批次：c,b 与 y,x
    expect(idsOf(m)[0].slice(0,5)).toEqual(['a','c','b','y','x']);
    // 组号写回单元格（仅多成员组）
    expect(m.pages[0].cells[1]!.groupNo).toBe(1);
    expect(m.pages[0].cells[2]!.groupNo).toBe(1);
    expect(m.pages[0].cells[3]!.groupNo).toBe(2);
    expect(m.pages[0].cells[0]!.groupNo).toBeUndefined();
  });
  it('组顺序不依赖关系检查的分组编号，只看批次最早位置',()=>{
    // 关系报告按最小 ID 编号：组 a-z 编号 1；但批次中 z/y 组的成员出现得更早
    const rs=rows(['a','z','y']);
    const entries=[dup(rs,'a','z'),dup(rs,'z','y')]; // 全部连成一组，与下一场景区分
    const m=buildGroupedBatchModel(['y','z','a'],rs,entries);
    expect(idsOf(m)[0].slice(0,3)).toEqual(['y','z','a']);
    expect(m.groups).toBe(1);
  });
  it('默认顺排与分组排版统计一致，空格口径不同',()=>{
    const rs=rows(['a','b','c']);
    const entries=[dup(rs,'a','b')];
    const seq=buildBatchModel(['c','a','b'],rs);
    const grp=buildGroupedBatchModel(['c','a','b'],rs,entries);
    expect(grp.total).toBe(seq.total);
    expect(grp.totalPending).toBe(seq.totalPending);
    expect(grp.withPending).toBe(seq.withPending);
    expect(seq.mode).toBe('sequential');
    expect(seq.groups).toBe(0);
    expect(seq.groupedBlanks).toBe(0);
  });
});

describe('同点分组排版：不超过 8 张的组不跨页与空格',()=>{
  it('当前页放不下整组时补空格另起页，组完整落在下一页',()=>{
    const ids=['s0','s1','s2','s3','s4','s5','s6','a','b','c'];
    const rs=rows(ids);
    const entries=[dup(rs,'a','b'),dup(rs,'b','c')];
    const m=buildGroupedBatchModel(ids,rs,entries);
    expect(m.pages).toHaveLength(2);
    // 页 1：7 张单排 + 1 个补白空格；组 a,b,c 整组在页 2
    expect(idsOf(m)[0]).toEqual(['s0','s1','s2','s3','s4','s5','s6',null]);
    expect(idsOf(m)[1]).toEqual(['a','b','c',null,null,null,null,null]);
    expect(blanksPerPage(m)).toEqual([1,5]);
    expect(m.groupedBlanks).toBe(1); // 只有“因整组不跨页另起页”补出的空格计入
  });
  it('当前页恰好放得下整组时不产生额外空格',()=>{
    const ids=['s0','s1','s2','s3','s4','a','b','c'];
    const rs=rows(ids);
    const m=buildGroupedBatchModel(ids,rs,[dup(rs,'a','b'),dup(rs,'b','c')]);
    expect(m.pages).toHaveLength(1);
    expect(idsOf(m)[0]).toEqual(['s0','s1','s2','s3','s4','a','b','c']);
    expect(m.groupedBlanks).toBe(0);
  });
  it('恰好 8 张的组不跨页；前面内容导致放不下时补 8 格另起',()=>{
    const ids=['s0',...Array.from({length:8},(_,i)=>`g${i}`)];
    const rs=rows(ids);
    const entries=Array.from({length:7},(_,i)=>dup(rs,`g${i}`,`g${i+1}`));
    const m=buildGroupedBatchModel(ids,rs,entries);
    expect(m.pages).toHaveLength(2);
    expect(idsOf(m)[0]).toEqual(['s0',null,null,null,null,null,null,null]);
    expect(idsOf(m)[1].every(x=>x!==null)).toBe(true);
    expect(idsOf(m)[1]).toEqual(Array.from({length:8},(_,i)=>`g${i}`));
    expect(m.groupedBlanks).toBe(7);
  });
  it('连续多个小组各自不跨页，多次补白',()=>{
    // 7 单张 → 组 3 张（补 1 空格）→ 页 2 放 3 张组 + 4 张组？4 张放不下剩 5 格… 3+4=7 放得下
    const ids=['s0','s1','s2','s3','s4','s5','s6','a','b','c','d','e','f','g'];
    const rs=rows(ids);
    const entries=[dup(rs,'a','b'),dup(rs,'b','c'),dup(rs,'d','e'),dup(rs,'e','f'),dup(rs,'f','g')];
    const m=buildGroupedBatchModel(ids,rs,entries);
    expect(idsOf(m)[0]).toEqual(['s0','s1','s2','s3','s4','s5','s6',null]);
    expect(idsOf(m)[1]).toEqual(['a','b','c','d','e','f','g',null]);
    expect(m.groupedBlanks).toBe(1);
  });
});

describe('同点分组排版：超过 8 张的组连续分页',()=>{
  it('9 张组从当前页直接连续排入、自然跨页，不为跨页补白',()=>{
    const ids=['s0','s1',...Array.from({length:9},(_,i)=>`g${i}`)];
    const rs=rows(ids);
    const entries=Array.from({length:8},(_,i)=>dup(rs,`g${i}`,`g${i+1}`));
    const m=buildGroupedBatchModel(ids,rs,entries);
    expect(m.pages).toHaveLength(2);
    // 页 1：2 单张 + g0..g5；页 2：g6..g8 连续承接
    expect(idsOf(m)[0]).toEqual(['s0','s1','g0','g1','g2','g3','g4','g5']);
    expect(idsOf(m)[1]).toEqual(['g6','g7','g8',null,null,null,null,null]);
    expect(m.groupedBlanks).toBe(0); // 连续分页中段不补白，末页空格不计入
  });
  it('17 张组连续铺满三页，中段页无空格',()=>{
    const ids=Array.from({length:17},(_,i)=>`g${i}`);
    const rs=rows(ids);
    const entries=Array.from({length:16},(_,i)=>dup(rs,`g${i}`,`g${i+1}`));
    const m=buildGroupedBatchModel(ids,rs,entries);
    expect(m.pages).toHaveLength(3);
    expect(idsOf(m)[0]).toEqual(Array.from({length:8},(_,i)=>`g${i}`));
    expect(idsOf(m)[1]).toEqual(Array.from({length:8},(_,i)=>`g${i+8}`));
    expect(idsOf(m)[2]).toEqual(['g16',null,null,null,null,null,null,null]);
    expect(m.groupedBlanks).toBe(0);
  });
});

describe('同点分组排版：仅使用有效、无矛盾关系',()=>{
  it('卷入冲突（同点链上又有“确为两份”）的整组不用于排版，成员按批次顺序散排并报告扣留组数',()=>{
    // a-b 同点、b-c 同点、a-c 确为两份 → 整组有矛盾
    const rs=rows(['a','b','c']);
    const entries=[dup(rs,'a','b'),dup(rs,'b','c'),sep(rs,'a','c')];
    const m=buildGroupedBatchModel(['c','a','b'],rs,entries);
    expect(m.groups).toBe(0);
    expect(m.withheldGroups).toBe(1);
    expect(idsOf(m)[0].slice(0,3)).toEqual(['c','a','b']); // 不合并、维持手工批次顺序
    expect(m.pages[0].cells.slice(0,3).every(c=>c!.groupNo===undefined)).toBe(true);
  });
  it('只有“确为两份”的对不形成组，不影响其它无矛盾组',()=>{
    const rs=rows(['a','b','x','y']);
    const entries=[sep(rs,'a','b'),dup(rs,'x','y')];
    const m=buildGroupedBatchModel(['a','b','y','x'],rs,entries);
    expect(m.groups).toBe(1);
    expect(m.withheldGroups).toBe(0);
    expect(idsOf(m)[0].slice(0,4)).toEqual(['a','b','y','x']);
    expect(m.pages[0].cells[3]!.groupNo).toBe(1); // y 与 x 同组
  });
  it('绑定字段被编辑使相关结论失效后：旧组不再用于排版（关系失效）',()=>{
    const ids=['s0','s1','s2','s3','s4','s5','s6','a','b','c'];
    const rs=rows(ids);
    saveConclusions([dup(rs,'a','b'),dup(rs,'b','c')]);
    const before=buildGroupedBatchModel(ids,rs,JSON.parse(localStorage.getItem(NEAR_KEY)!));
    expect(before.groups).toBe(1);
    expect(idsOf(before)[1]?.slice(0,3)).toEqual(['a','b','c']);
    // b 的绑定字段被编辑：a-b、b-c 两条结论均涉及 b，立即全部失效（与应用层同一核对规则），排版回到顺排
    const edited=rs.map(r=>r.id==='b'?{...r,latitude:'0.0001'}:r);
    const after=buildGroupedBatchModel(ids,edited,JSON.parse(localStorage.getItem(NEAR_KEY)!));
    expect(after.groups).toBe(0);
    expect(after.pages).toHaveLength(2);
    // 顺排：s0..s6,a 在第一页（8 格满），b,c 在第二页 —— 同点组不再保持同页
    expect(idsOf(after)[0]).toEqual(['s0','s1','s2','s3','s4','s5','s6','a']);
    expect(idsOf(after)[1]).toEqual(['b','c',null,null,null,null,null,null]);
  });
  it('只改动组内一端的字段：涉及它的结论逐对失效，同点组收缩而非整组保留',()=>{
    const rs=rows(['a','b','c']);
    saveConclusions([dup(rs,'a','b'),dup(rs,'b','c')]);
    // a 被编辑：a-b 失效，b-c 仍有效 → 只剩 {b,c} 组
    const edited=rs.map(r=>r.id==='a'?{...r,latitude:'0.0001'}:r);
    const m=buildGroupedBatchModel(['a','b','c'],edited,JSON.parse(localStorage.getItem(NEAR_KEY)!));
    expect(m.groups).toBe(1);
    expect(m.pages[0].cells[0]!.groupNo).toBeUndefined();
    expect(m.pages[0].cells[1]!.groupNo).toBe(1);
    expect(m.pages[0].cells[2]!.groupNo).toBe(1);
  });
  it('存储里残留的失效（指纹不符）结论不会复活为排版依据',()=>{
    const rs=rows(['a','b']);
    saveConclusions([dup(rs,'a','b')]);
    const edited=[{...rs[0],latitude:'0.0001'},rs[1]];
    const m=buildGroupedBatchModel(['a','b'],edited,JSON.parse(localStorage.getItem(NEAR_KEY)!));
    expect(m.groups).toBe(0);
  });
  it('批次只含组成员之一时该组不作为多成员组应用，也不计入扣留组数',()=>{
    const rs=rows(['a','b','x']);
    const m=buildGroupedBatchModel(['a','x'],rs,[dup(rs,'a','b')]);
    expect(m.groups).toBe(0);
    expect(m.withheldGroups).toBe(0);
    expect(idsOf(m)[0].slice(0,2)).toEqual(['a','x']);
  });
  it('冲突组在批次中只有一名成员时不扣留、不标记，仍显示冲突警示计数',()=>{
    const rs=rows(['a','b','c','x']);
    const entries=[dup(rs,'a','b'),dup(rs,'b','c'),sep(rs,'a','c')];
    const m=buildGroupedBatchModel(['a','x'],rs,entries);
    expect(m.groups).toBe(0);
    expect(m.withheldGroups).toBe(0);
    expect(idsOf(m)[0].slice(0,2)).toEqual(['a','x']);
  });
});

describe('页模型时效指纹',()=>{
  const rs=rows(['a','b','c']);
  const entries=[dup(rs,'a','b')];
  it('同一模式/批次/记录/有效关系下指纹稳定',()=>{
    expect(batchModelSignature('grouped',['a','b'],rs,entries)).toBe(batchModelSignature('grouped',['a','b'],rs,entries));
  });
  it('排版模式、批次顺序与成员、记录编辑、关系变化任一发生即改变指纹',()=>{
    const base=batchModelSignature('grouped',['a','b','c'],rs,entries);
    expect(batchModelSignature('sequential',['a','b','c'],rs,entries)).not.toBe(base);
    expect(batchModelSignature('grouped',['a','c','b'],rs,entries)).not.toBe(base);
    expect(batchModelSignature('grouped',['a','b'],rs,entries)).not.toBe(base);
    const edited=rs.map(r=>r.id==='c'?{...r,habitat:'林下'}:r);
    expect(batchModelSignature('grouped',['a','b','c'],edited,entries)).not.toBe(base);
    expect(batchModelSignature('grouped',['a','b','c'],rs,[...entries,dup(rs,'b','c')])).not.toBe(base);
  });
  it('指纹失效条目不参与指纹：失效前后（剔除后）指纹只随当前有效关系变化',()=>{
    // 存储中多一条指纹已失效的结论，不应让旧模型被误判为仍有效
    const stale=[...entries,dup([{...rs[0],latitude:'9'},rs[1],rs[2]],'a','c')];
    const withStale=batchModelSignature('grouped',['a','b','c'],rs,stale);
    expect(withStale).toBe(batchModelSignature('grouped',['a','b','c'],rs,entries));
  });
  it('顺排指纹不受结论存储影响；未知与重复编号在指纹中按有效去重序列归一',()=>{
    expect(batchModelSignature('sequential',['a','b'],rs,entries)).toBe(batchModelSignature('sequential',['a','b'],rs,[dup(rs,'a','b')]));
    expect(batchModelSignature('sequential',['a','ghost','a','b'],rs,[])).toBe(batchModelSignature('sequential',['a','b'],rs,[]));
  });
  it('每页恒为 8 格且页码连续',()=>{
    const ids=Array.from({length:20},(_,i)=>`r${i}`);
    const m=buildGroupedBatchModel(ids,rows(ids),[]);
    expect(LABELS_PER_PAGE).toBe(8);
    expect(m.pages.every(p=>p.cells.length===8)).toBe(true);
    expect(m.pages.map(p=>p.index)).toEqual([0,1,2]);
  });
});
