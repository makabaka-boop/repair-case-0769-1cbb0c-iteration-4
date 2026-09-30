import{beforeEach,describe,expect,it}from'vitest';
import{buildRelationReport}from'./relation';
import{NEAR_KEY,buildConclusion,loadConclusions,reconcileConclusions,saveConclusions}from'./near';
import{Specimen}from'./types';

const row=(x:Partial<Specimen>):Specimen=>({id:'r1',collectionNo:'A-001',species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'0',longitude:'0',habitat:'',resolutions:{},...x});
const rows=(ids:string[])=>ids.map(id=>row({id,collectionNo:`N-${id}`}));
const dup=(rs:Specimen[],a:string,b:string)=>buildConclusion(rs,a,b,'duplicate')!;
const sep=(rs:Specimen[],a:string,b:string)=>buildConclusion(rs,a,b,'separate')!;

beforeEach(()=>localStorage.clear());

describe('空报告',()=>{
  it('没有任何结论时：无分组、无冲突、无卷入记录',()=>{
    const r=buildRelationReport([]);
    expect(r.conclusions).toBe(0);
    expect(r.groups).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.involved.size).toBe(0);
  });
  it('旧版存储没有结论键时载入为空，报告同样为空',()=>{
    expect(localStorage.getItem(NEAR_KEY)).toBeNull();
    const r=buildRelationReport(loadConclusions());
    expect(r.conclusions).toBe(0);
    expect(r.groups).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });
  it('只有“确为两份”结论时不形成分组，也不构成冲突',()=>{
    const rs=rows(['a','b']);
    const r=buildRelationReport([sep(rs,'a','b')]);
    expect(r.conclusions).toBe(1);
    expect(r.groups).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });
});

describe('同点复采分组（链式关系）',()=>{
  it('链式同点复采连成同一分组；互不相干的链各自成组并按最小内部 ID 排序编号',()=>{
    const rs=rows(['a','b','c','d','x','y']);
    const r=buildRelationReport([dup(rs,'b','c'),dup(rs,'x','y'),dup(rs,'a','b'),dup(rs,'c','d')]);
    expect(r.groups.map(g=>g.index)).toEqual([1,2]);
    expect(r.groups.map(g=>g.memberIds)).toEqual([['a','b','c','d'],['x','y']]);
    expect(r.conflicts).toEqual([]);
  });
  it('结论输入顺序不影响分组结果',()=>{
    const rs=rows(['a','b','c']);
    const r1=buildRelationReport([dup(rs,'a','b'),dup(rs,'b','c')]);
    const r2=buildRelationReport([dup(rs,'b','c'),dup(rs,'a','b')]);
    expect(r1.groups).toEqual(r2.groups);
  });
});

describe('冲突：确为两份的两端落在同组',()=>{
  it('链式同点复采 + 两端相异：报告冲突并给出连接两端的最短同点路径（含两端）',()=>{
    const rs=rows(['a','b','c','d']);
    const r=buildRelationReport([dup(rs,'a','b'),dup(rs,'b','c'),dup(rs,'c','d'),sep(rs,'a','d')]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].ids).toEqual(['a','d']);
    expect(r.conflicts[0].path).toEqual(['a','b','c','d']);
    expect(r.involved).toEqual(new Set(['a','b','c','d']));
  });
  it('相异关系两端分属不同分组、或不在任何分组时，均不构成冲突',()=>{
    const rs=rows(['a','b','c','d','e']);
    const r=buildRelationReport([dup(rs,'a','b'),dup(rs,'c','d'),sep(rs,'a','c'),sep(rs,'a','e'),sep(rs,'d','e')]);
    expect(r.groups).toHaveLength(2);
    expect(r.conflicts).toEqual([]);
    expect(r.involved.size).toBe(0);
  });
  it('多条冲突按相异关系 pairKey 排序，路径各自独立计算',()=>{
    const rs=rows(['a','b','c','d','e','f']);
    const r=buildRelationReport([dup(rs,'d','e'),dup(rs,'e','f'),sep(rs,'d','f'),dup(rs,'a','b'),dup(rs,'b','c'),sep(rs,'a','c')]);
    expect(r.conflicts.map(c=>c.ids.join(','))).toEqual(['a,c','d,f']);
    expect(r.conflicts[0].path).toEqual(['a','b','c']);
    expect(r.conflicts[1].path).toEqual(['d','e','f']);
  });
});

