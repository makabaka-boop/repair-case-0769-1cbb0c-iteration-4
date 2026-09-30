import{beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen,UndoEntry}from'./types';
import{UNDO_KEY}from'./data';
import{BATCH_KEY}from'./batch';

const KEY='plant-preflight-v1';
const rec=(x:Partial<Specimen>={}):Specimen=>({id:'1',collectionNo:'A-001',species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'39.9',longitude:'116.2',habitat:'山坡',resolutions:{},...x});
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));
const seedUndo=(e:UndoEntry)=>localStorage.setItem(UNDO_KEY,JSON.stringify(e));
// 乱序异名表头：0 标本名 1 经度 2 采集编号(同名预填) 3 纬度 4 采集者 5 时间 6 产地 7 环境
const header='标本名,经度,采集编号,纬度,采集者,时间,产地,环境';
const goodCsv=`${header}\n兰,102.5,B-100,25.5,乙,2026-02-28,云南,林下\n杉,116.2,B-101,39.9,丙,2026-03-02,四川,沟谷`;

beforeEach(()=>{
  localStorage.clear();
  vi.restoreAllMocks();
  cleanup();
  // jsdom 26 未内置 Blob.text，供文件导入使用
  const proto=Blob.prototype as unknown as {text?:unknown};
  if(!proto.text){
    proto.text=function(this:Blob){
      return new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(this)});
    };
  }
});

const metric=(name:string)=>{
  const art=[...document.querySelectorAll('.metrics article')].find(a=>a.textContent!.includes(name))!;
  return art.querySelector('strong')!.textContent!;
};
const uploadCsv=(text:string,name='partner.csv')=>{
  const label=screen.getByText('导入 CSV').closest('label')!;
  const input=label.querySelector('input[type=file]')!;
  fireEvent.change(input,{target:{files:[new File([text],name,{type:'text/csv'})]}});
};
const mapDialog=()=>screen.getByRole('dialog',{name:'CSV 字段映射'});
const openMapDialog=async()=>{await screen.findByRole('dialog',{name:'CSV 字段映射'});return mapDialog()};
const mapField=(label:string,col:number)=>fireEvent.change(screen.getByRole('combobox',{name:`${label}来源列`}),{target:{value:String(col)}});
const mapAll=()=>{mapField('物种名称',0);mapField('经度',1);mapField('纬度',3);mapField('采集人',4);mapField('采集日期',5);mapField('地点',6);mapField('生境备注',7)};
const confirmMap=()=>fireEvent.click(screen.getByRole('button',{name:'确认导入'}));
const fieldRow=(label:string)=>[...document.querySelectorAll('.mapping-row')].find(r=>r.querySelector('span')!.textContent!.startsWith(label))!;

