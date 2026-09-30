import {beforeEach,describe,expect,it} from 'vitest';
import {BATCH_KEY,LABELS_PER_PAGE,addToBatch,buildBatchModel,buildGroupedBatchModel,loadBatch,pruneBatch,removeFromBatch,saveBatch} from './batch';
import {Specimen} from './types';
import {RelationGroup} from './relation';

const row=(x:Partial<Specimen>):Specimen=>({id:'1',collectionNo:'A1',species:'松',collector:'甲',date:'2026-01-01',location:'北京',latitude:'39',longitude:'116',habitat:'',resolutions:{},...x});
const rows=(n:number)=>Array.from({length:n},(_,i)=>row({id:`r${i}`,collectionNo:`A-${i}`}));

describe('批次存储与两个状态',()=>{
  beforeEach(()=>localStorage.clear());
  it('默认读取空批次',()=>{
    expect(loadBatch()).toEqual([]);
    expect(localStorage.getItem(BATCH_KEY)).toBeNull();
  });
  it('save/load 往返：已编排状态保存有序编号',()=>{
    saveBatch(['r2','r0','r1']);
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['r2','r0','r1']);
    expect(loadBatch()).toEqual(['r2','r0','r1']);
  });
  it('存储损坏、非数组或含非字符串时回退为空批次',()=>{
    localStorage.setItem(BATCH_KEY,'{损坏');
    expect(loadBatch()).toEqual([]);
    localStorage.setItem(BATCH_KEY,JSON.stringify({a:1}));
    expect(loadBatch()).toEqual([]);
    localStorage.setItem(BATCH_KEY,JSON.stringify(['x',1,null]));
    expect(loadBatch()).toEqual([]);
  });
  it('读取时去重并保持首次出现顺序',()=>{
    localStorage.setItem(BATCH_KEY,JSON.stringify(['a','b','a','c','b']));
    expect(loadBatch()).toEqual(['a','b','c']);
  });
});

describe('加入与移出：去重、保序',()=>{
  it('追加到末尾并保序',()=>{
    expect(addToBatch([],'r1')).toEqual(['r1']);
    expect(addToBatch(['r1'],'r2')).toEqual(['r1','r2']);
  });
  it('重复加入不增量且保持原位置',()=>{
    const ids=['r1','r2','r3'];
    expect(addToBatch(ids,'r2')).toEqual(['r1','r2','r3']);
    expect(addToBatch(ids,'r2')).toHaveLength(3);
  });
  it('移出不改变其余成员顺序，移出不存在的编号无副作用',()=>{
    expect(removeFromBatch(['r1','r2','r3'],'r2')).toEqual(['r1','r3']);
    expect(removeFromBatch(['r1'],'zz')).toEqual(['r1']);
  });
});

describe('清理失效成员',()=>{
  it('剔除已不存在的记录并保持顺序',()=>{
    const out=pruneBatch(['r0','gone','r1','r2'],rows(3));
    expect(out.ids).toEqual(['r0','r1','r2']);
    expect(out.removed).toEqual(['gone']);
  });
  it('重复的失效编号只报告一次，存活成员中的重复编号被合并',()=>{
    const out=pruneBatch(['x','x','r0','r0','r1','y'],rows(2));
    expect(out.ids).toEqual(['r0','r1']);
    expect(out.removed).toEqual(['x','y']);
  });
  it('成员全部存活时原样返回且无剔除报告',()=>{
    const out=pruneBatch(['r2','r0'],rows(3));
    expect(out.ids).toEqual(['r2','r0']);
    expect(out.removed).toEqual([]);
  });
});

