import {beforeEach,describe,expect,it} from 'vitest';
import {BATCH_KEY,LABELS_PER_PAGE,addToBatch,buildBatchModel,loadBatch,pruneBatch,removeFromBatch,saveBatch} from './batch';
import {Specimen} from './types';

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
