import{beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen,UndoEntry}from'./types';
import{UNDO_KEY}from'./data';

const KEY='plant-preflight-v1';
const rec=(x:Partial<Specimen>={}):Specimen=>({id:'1',collectionNo:'A-001',species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'39.9',longitude:'116.2',habitat:'山坡',resolutions:{},...x});
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));
const seedUndo=(e:UndoEntry)=>localStorage.setItem(UNDO_KEY,JSON.stringify(e));

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
const setField=(label:string,value:string)=>{
  const lab=[...screen.getAllByText((_,el)=>!!el&&el.tagName==='SPAN'&&el.closest('.modal')!==null&&el.textContent!.startsWith(label))].find(s=>s.textContent===label||s.textContent===`${label} *`)!;
  const input=lab.parentElement!.querySelector('input,textarea')!;
  fireEvent.change(input,{target:{value}});
};
const saveForm=()=>fireEvent.click(screen.getByText('保存记录'));
const uploadFile=(labelText:string,file:File)=>{
  const label=screen.getByText(labelText).closest('label')!;
  const input=label.querySelector('input[type=file]')!;
  fireEvent.change(input,{target:{files:[file]}});
};

describe('编辑撤销主链路',()=>{
  it('保存编辑后显示带采集编号的撤销入口，撤销恢复整条记录、预检统计与标签预览同步回退',async()=>{
    seed([rec({species:'',latitude:'99'})]);
    render(<App/>);
    // 编辑前：2 条待处理问题（物种名缺失 + 坐标不合法），预览为空物种
    expect(metric('待处理问题')).toBe('2');
    expect(screen.getByText('物种名待补充')).toBeInTheDocument();

    fireEvent.click(screen.getByText('编辑'));
    setField('物种名称','柏 Cupressus');
    setField('纬度','40');
    saveForm();

    expect(await screen.findByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    expect(document.querySelector('.undo-bar')!.textContent).toContain('A-001');
    expect(metric('待处理问题')).toBe('0');
    expect(screen.queryByText('物种名待补充')).not.toBeInTheDocument();
    expect(screen.getByRole('heading',{level:2})).toHaveTextContent('柏 Cupressus');

    fireEvent.click(screen.getByRole('button',{name:'撤销本次编辑'}));
    // 入口消失，整条记录回到保存前
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(screen.getByText('物种名待补充')).toBeInTheDocument();
    expect(screen.getByText('99, 116.2')).toBeInTheDocument();
    expect(metric('待处理问题')).toBe('2');
    // 标签预览同样回退
    fireEvent.click(screen.getByText('打印标签预览'));
    const label=document.querySelector('.label')!;
    expect(label.textContent).toContain('（物种名待定）');
    expect(label.textContent).not.toContain('柏 Cupressus');
    // 撤销项已写回并清空
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject([{id:'1',species:'',latitude:'99'}]);
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
  });

  it('新增记录不产生撤销入口',async()=>{
    seed([rec()]);
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'＋ 新增标本'}));
    setField('采集编号','B-002');
    setField('采集人','乙');
    setField('采集日期','2026-04-01');
    setField('地点','云南');
    saveForm();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
  });

  it('后续编辑替换旧快照，撤销只回到最近一次保存前',async()=>{
    seed([rec({collectionNo:'A-001',location:'北京'})]);
    render(<App/>);
    fireEvent.click(screen.getByText('编辑'));
    setField('地点','上海');
    saveForm();
    expect(await screen.findByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    fireEvent.click(screen.getByText('编辑'));
    setField('地点','广州');
    saveForm();
    const entries=JSON.parse(localStorage.getItem(UNDO_KEY)!) as UndoEntry;
    expect(entries.snapshot.location).toBe('上海');
    fireEvent.click(screen.getByRole('button',{name:'撤销本次编辑'}));
    expect(screen.getByText('上海',{selector:'dd'})).toBeInTheDocument();
    expect(screen.queryByText('广州',{selector:'dd'})).not.toBeInTheDocument();
  });

  it('问题处置不进入撤销范围：先处置后撤销仍然恢复，且处置本身不产生撤销项',async()=>{
    seed([rec({species:''})]);
    render(<App/>);
    fireEvent.click(screen.getByText('编辑'));
    setField('物种名称','杉 Taxus');
    saveForm();
    await screen.findByRole('button',{name:'撤销本次编辑'});
    expect(metric('待处理问题')).toBe('0');
    // 撤销恢复后，记录重新带问题；处置该问题不应产生新的撤销项
    fireEvent.click(screen.getByRole('button',{name:'撤销本次编辑'}));
    expect(screen.getByText('物种名待补充')).toBeInTheDocument();
    expect(metric('待处理问题')).toBe('1');
    fireEvent.change(screen.getByDisplayValue('待处理'),{target:{value:'kept'}});
    expect(metric('待处理问题')).toBe('0');
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
  });
});

