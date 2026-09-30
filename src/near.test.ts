import{beforeEach,describe,expect,it,vi}from'vitest';
import{EARTH_RADIUS_M,MIN_RADIUS,MAX_RADIUS,NEAR_KEY,buildConclusion,fingerprint,findNearPairs,formatMeters,haversineMeters,isConclusionFresh,loadConclusions,pairKey,parseRadius,reconcileConclusions,saveConclusions,shortestLonDelta,upsertConclusion,verdictLabel}from'./near';
import{Specimen}from'./types';

const row=(x:Partial<Specimen>):Specimen=>({id:'r1',collectionNo:'A-001',species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'0',longitude:'0',habitat:'',resolutions:{},...x});
// 在赤道上：1 度经度约为 EARTH_RADIUS_M·π/180 米
const DEG=EARTH_RADIUS_M*Math.PI/180;
const lonFor=(meters:number)=>meters/DEG;

beforeEach(()=>localStorage.clear());

describe('半径解析：只接受 1～1000 米的十进制数字',()=>{
  it('合法整数与小数',()=>{
    expect(parseRadius('1')).toBe(1);
    expect(parseRadius('1000')).toBe(1000);
    expect(parseRadius(' 50 ')).toBe(50);
    expect(parseRadius('12.5')).toBeCloseTo(12.5);
  });
  it('越界、非数字、科学计数法一律拒绝',()=>{
    for(const bad of['0','0.5','1001','1000.1','','  ','abc','1e2','0x10','-5','NaN']){
      expect(parseRadius(bad),`输入 ${bad}`).toBeNull();
    }
  });
  it('边界常量',()=>{expect(MIN_RADIUS).toBe(1);expect(MAX_RADIUS).toBe(1000)});
});

describe('跨 180° 经线的最短经度差',()=>{
  it('普通差值保持不变',()=>{
    expect(shortestLonDelta(20)).toBe(20);
    expect(shortestLonDelta(-20)).toBe(-20);
  });
  it('越过 ±180 时取最短方向',()=>{
    expect(shortestLonDelta(350)).toBeCloseTo(-10);
    expect(shortestLonDelta(-350)).toBeCloseTo(10);
    expect(shortestLonDelta(190)).toBeCloseTo(-170);
    expect(shortestLonDelta(-190)).toBeCloseTo(170);
  });
  it('恰在对侧统一为 180',()=>{
    expect(shortestLonDelta(180)).toBe(180);
    expect(shortestLonDelta(-180)).toBe(180);
  });
});

describe('球面距离与边界判定（使用未舍入值）',()=>{
  it('重合点距离为 0',()=>{
    expect(haversineMeters(39.9,116.2,39.9,116.2)).toBe(0);
  });
  it('赤道上约 100 米：恰好处于半径 100 的边界内（≤，含边界）',()=>{
    const d=haversineMeters(0,0,0,lonFor(100));
    expect(Math.abs(d-100)).toBeLessThan(1e-6);
    expect(d<=100).toBe(true);
    const pair=findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lonFor(100))})],100);
    expect(pair).toHaveLength(1);
    expect(pair[0].ids).toEqual(['a','b']);
  });
  it('略超边界（约 1 毫米）在半径外，但展示保留一位小数后看起来仍是 100.0 米',()=>{
    const lon=lonFor(100.001);
    const d=haversineMeters(0,0,0,lon);
    expect(d).toBeGreaterThan(100);
    expect(formatMeters(d)).toBe('100.0 米');
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],100)).toEqual([]);
    // 半径放到 1000 米时重新出现
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],1000)).toHaveLength(1);
  });
  it('距离严格超出半径时不配对',()=>{
    const lon=lonFor(150);
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],100)).toEqual([]);
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],149)).toEqual([]);
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],160)).toHaveLength(1);
  });
  it('距离展示保留一位小数，判定不使用展示值',()=>{
    const lon=lonFor(3.04);
    const d=haversineMeters(0,0,0,lon);
    expect(formatMeters(d)).toBe('3.0 米');
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],3)).toEqual([]);
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',longitude:String(lon)})],4)).toHaveLength(1);
  });
});