describe('分页模型：按加入顺序确定性排入每页八格',()=>{
  it('每页 8 格、末页补 null',()=>{
    const m=buildBatchModel(['r0','r1','r2'],rows(3));
    expect(LABELS_PER_PAGE).toBe(8);
    expect(m.pages).toHaveLength(1);
    expect(m.pages[0].cells).toHaveLength(8);
    expect(m.pages[0].cells.slice(0,3).map(c=>c!.specimen.id)).toEqual(['r0','r1','r2']);
    expect(m.pages[0].cells.slice(3).every(c=>c===null)).toBe(true);
  });
  it('8 条以内一页；超过 8 条跨页且顺序连续',()=>{
    const all=rows(10);
    const m=buildBatchModel(all.map(r=>r.id),all);
    expect(m.pages).toHaveLength(2);
    expect(m.pages[0].index).toBe(0);
    expect(m.pages[1].index).toBe(1);
    expect(m.pages[0].cells.every(Boolean)).toBe(true);
    expect(m.pages[1].cells.slice(0,2).map(c=>c!.specimen.id)).toEqual(['r8','r9']);
    expect(m.pages[1].cells.slice(2).every(c=>c===null)).toBe(true);
    expect(m.total).toBe(10);
  });
  it('恰好 8 条只有一页，恰好 16 条两页且第二页无空格',()=>{
    expect(buildBatchModel(rows(8).map(r=>r.id),rows(8)).pages).toHaveLength(1);
    const m=buildBatchModel(rows(16).map(r=>r.id),rows(16));
    expect(m.pages).toHaveLength(2);
    expect(m.pages[1].cells.every(Boolean)).toBe(true);
  });
  it('未知编号与重复编号不进入模型',()=>{
    const m=buildBatchModel(['r0','ghost','r0','r1'],rows(2));
    expect(m.total).toBe(2);
    expect(m.pages[0].cells.slice(0,2).map(c=>c!.specimen.id)).toEqual(['r0','r1']);
  });
  it('空模型没有任何页',()=>{
    expect(buildBatchModel([],rows(3)).pages).toEqual([]);
  });
  it('统计仍有未处置问题的标本与问题数，但不阻止分页',()=>{
    const list=[row({id:'a',collectionNo:'C-a',species:''}),row({id:'b',collectionNo:'C-b',date:'2099-01-01',latitude:'99'}),row({id:'c',collectionNo:'C-c'})];
    const withNote:Specimen={...list[1],resolutions:{'b:future':{status:'fixed',note:'已核对'},'b:coords':{status:'kept',note:''}}};
    const m=buildBatchModel(['a','b','c'],[list[0],withNote,list[2]]);
    // a: 物种名缺失 1 项；b: 未来日期已修正、坐标确认保留 → 0 待处理
    expect(m.withPending).toBe(1);
    expect(m.totalPending).toBe(1);
    expect(m.pages[0].cells[0]!.pendingIssues).toBe(1);
    expect(m.pages[0].cells[1]!.pendingIssues).toBe(0);
    expect(m.total).toBe(3);
  });
});

const group=(index:number,ids:string[]):RelationGroup=>({index,memberIds:ids});
const idsOf=(m:ReturnType<typeof buildGroupedBatchModel>)=>m.pages.map(p=>p.cells.map(c=>c?c.specimen.id:'·'));

