import {beforeEach,describe,expect,it,vi} from 'vitest';
import {clearUndo,consumeUndo,csvLine,isSpecimen,loadUndo,parseBackup,parseUndo,saveUndo,importCsv,issuesFor,localToday,speciesCount,validCoords,validDate} from './data';
import {Specimen} from './types';

const row=(x:Partial<Specimen>):Specimen=>({id:'1',collectionNo:'A1',species:'松',collector:'甲',date:'2026-01-01',location:'北京',latitude:'39',longitude:'116',habitat:'',resolutions:{},...x});

describe('校验',()=>{
  it('严格校验日期和坐标',()=>{
    expect(validDate('2026-02-29')).toBe(false);
    expect(validDate('2024-02-29')).toBe(true);
    expect(validCoords('91','10')).toBe(false);
  });
  it('动态识别四类问题',()=>{
    const x=row({species:'',date:'2099-01-01',latitude:'99'});
    expect(issuesFor([x,{...x,id:'2'}]).map(i=>i.type)).toEqual(expect.arrayContaining(['物种名缺失','日期晚于当前日期','经纬度不合法','采集编号重复']));
  });
  it('CSV 失败保持原子且报告行号',()=>{
    const csv='采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nA1,松,乙,2026-02-30,云南,25,102,林下';
    const x=importCsv(csv,[row({})]);
    expect(x.rows).toBeUndefined();
    expect(x.errors.join()).toContain('第 2 行');
    expect(x.errors.join()).toContain('重复');
  });
  it('接受合法 CSV',()=>{
    const csv='采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nB2,兰,乙,2026-02-28,云南,25,102,林下';
    expect(importCsv(csv,[]).rows).toHaveLength(1);
  });
  it('csvLine 保留原始列值，标准 CSV 路径仍按原规则去首尾空格',()=>{
    expect(csvLine(' A-1 , 云南 ')).toEqual([' A-1 ',' 云南 ']);
    expect(csvLine('" 松 , 柏 ",x')).toEqual([' 松 , 柏 ','x']);
    const csv='采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\n B-9 , 兰 , 乙 ,2026-02-28, 云南 ,25,102, 林下 ';
    const x=importCsv(csv,[]);
    expect(x.errors).toEqual([]);
    expect(x.rows![0]).toMatchObject({collectionNo:'B-9',species:'兰',collector:'乙',location:'云南',habitat:'林下'});
  });
});