describe('经线两侧配对',()=>{
  it('179.99 与 -179.99 按约 2 公里间距计算，不被当成 359.99 度',()=>{
    const d=haversineMeters(0,179.99,0,-179.99);
    expect(d).toBeLessThan(3000);
    expect(d).toBeGreaterThan(1000);
    const pair=[row({id:'a',collectionNo:'A',longitude:'179.99'}),row({id:'b',collectionNo:'B',longitude:'-179.99'})];
    expect(findNearPairs(pair,1000)).toEqual([]);
  });
  it('贴近 180° 两侧（各离经线 50 米，合计约 100 米）可在小半径内配对',()=>{
    const dLon=50/DEG;
    const pair=[row({id:'a',collectionNo:'A',longitude:String(180-dLon)}),row({id:'b',collectionNo:'B',longitude:String(-180+dLon)})];
    const got=findNearPairs(pair,100);
    expect(got).toHaveLength(1);
    expect(got[0].distance).toBeLessThanOrEqual(100);
    // 输入顺序反过来，对的 ID 排序仍一致
    const got2=findNearPairs([...pair].reverse(),100);
    expect(got2[0].ids).toEqual(['a','b']);
  });
  it('180° 与 -180° 是同一条经线：同点距离 0；真正的对跖点约半个赤道',()=>{
    expect(haversineMeters(0,180,0,-180)).toBe(0);
    const d=haversineMeters(0,0,0,180);
    expect(Math.abs(d-EARTH_RADIUS_M*Math.PI)).toBeLessThan(1);
  });
});

describe('筛选：同采集人、同日期、同物种、编号不同、坐标有效',()=>{
  it('采集人/日期/物种任一不同都不配对；都相同且邻近才配对',()=>{
    const near=(x:Partial<Specimen>)=>row({id:'r'+Math.random(),collectionNo:'X',longitude:String(lonFor(50)),...x});
    expect(findNearPairs([near({id:'a',collectionNo:'A'}),near({id:'b',collectionNo:'B',collector:'乙'})],100)).toEqual([]);
    expect(findNearPairs([near({id:'a',collectionNo:'A'}),near({id:'b',collectionNo:'B',date:'2026-03-02'})],100)).toEqual([]);
    expect(findNearPairs([near({id:'a',collectionNo:'A'}),near({id:'b',collectionNo:'B',species:'柏'})],100)).toEqual([]);
    expect(findNearPairs([near({id:'a',collectionNo:'A'}),near({id:'b',collectionNo:'B'})],100)).toHaveLength(1);
  });
  it('物种与采集人按去首尾空格比较',()=>{
    const got=findNearPairs([
      row({id:'a',collectionNo:'A',species:'松 ',collector:' 甲',longitude:'0'}),
      row({id:'b',collectionNo:'B',species:' 松',collector:'甲 ',longitude:String(lonFor(50))}),
    ],100);
    expect(got).toHaveLength(1);
  });
  it('采集编号相同（去空格）不配对，交给“采集编号重复”问题',()=>{
    const got=findNearPairs([
      row({id:'a',collectionNo:'A-1',longitude:'0'}),
      row({id:'b',collectionNo:' A-1 ',longitude:String(lonFor(10))}),
    ],100);
    expect(got).toEqual([]);
  });
  it('编号不同才进入复核',()=>{
    const got=findNearPairs([
      row({id:'a',collectionNo:'A-1',longitude:'0'}),
      row({id:'b',collectionNo:'A-2 ',longitude:String(lonFor(10))}),
    ],100);
    expect(got).toHaveLength(1);
  });
  it('坐标缺失或非法的记录不参与配对',()=>{
    const bad=[row({id:'a',collectionNo:'A',latitude:''}),row({id:'b',collectionNo:'B',latitude:'91'})];
    expect(findNearPairs(bad,1000)).toEqual([]);
    // 一方无效也不配对
    expect(findNearPairs([row({id:'a',collectionNo:'A'}),row({id:'b',collectionNo:'B',latitude:'91',longitude:String(lonFor(10))})],100)).toEqual([]);
  });
  it('分组字段为空（采集人/日期/物种/编号）的记录不参与',()=>{
    expect(findNearPairs([row({id:'a',collectionNo:'A',collector:''}),row({id:'b',collectionNo:'B',collector:'',longitude:String(lonFor(10))})],100)).toEqual([]);
    expect(findNearPairs([row({id:'a',collectionNo:'A',date:''}),row({id:'b',collectionNo:'B',date:'',longitude:String(lonFor(10))})],100)).toEqual([]);
    expect(findNearPairs([row({id:'a',collectionNo:'A',species:''}),row({id:'b',collectionNo:'B',species:'',longitude:String(lonFor(10))})],100)).toEqual([]);
  });
});