describe('同点分组排版：组成组规则',()=>{
  it('组顺序按组内最早批次位置确定，组内维持原批次顺序，散张与组混合排列',()=>{
    // 批次：a 散张，x/y 同点组（组1），b/c 同点组（组2），d 散张
    const m=buildGroupedBatchModel(['a','x','b','c','y','d'],
      ['a','x','b','c','y','d'].map((id)=>row({id,collectionNo:`A-${id}`})),
      [group(7,['b','c']),group(3,['x','y'])]);
    expect(m.mode).toBe('grouped');
    expect(m.groups.map(g=>[g.index,g.ids])).toEqual([[1,['x','y']],[2,['b','c']]]);
    expect(idsOf(m)).toEqual([['a','x','y','b','c','d','·','·']]);
    // 组编号标注只打在组成员格上，组号为批次顺序而非关系检查原编号
    const cells=m.pages[0].cells.slice(0,6);
    expect(cells.map(c=>c!.groupIndex)).toEqual([undefined,1,1,2,2,undefined]);
  });
  it('同点组中只有一张进入批次时不成为组，按散张顺排',()=>{
    const all=rows(4);
    const m=buildGroupedBatchModel(['r0','r1','r2'],all,[group(1,['r1','ghost'])]);
    expect(m.groups).toEqual([]);
    expect(idsOf(m)).toEqual([['r0','r1','r2','·','·','·','·','·']]);
    expect(m.pages[0].cells.every(c=>!c||c.groupIndex===undefined)).toBe(true);
  });
  it('组内维持原批次顺序，不按内部 ID 重排（关系报告里的组成员是 ID 序）',()=>{
    // 关系报告的 memberIds 按 ID 排序（b 在 a 前），但批次里 a 先于 b
    const m=buildGroupedBatchModel(['a','x','b'],
      [row({id:'a'}),row({id:'b'}),row({id:'x'})],
      [group(1,['a','b'])]);
    expect(m.groups[0].ids).toEqual(['a','b']);
    expect(idsOf(m)).toEqual([['a','b','x','·','·','·','·','·']]);
    expect(m.pages[0].cells.slice(0,2).map(c=>c!.groupIndex)).toEqual([1,1]);
  });
  it('统计口径与顺排一致，未知/重复编号不进入模型',()=>{
    const list=[row({id:'a',collectionNo:'C-a',species:''}),row({id:'b',collectionNo:'C-b'}),row({id:'c',collectionNo:'C-c'})];
    const m=buildGroupedBatchModel(['a','ghost','a','b','c'],list,[group(1,['a','b'])]);
    expect(m.total).toBe(3);
    expect(m.totalPending).toBe(1);
    expect(m.withPending).toBe(1);
    expect(idsOf(m)).toEqual([['a','b','c','·','·','·','·','·']]);
  });
  it('空批次没有任何页',()=>{
    const m=buildGroupedBatchModel([],rows(3),[group(1,['r0','r1'])]);
    expect(m.pages).toEqual([]);
    expect(m.groups).toEqual([]);
  });
});

describe('同点分组排版：页边界与空格',()=>{
  it('不超过 8 张的组当前页放不下时补空格后另起页，绝不跨页',()=>{
    // 6 张散张占满前 6 格，3 张同点组放不下：补 2 空格，组整体到第 2 页
    const ids=['s0','s1','s2','s3','s4','s5','g0','g1','g2'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(1,['g0','g1','g2'])]);
    expect(m.pages).toHaveLength(2);
    expect(idsOf(m)).toEqual([
      ['s0','s1','s2','s3','s4','s5','·','·'],
      ['g0','g1','g2','·','·','·','·','·'],
    ]);
  });
  it('组恰好填满当前页剩余格时不补空格，紧接着的组顺排',()=>{
    // 6 散张 + 2 张组恰好 8 格；第 9 张散张上第 2 页
    const ids=['s0','s1','s2','s3','s4','s5','g0','g1','z'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(1,['g0','g1'])]);
    expect(m.pages).toHaveLength(2);
    expect(m.pages[0].cells.every(Boolean)).toBe(true);
    expect(idsOf(m)[1].slice(0,1)).toEqual(['z']);
    expect(m.pages[1].cells.slice(1).every(c=>c===null)).toBe(true);
  });
  it('页正好在组边界结束时：新组从新页开头开始，不产生多余空格',()=>{
    const ids=['s0','s1','s2','s3','s4','s5','s6','s7','g0','g1'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(1,['g0','g1'])]);
    expect(m.pages).toHaveLength(2);
    expect(m.pages[0].cells.every(Boolean)).toBe(true);
    expect(idsOf(m)[1]).toEqual(['g0','g1','·','·','·','·','·','·']);
  });
  it('恰好 8 张的组不跨页：与前页散张放不下时补空格另起',()=>{
    const ids=['s0','g0','g1','g2','g3','g4','g5','g6','g7'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(1,['g0','g1','g2','g3','g4','g5','g6','g7'])]);
    expect(m.pages).toHaveLength(2);
    expect(idsOf(m)).toEqual([
      ['s0','·','·','·','·','·','·','·'],
      ['g0','g1','g2','g3','g4','g5','g6','g7'],
    ]);
  });
});