describe('最短路径并列：按内部记录 ID 序列取唯一结果',()=>{
  it('菱形两条等长路径取 ID 序列较小者，与结论输入顺序无关',()=>{
    const rs=rows(['a','b','c','d']);
    const base=[dup(rs,'a','c'),dup(rs,'a','b'),dup(rs,'c','d'),dup(rs,'b','d'),sep(rs,'a','d')];
    const r1=buildRelationReport(base);
    const r2=buildRelationReport([...base].reverse());
    expect(r1.conflicts[0].path).toEqual(['a','b','d']); // b < c
    expect(r2.conflicts[0].path).toEqual(['a','b','d']);
  });
  it('按字符串内部 ID 字典序而非数值：id10 排在 id9 之前',()=>{
    const rs=rows(['id9','id10','s','t']);
    const r=buildRelationReport([dup(rs,'s','id9'),dup(rs,'s','id10'),dup(rs,'id9','t'),dup(rs,'id10','t'),sep(rs,'s','t')]);
    expect(r.conflicts[0].path).toEqual(['s','id10','t']);
  });
  it('并列出现在路径后段时仍逐节点取最小序列',()=>{
    const rs=rows(['p','q','s','t','u']);
    const r=buildRelationReport([dup(rs,'s','u'),dup(rs,'u','q'),dup(rs,'u','p'),dup(rs,'q','t'),dup(rs,'p','t'),sep(rs,'s','t')]);
    expect(r.conflicts[0].path).toEqual(['s','u','p','t']); // p < q
  });
});

describe('记录失效及恢复（与应用层同一套核对规则）',()=>{
  it('绑定字段变更使结论失效：冲突与分组即时消失；字段改回原文也不复活',()=>{
    const rs=rows(['a','b','c']);
    expect(saveConclusions([dup(rs,'a','b'),dup(rs,'b','c'),sep(rs,'a','c')])).toBe(true);
    // 初始：链式同点复采 + 两端相异 → 1 项冲突、1 个三记录分组
    let live=reconcileConclusions(loadConclusions(),rs);
    let report=buildRelationReport(live);
    expect(report.conflicts).toHaveLength(1);
    expect(report.groups.map(g=>g.memberIds)).toEqual([['a','b','c']]);
    // c 的绑定字段被编辑：涉及 c 的结论失效并被物理剔除（应用层同一动作）
    const edited=rs.map(r=>r.id==='c'?{...r,latitude:'0.0001'}:r);
    live=reconcileConclusions(live,edited);
    saveConclusions(live);
    report=buildRelationReport(live);
    expect(report.conclusions).toBe(1);
    expect(report.conflicts).toEqual([]);
    expect(report.groups.map(g=>g.memberIds)).toEqual([['a','b']]);
    // 撤销/恢复备份使字段回到原文：已剔除的结论不复活，报告保持无冲突
    live=reconcileConclusions(loadConclusions(),rs);
    report=buildRelationReport(live);
    expect(report.conclusions).toBe(1);
    expect(report.conflicts).toEqual([]);
    expect(report.groups.map(g=>g.memberIds)).toEqual([['a','b']]);
  });
  it('记录被删除使结论失效：分组收缩；恢复同内部编号备份也不复活',()=>{
    const rs=rows(['a','b','c']);
    saveConclusions([dup(rs,'a','b'),dup(rs,'b','c'),sep(rs,'a','c')]);
    const withoutC=rs.filter(r=>r.id!=='c');
    let live=reconcileConclusions(loadConclusions(),withoutC);
    saveConclusions(live);
    const report=buildRelationReport(live);
    expect(report.conflicts).toEqual([]);
    expect(report.groups.map(g=>g.memberIds)).toEqual([['a','b']]);
    // 恢复含相同内部编号与字段的备份：旧结论不复活
    live=reconcileConclusions(loadConclusions(),rs);
    const restored=buildRelationReport(live);
    expect(restored.conclusions).toBe(1);
    expect(restored.conflicts).toEqual([]);
  });
});