describe('每对只出现一次、按内部 ID 稳定排序、不做传递推断',()=>{
  const trio=()=>[
    row({id:'z9',collectionNo:'C',longitude:String(lonFor(90))}),
    row({id:'a1',collectionNo:'A',longitude:'0'}),
    row({id:'m5',collectionNo:'B',longitude:String(lonFor(40))}),
  ];
  it('三记录全邻近：恰好 3 对，按 ID 排序，输入乱序不影响结果',()=>{
    const got=findNearPairs(trio(),100);
    expect(got.map(p=>p.ids)).toEqual([['a1','m5'],['a1','z9'],['m5','z9']]);
  });
  it('不把 A—B、B—C 推断成 A—C：端点超距时只有相邻两对',()=>{
    const rows=[
      row({id:'a',collectionNo:'A',longitude:'0'}),
      row({id:'b',collectionNo:'B',longitude:String(lonFor(80))}),
      row({id:'c',collectionNo:'C',longitude:String(lonFor(160))}),
    ];
    const got=findNearPairs(rows,100);
    expect(got.map(p=>p.ids)).toEqual([['a','b'],['b','c']]);
  });
  it('四条记录同组时组合数为 C(4,2)，无重复无遗漏',()=>{
    const rows=Array.from({length:4},(_,i)=>row({id:`id${i}`,collectionNo:`N${i}`,longitude:String(lonFor(i*20))}));
    expect(findNearPairs(rows,1000)).toHaveLength(6);
  });
});