describe('同点分组排版：超过八张的组连续分页',()=>{
  it('9 张组按原顺序连续排满两页，组前不补空格、组内不插空格',()=>{
    const ids=['g0','g1','g2','g3','g4','g5','g6','g7','g8'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(1,ids)]);
    expect(m.pages).toHaveLength(2);
    expect(m.pages[0].cells.every(Boolean)).toBe(true);
    expect(idsOf(m)).toEqual([
      ['g0','g1','g2','g3','g4','g5','g6','g7'],
      ['g8','·','·','·','·','·','·','·'],
    ]);
    expect(m.pages.every(p=>p.cells.every(c=>!c||c.groupIndex===1))).toBe(true);
  });
  it('大组从页中开始也连续分页：先填满当前页，不补空格',()=>{
    // 2 散张后是 10 张组：组占第 1 页余 6 格 + 第 2 页 4 格
    const ids=['s0','s1',...Array.from({length:10},(_,i)=>`g${i}`)];
    const gids=ids.slice(2);
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(2,gids)]);
    expect(m.pages).toHaveLength(2);
    expect(idsOf(m)).toEqual([
      ['s0','s1','g0','g1','g2','g3','g4','g5'],
      ['g6','g7','g8','g9','·','·','·','·'],
    ]);
    expect(m.groups[0].ids).toEqual(gids);
  });
  it('大组（12 张）之后的小组不跨页：大组连续分页后余页放不下，小组补空格另起',()=>{
    // 2 散张 + 12 张大组（填满第 1 页余 6 格、第 2 页 6 格），第 2 页余 2 格放不下 3 张小组 → 另起第 3 页
    const ids=['s0','s1',...Array.from({length:12},(_,i)=>`b${i}`),'g0','g1','g2'];
    const bids=ids.slice(2,14);
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[group(1,bids),group(2,['g0','g1','g2'])]);
    expect(m.pages).toHaveLength(3);
    expect(idsOf(m)).toEqual([
      ['s0','s1','b0','b1','b2','b3','b4','b5'],
      ['b6','b7','b8','b9','b10','b11','·','·'],
      ['g0','g1','g2','·','·','·','·','·'],
    ]);
    // 小组的批次顺序组号排在大组之后
    expect(m.groups.map(g=>g.index)).toEqual([1,2]);
  });
});

describe('同点分组排版：关系失效后重排',()=>{
  it('同点关系被剔除（记录编辑/删除）后重算分组：成员回归散张顺排',()=>{
    const ids=['a','x','b','y'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const withGroup=buildGroupedBatchModel(ids,all,[group(1,['x','y'])]);
    expect(idsOf(withGroup)).toEqual([['a','x','y','b','·','·','·','·']]);
    // 应用层已剔除失效结论后以空组重排：纯推导，不触碰批次本身
    const expired=buildGroupedBatchModel(ids,all,[]);
    expect(expired.groups).toEqual([]);
    expect(idsOf(expired)).toEqual([['a','x','b','y','·','·','·','·']]);
    expect(expired.mode).toBe('grouped');
    // 手工批次编号序列原样不变
    expect(ids).toEqual(['a','x','b','y']);
  });
  it('冲突组不传参与排版时成员全部按散张处理，顺序与顺排一致',()=>{
    const ids=['x','a','y'];
    const all=ids.map(id=>row({id,collectionNo:`A-${id}`}));
    const m=buildGroupedBatchModel(ids,all,[]); // 调用方（groupableSiteGroups）已整组排除
    expect(idsOf(m)).toEqual([['x','a','y','·','·','·','·','·']]);
    expect(m.groups).toEqual([]);
  });
});