describe('撤销持久化与失效',()=>{
  it('刷新页面后仍可继续撤销',async()=>{
    // 模拟保存后的工作集 + 保存前快照
    localStorage.setItem(KEY,JSON.stringify([rec({collectionNo:'A-001',species:'已补',latitude:'40'})]));
    seedUndo({id:'1',savedAt:'2026-09-10T08:00:00.000Z',snapshot:rec({collectionNo:'A-001',species:'',latitude:'99'})});
    const{unmount}=render(<App/>);
    expect(screen.getByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
    expect(document.querySelector('.undo-bar')!.textContent).toContain('A-001');
    unmount();
    render(<App/>);
    fireEvent.click(await screen.findByRole('button',{name:'撤销本次编辑'}));
    expect(screen.getByText('物种名待补充')).toBeInTheDocument();
    expect(screen.getByText('99, 116.2')).toBeInTheDocument();
  });

  it('快照无法解析时丢弃并提示',async()=>{
    seed([rec()]);
    localStorage.setItem(UNDO_KEY,'{损坏');
    render(<App/>);
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(await screen.findByText('最近编辑已无法撤销')).toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
  });

  it('快照缺字段时丢弃并提示',async()=>{
    seed([rec()]);
    const bad={id:'1',savedAt:'2026-09-10T08:00:00.000Z',snapshot:{id:'1',collectionNo:'A-001'}};
    localStorage.setItem(UNDO_KEY,JSON.stringify(bad));
    render(<App/>);
    expect(await screen.findByText('最近编辑已无法撤销')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
  });

  it('目标记录已不存在时丢弃并提示，新工作集不受污染',async()=>{
    seed([rec({id:'9',collectionNo:'Z-999'})]);
    seedUndo({id:'1',savedAt:'2026-09-10T08:00:00.000Z',snapshot:rec()});
    render(<App/>);
    expect(await screen.findByText('最近编辑已无法撤销')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(screen.queryByText('A-001')).not.toBeInTheDocument();
    expect(screen.getByText('Z-999')).toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
  });
});

describe('清空撤销项的路径',()=>{
  beforeEach(()=>{vi.spyOn(window,'confirm').mockReturnValue(true)});

  const makeUndo=async()=>{
    seed([rec()]);
    render(<App/>);
    fireEvent.click(screen.getByText('编辑'));
    setField('地点','上海');
    saveForm();
    await screen.findByRole('button',{name:'撤销本次编辑'});
    expect(localStorage.getItem(UNDO_KEY)).not.toBeNull();
  };

  it('删除目标记录时清除撤销项，旧快照不污染新工作集',async()=>{
    await makeUndo();
    fireEvent.click(screen.getByText('删除'));
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
  });

  it('删除其他记录时保留撤销项',async()=>{
    seed([rec(),rec({id:'2',collectionNo:'B-002'})]);
    render(<App/>);
    const cards=screen.getAllByText('编辑');
    fireEvent.click(cards[1]);
    setField('地点','上海');
    saveForm();
    await screen.findByRole('button',{name:'撤销本次编辑'});
    // 删除第一条（非撤销目标）
    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(localStorage.getItem(UNDO_KEY)).not.toBeNull();
    expect(screen.getByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
  });

  it('导入 JSON 替换工作集时清除撤销项',async()=>{
    await makeUndo();
    const replacement=[rec({id:'10',collectionNo:'JSON-1',location:'新工作集'})];
    uploadFile('导入 JSON',new File([JSON.stringify(replacement)],'b.json',{type:'application/json'}));
    expect(await screen.findByText(/已恢复 1 条记录/)).toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(screen.getByText('JSON-1')).toBeInTheDocument();
    expect(screen.queryByText('A-001')).not.toBeInTheDocument();
  });

  it('载入示例时清除撤销项',async()=>{
    await makeUndo();
    fireEvent.click(screen.getByText('载入示例'));
    expect(await screen.findByText('示例数据已载入')).toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(screen.getByText('BJ-2026-001')).toBeInTheDocument();
  });

  it('清空数据时清除撤销项',async()=>{
    await makeUndo();
    fireEvent.click(screen.getByText('一键清空'));
    expect(await screen.findByText('已清空全部记录')).toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).toBeNull();
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
  });

  it('CSV 导入不清撤销项（仅规定路径才清除），新增行为保持原样',async()=>{
    await makeUndo();
    const csv='采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nD-009,兰,乙,2026-05-05,四川,30,104,林下';
    uploadFile('导入 CSV',new File([csv],'a.csv',{type:'text/csv'}));
    expect(await screen.findByText(/成功导入 1 条/)).toBeInTheDocument();
    expect(localStorage.getItem(UNDO_KEY)).not.toBeNull();
    expect(screen.getByRole('button',{name:'撤销本次编辑'})).toBeInTheDocument();
  });
});

describe('回归：原有行为',()=>{
  beforeEach(()=>{vi.spyOn(window,'confirm').mockReturnValue(true)});

  it('旧版仅含标本数组的本地数据可直接加载',()=>{
    localStorage.setItem(KEY,JSON.stringify([rec()]));
    render(<App/>);
    expect(screen.getByText('A-001')).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
  });

  it('问题处置（已修正/确认保留）更新统计并写回本地',async()=>{
    seed([rec({species:''})]);
    render(<App/>);
    expect(metric('待处理问题')).toBe('1');
    fireEvent.change(screen.getByDisplayValue('待处理'),{target:{value:'fixed'}});
    expect(metric('待处理问题')).toBe('0');
    const stored=JSON.parse(localStorage.getItem(KEY)!);
    expect(stored[0].resolutions['1:species']).toMatchObject({status:'fixed'});
  });

  it('导出 JSON 备份完整记录',async()=>{
    seed([rec()]);
    let captured:Blob|null=null;
    vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{captured=b as Blob;return 'blob:x'});
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    const clickSpy=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    render(<App/>);
    fireEvent.click(screen.getByText('导出 JSON'));
    expect(clickSpy).toHaveBeenCalled();
    const data=JSON.parse(await captured!.text());
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({id:'1',collectionNo:'A-001'});
  });

  it('单条打印调用 window.print 且记录字段进入标签预览',()=>{
    seed([rec()]);
    const printSpy=vi.spyOn(window,'print').mockImplementation(()=>{});
    render(<App/>);
    fireEvent.click(screen.getByText('打印标签预览'));
    const label=document.querySelector('.label')!;
    expect(label.textContent).toContain('A-001');
    expect(label.textContent).toContain('松 Pinus');
    fireEvent.click(within(label as HTMLElement).getByText('打印标签'));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it('非法 JSON 导入不改变当前数据',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadFile('导入 JSON',new File(['{"bad'],'b.json',{type:'application/json'}));
    expect(await screen.findByText('JSON 备份无效，当前数据未改变')).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
  });

  it('CSV 失败时不写入数据',async()=>{
    seed([rec()]);
    render(<App/>);
    const bad='采集编号,物种名称,采集人,采集日期,地点,纬度,经度,生境备注\nA-001,松,乙,2026-02-30,云南,25,102,林下';
    uploadFile('导入 CSV',new File([bad],'a.csv',{type:'text/csv'}));
    expect(await screen.findByText(/第 2 行/)).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
  });

  it('无撤销项时入口不显示',()=>{
    seed([rec()]);
    render(<App/>);
    expect(screen.queryByRole('button',{name:'撤销本次编辑'})).not.toBeInTheDocument();
    expect(document.querySelector('.undo-bar')).toBeNull();
  });
});

describe('回归：预检问题修复',()=>{
  it('本地零点后录入当天采集日期并保存，不出现未来日期提示',()=>{
    // 上海时间 2026-09-10 00:30，UTC 仍是 2026-09-09
    vi.stubEnv('TZ','Asia/Shanghai');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T16:30:00.000Z'));
    try{
      seed([rec({date:'2026-09-10'})]);
      render(<App/>);
      expect(screen.queryByText('日期晚于当前日期')).not.toBeInTheDocument();
      expect(screen.getByText('✓ 预检通过')).toBeInTheDocument();
      expect(metric('待处理问题')).toBe('0');
    }finally{
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it('录入十六进制坐标：保存后标记经纬度不合法，改为十进制度数后通过',async()=>{
    seed([]);
    render(<App/>);
    fireEvent.click(screen.getByRole('button',{name:'＋ 新增标本'}));
    setField('采集编号','H-001');
    setField('物种名称','松 Pinus');
    setField('采集人','甲');
    setField('采集日期','2026-03-01');
    setField('地点','北京');
    setField('纬度','0x27');
    setField('经度','0x74');
    saveForm();
    await screen.findByText('记录已保存，问题清单已重新计算');
    expect(screen.getByText('经纬度不合法')).toBeInTheDocument();
    expect(screen.getByText('0x27, 0x74')).toHaveClass('bad');
    expect(metric('待处理问题')).toBe('1');
    // 改为十进制度数后问题消失
    fireEvent.click(screen.getByText('编辑'));
    setField('纬度','39.9');
    setField('经度','116.2');
    saveForm();
    await screen.findByText('✓ 预检通过');
    expect(screen.queryByText('经纬度不合法')).not.toBeInTheDocument();
    expect(metric('待处理问题')).toBe('0');
  });

  it('物种统计：空白与纯空格不计数，仅首尾空格差异的同名只算一个',()=>{
    seed([
      rec({id:'1',collectionNo:'A-001',species:''}),
      rec({id:'2',collectionNo:'A-002',species:'   '}),
      rec({id:'3',collectionNo:'A-003',species:'银杏'}),
      rec({id:'4',collectionNo:'A-004',species:' 银杏  '}),
    ]);
    render(<App/>);
    expect(metric('物种数')).toBe('1');
  });
});

describe('回归：JSON 导入校验与重复内部编号记录操作',()=>{
  const dupJson=()=>JSON.stringify([
    rec({id:'dup',collectionNo:'D-001',species:'松 Pinus',location:'北京'}),
    rec({id:'dup',collectionNo:'D-002',species:'柏 Cupressus',location:'上海'}),
  ]);
  const uploadJson=(text:string)=>uploadFile('导入 JSON',new File([text],'b.json',{type:'application/json'}));

  it('拒绝仅含采集编号的备份并保留原数据，页面不白屏',async()=>{
    seed([rec()]);
    render(<App/>);
    uploadJson(JSON.stringify([{collectionNo:'X-1'},{collectionNo:'X-2'}]));
    expect(await screen.findByText('JSON 备份无效，当前数据未改变')).toBeInTheDocument();
    expect(metric('馆藏记录')).toBe('1');
    expect(screen.getByText('A-001')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it('导入内部编号重复的记录后，编辑仅修改所选记录',async()=>{
    seed([]);
    render(<App/>);
    uploadJson(dupJson());
    expect(await screen.findByText('已恢复 2 条记录')).toBeInTheDocument();
    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(new Set(stored.map(r=>r.id)).size).toBe(2);
    fireEvent.click(screen.getAllByText('编辑')[1]);
    setField('物种名称','杉 Taxus');
    saveForm();
    await screen.findByText('记录已保存，问题清单已重新计算');
    const cards=document.querySelectorAll('.record');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('松 Pinus');
    expect(cards[0].textContent).toContain('D-001');
    expect(cards[1].textContent).toContain('杉 Taxus');
    expect(cards[1].textContent).not.toContain('柏 Cupressus');
  });

  it('导入内部编号重复的记录后，删除仅移除所选记录',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    seed([]);
    render(<App/>);
    uploadJson(dupJson());
    await screen.findByText('已恢复 2 条记录');
    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(metric('馆藏记录')).toBe('1');
    expect(screen.queryByText('D-001')).not.toBeInTheDocument();
    expect(screen.getByText('D-002')).toBeInTheDocument();
  });

  it('重复内部编号记录编辑保存后，撤销仅恢复最近编辑的记录',async()=>{
    seed([]);
    render(<App/>);
    uploadJson(dupJson());
    await screen.findByText('已恢复 2 条记录');
    fireEvent.click(screen.getAllByText('编辑')[1]);
    setField('地点','广州');
    saveForm();
    fireEvent.click(await screen.findByRole('button',{name:'撤销本次编辑'}));
    await screen.findByText('已撤销对 D-002 的编辑，问题清单已重新计算');
    const cards=document.querySelectorAll('.record');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('北京');
    expect(cards[0].textContent).toContain('D-001');
    expect(cards[1].textContent).toContain('上海');
    expect(cards[1].textContent).not.toContain('广州');
  });
});
