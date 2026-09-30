import {describe,expect,it} from 'vitest';
import {Specimen} from './types';
import {buildMergedSpecimen,defaultSelections,getMergePair,mergeBatchIds,mergeRows} from './merge';
import type {MergeSelections} from './merge';

const row=(x:Partial<Specimen>):Specimen=>({id:'a',collectionNo:'A-001',species:'松',collector:'甲',date:'2026-01-01',location:'北京',latitude:'39',longitude:'116',habitat:'山坡',resolutions:{},...x});

describe('记录合并领域规则',()=>{
  const pair:[Specimen,Specimen]=[
    row({id:'a',species:'松',collector:'甲',location:'北京',habitat:'阳坡'}),
    row({id:'b',species:'柏',collector:'乙',location:'上海',habitat:'沟谷'}),
  ];

  it('按字段选择生成一条记录，保留项继续使用原内部编号和问题处置',()=>{
    const selections:MergeSelections={...defaultSelections(),species:1,collector:1,habitat:1};
    const merged=buildMergedSpecimen(pair,'b',selections);
    expect(merged).toMatchObject({
      id:'b',collectionNo:'A-001',species:'柏',collector:'乙',date:'2026-01-01',
      location:'北京',latitude:'39',longitude:'116',habitat:'沟谷',
    });
    expect(merged.resolutions).toEqual(pair[1].resolutions);
  });

  it('合并后的工作集仅移除被合并项并在保留项原位置写入结果',()=>{
    const merged=row({id:'b',species:'杉',location:'广州'});
    const c=row({id:'c',collectionNo:'C-1'});
    expect(mergeRows([pair[0],pair[1],c],'a',merged).map(r=>[r.id,r.collectionNo])).toEqual([
      ['b','A-001'],['c','C-1'],
    ]);
  });

  it('问题字段改取对方后旧处置一律丢弃：即使两条值相同，问题也回到待处理',()=>{
    // 保留项 a 曾把空物种名标记为“已修正”；字段选了对方（同样为空）→ 合并后问题仍在，
    // 但处置针对的是保留项原内容，来源已变，必须丢弃
    const a={...row({id:'a',species:''}),resolutions:{'a:species':{status:'fixed',note:'旧处置'}} as Specimen['resolutions']};
    const b=row({id:'b',species:''});
    expect(buildMergedSpecimen([a,b],'a',{...defaultSelections(),species:1}).resolutions).toEqual({});
  });

  it('字段全部取保留项时，合并后仍存在的问题处置延续；因合并而消失的问题处置剔除',()=>{
    const a={...row({id:'a',species:'',latitude:'99'}),resolutions:{
      'a:species':{status:'fixed',note:'确认无名'},
      'a:coords':{status:'kept',note:'坐标问题保留'},
    } as Specimen['resolutions']};
    const b=row({id:'b',species:'松',latitude:'40',longitude:'116'});
    // 全部取保留项：两个问题仍存在，处置都延续
    expect(buildMergedSpecimen([a,b],'a',defaultSelections()).resolutions).toEqual(a.resolutions);
    // 物种与坐标都取对方合法值：两个问题均消失，处置全部剔除
    expect(buildMergedSpecimen([a,b],'a',{...defaultSelections(),species:1,latitude:1}).resolutions).toEqual({});
  });

  it('只影响某问题字段的选择只重置该问题；不相关字段改取对方不影响其他处置',()=>{
    const a={...row({id:'a',date:'2099-01-01',latitude:'99'}),resolutions:{
      'a:future':{status:'kept',note:'确认未来日期'},
      'a:coords':{status:'fixed',note:'坐标已核对'},
    } as Specimen['resolutions']};
    const b=row({id:'b',date:'2099-01-01',latitude:'40',longitude:'116',location:'上海'});
    // 日期改取对方（问题字段来源变化 → 日期处置丢弃）；坐标取保留项（处置延续）；地点无关
    const merged=buildMergedSpecimen([a,b],'a',{...defaultSelections(),date:1,location:1});
    expect(merged.resolutions).toEqual({'a:coords':{status:'fixed',note:'坐标已核对'}});
  });

  it('保留项切换为另一条记录时，处置跟随新保留项，不带上另一条的处置',()=>{
    const a={...row({id:'a',species:''}),resolutions:{'a:species':{status:'fixed',note:'a 的处置'}} as Specimen['resolutions']};
    const b=row({id:'b',species:'松'});
    // 保留项是 b：其 resolutions 为空，a 的处置不会带过来
    expect(buildMergedSpecimen([a,b],'b',defaultSelections()).resolutions).toEqual({});
  });

  it('关系失效：记录删除、编号不同或同一条记录时拒绝合并',()=>{
    expect(getMergePair(pair,['a','missing']).error).toContain('已被删除');
    expect(getMergePair([pair[0],row({id:'b',collectionNo:'A-002'})],['a','b']).error).toContain('不再相同');
    expect(getMergePair(pair,['a','a']).error).toContain('不同记录');
  });

  it('回归：仅首尾空格不同的同号记录允许合并',()=>{
    const a=row({id:'a',collectionNo:'A-001'});
    const b=row({id:'b',collectionNo:'  A-001  '});
    expect(getMergePair([a,b],['a','b']).pair).toEqual([a,b]);
    // 空白编号仍不允许合并
    expect(getMergePair([row({id:'a',collectionNo:' '}),row({id:'b',collectionNo:''})],['a','b']).error).toContain('不再相同');
  });

  it('被合并项在批次中改指保留项，并只留下首次出现的较早位置',()=>{
    expect(mergeBatchIds(['b','a','c','b'],'a','b')).toEqual(['b','c']);
    expect(mergeBatchIds(['a','b','c'],'a','b')).toEqual(['b','c']);
    expect(mergeBatchIds(['x','a','y'],'a','b')).toEqual(['x','b','y']);
  });
});