describe('CSV 字段映射导入',()=>{
  it('乱序异名表头：打开映射面板，同名列预填，确认后整批写入工作集',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv(goodCsv);
    expect(await openMapDialog()).toBeInTheDocument();
    // 与标准字段同名的“采集编号”列虽在第 3 位也自动对应，其余字段待选择
    expect(screen.getByRole('combobox',{name:'采集编号来源列'})).toHaveValue('2');
    expect(screen.getByRole('combobox',{name:'采集人来源列'})).toHaveValue('');
    // 预览保留原始行号与列值
    const preview=mapDialog().querySelector('.mapping-preview')!;
    expect(preview.textContent).toContain('标本名');
    expect([...preview.querySelectorAll('tbody tr td:first-child')].map(td=>td.textContent)).toEqual(['2','3']);

    mapAll();
    confirmMap();

    expect(await screen.findByText('成功导入 2 条，数据已完整写入')).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'CSV 字段映射'})).not.toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('3');
    const cards=[...document.querySelectorAll('.record')];
    expect(cards[1].textContent).toContain('B-100');
    expect(cards[1].textContent).toContain('兰');
    expect(cards[1].textContent).toContain('云南');
    expect(cards[1].textContent).toContain('25.5, 102.5');
    expect(cards[2].textContent).toContain('B-101');
    expect(cards[2].textContent).toContain('沟谷');
    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(stored).toHaveLength(3);
    expect(stored[1]).toMatchObject({collectionNo:'B-100',species:'兰',collector:'乙',date:'2026-02-28',location:'云南',latitude:'25.5',longitude:'102.5',habitat:'林下',resolutions:{}});
    expect(stored[1].id).toBeTruthy();
  });

  it('标准八列表头仍按原路径直接导入，不打开映射面板',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv('采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nD-009,兰,乙,2026-05-05,四川,30,104,林下');
    expect(await screen.findByText('成功导入 1 条，数据已完整写入')).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'CSV 字段映射'})).not.toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('2');
    expect(screen.getByText('D-009')).toBeInTheDocument();
  });

  it('来源列被重复选择时拦截提交：定位到字段行与来源列，工作集不变',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv(goodCsv);
    await openMapDialog();
    mapAll();
    mapField('采集人',2);// 与预填的采集编号同列
    confirmMap();

    expect(mapDialog()).toBeInTheDocument();
    expect(screen.getAllByText('来源列被重复选择')).toHaveLength(2);
    expect(fieldRow('采集编号').classList.contains('map-bad')).toBe(true);
    expect(fieldRow('采集人').classList.contains('map-bad')).toBe(true);
    expect(fieldRow('地点').classList.contains('map-bad')).toBe(false);
    const th=mapDialog().querySelector('.mapping-preview th.map-bad')!;
    expect(th.textContent).toBe('采集编号');
    // 当前映射保留供修正：改回不同列后即可成功
    expect(metric('馆藏记录')).toBe('1');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    mapField('采集人',4);
    confirmMap();
    expect(await screen.findByText('成功导入 2 条，数据已完整写入')).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('3');
  });

  it('必填映射缺失时拦截提交并定位到对应字段',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv(goodCsv);
    await openMapDialog();
    mapField('采集人',4);
    mapField('采集日期',5);// 地点等仍未映射
    confirmMap();

    expect(mapDialog()).toBeInTheDocument();
    expect(screen.getAllByText('必填字段未选择来源列').length).toBeGreaterThan(0);
    expect(fieldRow('地点').classList.contains('map-bad')).toBe(true);
    expect(fieldRow('采集人').classList.contains('map-bad')).toBe(false);
    expect(metric('馆藏记录')).toBe('1');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it('任一数据行不合法时整批不写入：定位到来源行并保留当前映射',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv(`${header}\n兰,102.5,B-100,25.5,乙,2026-02-28,云南,林下\n杉,116.2,B-101,39.9,丙,2026-02-30,四川,沟谷`);
    await openMapDialog();
    mapAll();
    confirmMap();

    expect(mapDialog()).toBeInTheDocument();
    expect(screen.getByText('第 3 行：采集日期不合法')).toBeInTheDocument();
    const badRow=mapDialog().querySelector('.mapping-preview tr.bad-row')!;
    expect(badRow.querySelector('td')!.textContent).toBe('3');
    expect(badRow.textContent).toContain('B-101');
    // 好行不部分写入，映射选择保留
    expect(metric('馆藏记录')).toBe('1');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(screen.getByRole('combobox',{name:'采集人来源列'})).toHaveValue('4');
    expect(screen.getByRole('combobox',{name:'地点来源列'})).toHaveValue('6');
  });

  it('取消映射不改变记录、撤销项和打印批次',async()=>{
    seed([rec()]);
    seedUndo({id:'1',savedAt:'2026-09-10T08:00:00.000Z',snapshot:rec({location:'旧地点'})});
    localStorage.setItem(BATCH_KEY,JSON.stringify(['1']));
    render(<App/>);
    expect(screen.getByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    uploadCsv(goodCsv);
    await openMapDialog();
    mapField('采集人',4);
    fireEvent.click(screen.getByRole('button',{name:'取消'}));

    expect(screen.queryByRole('dialog',{name:'CSV 字段映射'})).not.toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(UNDO_KEY)!)).toMatchObject({id:'1',snapshot:{location:'旧地点'}});
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['1']);
    expect(screen.getByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    expect(within(screen.getByRole('button',{name:/打印批次/})).getByText('1')).toBeInTheDocument();
  });

  it('失败提交不改变记录、撤销项和打印批次',async()=>{
    seed([rec()]);
    seedUndo({id:'1',savedAt:'2026-09-10T08:00:00.000Z',snapshot:rec({location:'旧地点'})});
    localStorage.setItem(BATCH_KEY,JSON.stringify(['1']));
    render(<App/>);
    uploadCsv(goodCsv);
    await openMapDialog();
    mapField('采集人',2);// 与采集编号同列，触发重复映射
    confirmMap();

    expect(mapDialog()).toBeInTheDocument();
    expect(screen.getAllByText('来源列被重复选择')).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(UNDO_KEY)!)).toMatchObject({id:'1',snapshot:{location:'旧地点'}});
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['1']);
    expect(screen.getByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    expect(within(screen.getByRole('button',{name:/打印批次/})).getByText('1')).toBeInTheDocument();
  });

  it('确认映射时本地写入失败：提示失败并保持原数据，面板与映射保留可重试',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv(goodCsv);
    await openMapDialog();
    mapAll();
    const originalSet=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string){
      if(key===KEY)throw new Error('quota');
      return originalSet.call(this,key,value);
    });
    confirmMap();
    vi.mocked(Storage.prototype.setItem).mockRestore();

    expect(await screen.findByText('无法导入：本地工作集写入失败，原数据已保持不变')).toBeInTheDocument();
    expect(mapDialog()).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    // 当前映射保留，存储恢复后重试即可成功
    expect(screen.getByRole('combobox',{name:'采集人来源列'})).toHaveValue('4');
    confirmMap();
    expect(await screen.findByText('成功导入 2 条，数据已完整写入')).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('3');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(3);
  });

  it('标准 CSV 写入失败时同样提示并保持原数据',async()=>{
    seed([rec()]);
    render(<App/>);
    const originalSet=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string){
      if(key===KEY)throw new Error('quota');
      return originalSet.call(this,key,value);
    });
    uploadCsv('采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nD-009,兰,乙,2026-05-05,四川,30,104,林下');
    expect(await screen.findByText('无法导入：本地工作集写入失败，原数据已保持不变')).toBeInTheDocument();
    vi.mocked(Storage.prototype.setItem).mockRestore();
    expect(screen.queryByRole('dialog',{name:'CSV 字段映射'})).not.toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(screen.queryByText('D-009')).not.toBeInTheDocument();
  });

  it('来源列带首尾空格：预览与导入都保留原始列值',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadCsv(`${header}\n 兰 ,102.5, B-100 ,25.5, 乙 ,2026-02-28,  云南  ,林下`);
    await openMapDialog();
    const firstRow=mapDialog().querySelector('.mapping-preview tbody tr')!;
    expect([...firstRow.querySelectorAll('td')].map(td=>td.textContent)).toEqual(
      ['2',' 兰 ','102.5',' B-100 ','25.5',' 乙 ','2026-02-28','  云南  ','林下']
    );
    mapAll();
    confirmMap();
    expect(await screen.findByText('成功导入 1 条，数据已完整写入')).toBeInTheDocument();
    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({collectionNo:' B-100 ',species:' 兰 ',collector:' 乙 ',location:'  云南  ',habitat:'林下'});
  });

  it('映射导入后编辑撤销与批次成员保持现有行为',async()=>{
    seed([rec()]);
    render(<App/>);
    // 导入前：编辑产生撤销项、现有记录加入批次
    fireEvent.click(screen.getByText('编辑'));
    const locationInput=screen.getByDisplayValue('北京');
    fireEvent.change(locationInput,{target:{value:'上海'}});
    fireEvent.click(screen.getByText('保存记录'));
    expect(await screen.findByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'加入批次'}));

    uploadCsv(goodCsv);
    await openMapDialog();
    mapAll();
    confirmMap();
    expect(await screen.findByText('成功导入 2 条，数据已完整写入')).toBeInTheDocument();

    // 导入后：撤销项仍在且可撤销，批次成员有效并可加入新记录
    fireEvent.click(screen.getByRole('button',{name:'撤销本次编辑'}));
    expect(await screen.findByText('已撤销对 A-001 的编辑，问题清单已重新计算')).toBeInTheDocument();
    expect(screen.getByText('北京',{selector:'dd'})).toBeInTheDocument();
    const b100=[...document.querySelectorAll('.record')].find(c=>c.textContent!.includes('B-100'))! as HTMLElement;
    fireEvent.click(within(b100).getByRole('button',{name:'加入批次'}));
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['1',JSON.parse(localStorage.getItem(KEY)!)[1].id]);
    fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
    const dialog=await screen.findByRole('dialog',{name:'打印批次预览'});
    const cells=[...dialog.querySelectorAll('.cell')].filter(c=>c.textContent);
    expect(cells.map(c=>c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('A-001'),expect.stringContaining('B-100')])
    );
  });
});