describe('指纹与结论失效',()=>{
  const a=row({id:'a',collectionNo:'A'});
  const b=row({id:'b',collectionNo:'B',longitude:String(lonFor(50))});
  it('指纹覆盖编号、物种、采集人、日期、坐标六个字段',()=>{
    const base=fingerprint(a);
    for(const[f,v]of[['collectionNo','A2'],['species','柏'],['collector','乙'],['date','2026-03-02'],['latitude','1'],['longitude','2']] as const){
      expect(fingerprint({...a,[f]:v})).not.toBe(base);
    }
    // 地点与生境备注不在绑定范围内
    expect(fingerprint({...a,location:'别处',habitat:'改了'})).toBe(base);
  });
  it('双方字段一致时结论有效；任一方修改绑定字段即失效；改地点不失效',()=>{
    const c=buildConclusion([a,b],'a','b','duplicate')!;
    const byId=new Map([a,b].map(r=>[r.id,r]));
    expect(isConclusionFresh(c,byId)).toBe(true);
    expect(isConclusionFresh(c,new Map([['a',{...a,latitude:'0.001'}],['b',b]]))).toBe(false);
    expect(isConclusionFresh(c,new Map([['a',a],['b',{...b,collectionNo:'B2'}]]))).toBe(false);
    expect(isConclusionFresh(c,new Map([['a',{...a,location:'新地点'}],['b',b]]))).toBe(true);
  });
  it('任一方记录被删除则结论失效',()=>{
    const c=buildConclusion([a,b],'a','b','duplicate')!;
    expect(isConclusionFresh(c,new Map([['a',a]]))).toBe(false);
  });
  it('reconcileConclusions 只剔除失效结论，其他对与暂被半径隐藏的对都保留',()=>{
    const c1=buildConclusion([a,b],'a','b','duplicate')!;
    const other=row({id:'x',collectionNo:'X'});
    const y=row({id:'y',collectionNo:'Y',longitude:String(lonFor(500))});
    const c2=buildConclusion([other,y],'x','y','separate')!;
    const kept=reconcileConclusions([c1,c2],[{...a,latitude:'0.001'},b,other,y]);
    expect(kept.map(c=>c.pairKey)).toEqual([pairKey('x','y')]);
  });
  it('结论 ID 按内部 ID 排序，指纹顺序与 ID 顺序一致（与谁先点按钮无关）',()=>{
    const c=buildConclusion([a,b],'b','a','duplicate')!;
    expect(c.ids).toEqual(['a','b']);
    expect(c.pairKey).toBe(pairKey('b','a'));
    expect(c.prints[0]).toBe(fingerprint(a));
    expect(verdictLabel(c.verdict)).toBe('同点复采');
    expect(verdictLabel('separate')).toBe('确为两份');
  });
  it('双方缺失或同一 ID 时不生成结论',()=>{
    expect(buildConclusion([a],'a','b','duplicate')).toBeNull();
    expect(buildConclusion([a,b],'a','a','duplicate')).toBeNull();
  });
});

describe('结论存取与失败处理',()=>{
  const a=row({id:'a',collectionNo:'A'});
  const b=row({id:'b',collectionNo:'B'});
  it('save/load 往返，键独立于工作集与批次',()=>{
    const c=buildConclusion([a,b],'a','b','duplicate')!;
    expect(saveConclusions([c])).toBe(true);
    expect(NEAR_KEY).not.toBe('plant-preflight-v1');
    expect(loadConclusions()).toEqual([c]);
  });
  it('upsert 覆盖同对旧结论并按 pairKey 排序',()=>{
    const c1=buildConclusion([a,b],'a','b','duplicate')!;
    const c2={...c1,verdict:'separate' as const,savedAt:'later'};
    const next=upsertConclusion([c1],c2);
    expect(next).toHaveLength(1);
    expect(next[0].verdict).toBe('separate');
  });
  it('存储损坏、非数组或含非法条目时安静回退为空/合法子集',()=>{
    localStorage.setItem(NEAR_KEY,'{损坏');
    expect(loadConclusions()).toEqual([]);
    localStorage.setItem(NEAR_KEY,JSON.stringify({a:1}));
    expect(loadConclusions()).toEqual([]);
    const c=buildConclusion([a,b],'a','b','duplicate')!;
    localStorage.setItem(NEAR_KEY,JSON.stringify([c,{pairKey:'bad'},42]));
    expect(loadConclusions()).toEqual([c]);
  });
  it('同对的残留多条只保留最先出现的一条',()=>{
    const c1=buildConclusion([a,b],'a','b','duplicate')!;
    const c2={...c1,savedAt:'later',verdict:'separate' as const};
    localStorage.setItem(NEAR_KEY,JSON.stringify([c1,c2]));
    expect(loadConclusions()).toEqual([c1]);
  });
  it('写入失败（配额异常）返回 false 且不改动已存内容',()=>{
    const c=buildConclusion([a,b],'a','b','duplicate')!;
    saveConclusions([c]);
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('quota','QuotaExceededError')});
    expect(saveConclusions([])).toBe(false);
    spy.mockRestore();
    expect(loadConclusions()).toEqual([c]);
  });
});