describe('回归：预检问题计算边界',()=>{
  it('仅首尾空格不同的同号记录：两条都标记为采集编号重复',()=>{
    const a=row({id:'1',collectionNo:'A-1'});
    const b=row({id:'2',collectionNo:'  A-1  '});
    const issues=issuesFor([a,b]);
    expect(issues.filter(i=>i.type==='采集编号重复').map(i=>i.recordId).sort()).toEqual(['1','2']);
  });
  it('本地零点后录入当天采集日期：不标记为晚于当前日期',()=>{
    // 上海时间 2026-09-10 00:30，UTC 仍是 2026-09-09；当天日期不应出现未来提示
    vi.stubEnv('TZ','Asia/Shanghai');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T16:30:00.000Z'));
    try{
      expect(localToday()).toBe('2026-09-10');
      const issues=issuesFor([row({date:'2026-09-10'})]);
      expect(issues.some(i=>i.type==='日期晚于当前日期')).toBe(false);
      // 真正的未来日期仍然被识别
      expect(issuesFor([row({date:'2026-09-11'})]).some(i=>i.type==='日期晚于当前日期')).toBe(true);
    }finally{
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
  it('十六进制等非十进制坐标不合法，仅十进制度数通过校验',()=>{
    expect(validCoords('0x27','0x74')).toBe(false);
    expect(validCoords('0x27','116.2')).toBe(false);
    expect(validCoords('39.9','0x74')).toBe(false);
    expect(validCoords('1e2','10')).toBe(false);
    expect(validCoords('Infinity','10')).toBe(false);
    expect(validCoords('39.9','116.2')).toBe(true);
    expect(validCoords('-33.86','+151.2')).toBe(true);
    expect(validCoords('90','180')).toBe(true);
    expect(validCoords('-90','-180')).toBe(true);
    expect(validCoords('90.0001','10')).toBe(false);
    expect(validCoords('','116')).toBe(false);
  });
  it('CSV 导入同样拒绝十六进制坐标',()=>{
    const csv='采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nB3,兰,乙,2026-02-28,云南,0x19,0x66,林下';
    const x=importCsv(csv,[]);
    expect(x.rows).toBeUndefined();
    expect(x.errors.join()).toContain('经纬度');
  });
  it('物种统计：空白不计数，仅首尾空格差异的同名只算一个',()=>{
    expect(speciesCount([
      row({id:'1',species:''}),
      row({id:'2',species:'   '}),
      row({id:'3',species:'银杏'}),
      row({id:'4',species:' 银杏 '}),
      row({id:'5',species:'柏'}),
    ])).toBe(2);
    expect(speciesCount([])).toBe(0);
  });
});

describe('JSON 备份解析',()=>{
  it('拒绝仅含采集编号或缺字段的记录',()=>{
    expect(parseBackup(JSON.stringify([{collectionNo:'A-1'},{collectionNo:'A-2'}]))).toBeNull();
    expect(parseBackup(JSON.stringify([row({}),{collectionNo:'A-2'}]))).toBeNull();
  });
  it('拒绝非数组、非对象记录与损坏文本',()=>{
    expect(parseBackup('{"a":1}')).toBeNull();
    expect(parseBackup('[1,2]')).toBeNull();
    expect(parseBackup('[null]')).toBeNull();
    expect(parseBackup('{损坏')).toBeNull();
  });
  it('为内部编号重复或空缺的记录分配新编号，其余记录保持原编号',()=>{
    const a=row({id:'x',collectionNo:'A-1'});
    const b=row({id:'x',collectionNo:'A-2'});
    const c=row({id:'',collectionNo:'A-3'});
    const d=row({id:'y',collectionNo:'A-4'});
    const out=parseBackup(JSON.stringify([a,b,c,d]));
    expect(out).not.toBeNull();
    expect(out!.map(r=>r.collectionNo)).toEqual(['A-1','A-2','A-3','A-4']);
    expect(out![0].id).toBe('x');
    expect(out![3].id).toBe('y');
    expect(out!.every(r=>r.id.length>0)).toBe(true);
    expect(new Set(out!.map(r=>r.id)).size).toBe(4);
  });
  it('合法备份原样通过，空数组也可恢复',()=>{
    const a=row({id:'a'});const b=row({id:'b'});
    expect(parseBackup(JSON.stringify([a,b]))).toEqual([a,b]);
    expect(parseBackup('[]')).toEqual([]);
  });
});

describe('撤销项',()=>{
  beforeEach(()=>localStorage.clear());
  const snap=(x:Partial<Specimen>={}):Specimen=>row({...x});
  const entry=()=>{const e=loadUndo();if(e==='invalid'||!e)throw new Error('撤销项缺失');return e};

  it('保存、读回并恢复整条记录',()=>{
    const a=snap({id:'a',collectionNo:'A-1',species:'松'});
    const b=snap({id:'b'});
    saveUndo('a',a,'2026-09-10T08:00:00.000Z');
    expect(loadUndo()).toEqual({id:'a',snapshot:a,savedAt:'2026-09-10T08:00:00.000Z'});
    const changed={...a,collectionNo:'A-2',species:'柏'};
    expect(consumeUndo([b,changed],entry())).toEqual([b,a]);
  });
  it('后续编辑替换旧快照，清除后不再可撤销',()=>{
    saveUndo('a',snap({id:'a',collectionNo:'A-1'}),'2026-09-10T08:00:00.000Z');
    saveUndo('a',snap({id:'a',collectionNo:'A-9'}),'2026-09-10T09:00:00.000Z');
    expect(entry().snapshot.collectionNo).toBe('A-9');
    clearUndo();
    expect(loadUndo()).toBeNull();
  });
  it('目标记录不存在时拒绝恢复',()=>{
    saveUndo('gone',snap({id:'gone'}));
    expect(consumeUndo([snap({id:'other'})],entry())).toBeNull();
  });
  it('快照缺字段、无法解析或 id 不一致时丢弃',()=>{
    const e=saveUndo('a',snap());
    const broken={...e,snapshot:{...e.snapshot,resolutions:undefined}};
    expect(parseUndo(JSON.stringify(broken))).toBeNull();
    expect(parseUndo('{不是 JSON')).toBeNull();
    expect(parseUndo(null)).toBeNull();
    expect(parseUndo(JSON.stringify({...e,id:'other'}))).toBeNull();
    expect(isSpecimen({...e.snapshot,latitude:9})).toBe(false);
    expect(isSpecimen({...e.snapshot,resolutions:{k:{status:'nope',note:''}}})).toBe(false);
  });
  it('存储中为损坏 JSON 时 loadUndo 返回 invalid 标记',()=>{
    localStorage.setItem('plant-preflight-undo-v1','{损坏');
    expect(loadUndo()).toBe('invalid');
  });
  it('旧版仅含标本数组的存储可直接加载（无撤销项）',()=>{
    localStorage.setItem('plant-preflight-v1',JSON.stringify([snap()]));
    expect(loadUndo()).toBeNull();
  });
});
