import{beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{EARTH_RADIUS_M,NEAR_KEY}from'./near';

const KEY='plant-preflight-v1';
const DEG=EARTH_RADIUS_M*Math.PI/180; // 赤道上每经度对应的米数
const lon=(meters:number)=>String(meters/DEG);
const rec=(i:number,x:Partial<Specimen>={}):Specimen=>({id:`id${i}`,collectionNo:`N-${i}`,species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'赤道',latitude:'0',longitude:'0',habitat:'',resolutions:{},...x});
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));
// 0 米、40 米、80 米：半径 100 内三对俱全，可构成 同点—同点—相异 的链式冲突
const seedChain=()=>seed([rec(1),rec(2,{longitude:lon(40)}),rec(3,{longitude:lon(80)})]);
const openCheck=()=>fireEvent.click(screen.getByRole('button',{name:/^关系检查/}));
const openNear=()=>fireEvent.click(screen.getByRole('button',{name:/^近地点复核/}));
const openDesk=()=>fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
const setRadius=(v:string)=>fireEvent.change(screen.getByLabelText('复核半径，单位米'),{target:{value:v}});
const nearCards=()=>[...document.querySelectorAll('.near-pair')] as HTMLElement[];
const cardByNos=(a:string,b:string)=>nearCards().find(c=>c.textContent!.includes(a)&&c.textContent!.includes(b))!;
const cardByName=(no:string):HTMLElement=>[...document.querySelectorAll('.record')].find(c=>c.textContent!.includes(no))! as HTMLElement;
const setField=(label:string,value:string)=>{
  const lab=[...screen.getAllByText((_,el)=>!!el&&el.tagName==='SPAN'&&el.closest('.modal')!==null&&el.textContent!.startsWith(label))].find(s=>s.textContent===label||s.textContent===`${label} *`)!;
  fireEvent.change(lab.parentElement!.querySelector('input,textarea')!,{target:{value}});
};
const editNo=(no:string,field:string,value:string)=>{
  fireEvent.click(within(cardByName(no)).getByRole('button',{name:'编辑'}));
  setField(field,value);
  fireEvent.click(screen.getByText('保存记录'));
};
const uploadFile=(labelText:string,file:File)=>{
  const label=screen.getByText(labelText).closest('label')!;
  fireEvent.change(label.querySelector('input[type=file]')!,{target:{files:[file]}});
};
// 标记链式冲突：(1,2) 同点复采、(2,3) 同点复采、(1,3) 确为两份；调用前需已在复核区且半径 100
const markChain=()=>{
  fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
  fireEvent.click(within(cardByNos('N-2','N-3')).getByRole('button',{name:'同点复采'}));
  fireEvent.click(within(cardByNos('N-1','N-3')).getByRole('button',{name:'确为两份'}));
};
const checkTab=()=>screen.getByRole('button',{name:/^关系检查/});

beforeEach(()=>{
  localStorage.clear();
  vi.restoreAllMocks();
  cleanup();
  delete(Element.prototype as unknown as Record<string,unknown>).scrollIntoView;
  // jsdom 26 未内置 Blob.text，供 JSON 备份导入使用
  const proto=Blob.prototype as unknown as {text?:unknown};
  if(!proto.text){
    proto.text=function(this:Blob){
      return new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(this)});
    };
  }
});

describe('采集点关系检查（只读）',()=>{
  it('旧版存储没有结论时显示空报告，且查看检查页不写入任何结论',()=>{
    seedChain();
    render(<App/>);
    openCheck();
    expect(screen.getByText('暂无有效复核结论')).toBeInTheDocument();
    // 只读：未复核的近地点对不会被自动写成已确认，工作集原样
    expect(localStorage.getItem(NEAR_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(3);
  });

  it('未复核的对不会被自动确认：检查页只读，结论存储与记录原样',()=>{
    seedChain();
    render(<App/>);
    openNear();
    setRadius('100');
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'同点复采'}));
    const rowsBefore=localStorage.getItem(KEY);
    openCheck();
    // 只有 1 条有效结论：1 个两记录分组、无冲突；其余两对仍是待复核而非被推断
    expect(screen.getByText('未发现冲突')).toBeInTheDocument();
    expect(screen.getByText('有效结论 1 条 · 同点复采分组 1 个')).toBeInTheDocument();
    expect(document.querySelector('.check-group')!.textContent).toContain('分组 1 · 2 条记录');
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(1);
    expect(localStorage.getItem(KEY)).toBe(rowsBefore);
    openNear();
    expect(within(cardByNos('N-1','N-3')).getByText('待复核')).toBeInTheDocument();
    expect(within(cardByNos('N-2','N-3')).getByText('待复核')).toBeInTheDocument();
  });

  it('链式同点复采与相异关系形成冲突：分组、冲突卡片与打印预览警示同源，点击警示定位标签',async()=>{
    seedChain();
    render(<App/>);
    openNear();
    setRadius('100');
    markChain();
    // 检查页：1 组 3 条记录、1 项冲突，最短同点路径 N-1 → N-2 → N-3
    openCheck();
    expect(screen.getByText('发现 1 项冲突')).toBeInTheDocument();
    expect(screen.getByText('有效结论 3 条 · 同点复采分组 1 个')).toBeInTheDocument();
    const card=document.querySelector('.check-conflict')!;
    expect(card.textContent).toContain('冲突 1 · N-1 × N-3');
    expect(card.textContent).toContain('相异关系：确为两份');
    expect([...card.querySelectorAll('.check-path li .number')].map(e=>e.textContent)).toEqual(['N-1','N-2','N-3']);
    const group=document.querySelector('.check-group')!;
    expect(group.textContent).toContain('分组 1 · 3 条记录');
    expect(group.querySelectorAll('li.check-hit')).toHaveLength(3);
    // 标签页徽标提示冲突数
    expect(checkTab().querySelector('.tab-count')).toHaveTextContent('1');
    // 打印预览：同一份计算结果，警示数字与检查页一致
    openDesk();
    for(const no of['N-1','N-2','N-3'])fireEvent.click(within(cardByName(no)).getByRole('button',{name:'加入批次'}));
    const scrollSpy=vi.fn();
    Element.prototype.scrollIntoView=scrollSpy;
    fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
    const warn=screen.getByRole('button',{name:/3 份标本涉及 1 项采集点关系冲突/});
    fireEvent.click(warn);
    const dialog=screen.getByRole('dialog',{name:'打印批次预览'});
    expect(dialog.querySelectorAll('.cell-conflict')).toHaveLength(3);
    expect(dialog.querySelectorAll('.cell-conflict-flag')).toHaveLength(3);
    // 定位滚动在状态更新后异步触发
    await vi.waitFor(()=>expect(scrollSpy).toHaveBeenCalled());
    // 打印输出（portal）不带定位高亮
    expect(document.querySelector('.batch-print-root')!.querySelectorAll('.cell-conflict')).toHaveLength(0);
  });

  it('批次只含冲突链上部分标本时，警示按实际卷入份数显示；成员不涉冲突则无警示',()=>{
    // 第四条记录远在半径之外，与任何对、任何冲突都无关
    seed([rec(1),rec(2,{longitude:lon(40)}),rec(3,{longitude:lon(80)}),rec(4,{collectionNo:'FAR-1',longitude:lon(5000)})]);
    render(<App/>);
    openNear();
    setRadius('100');
    markChain();
    openDesk();
    // 批次只含冲突链上的一端：1 份标本涉及 1 项冲突
    fireEvent.click(within(cardByName('N-1')).getByRole('button',{name:'加入批次'}));
    fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
    expect(screen.getByRole('button',{name:/1 份标本涉及 1 项采集点关系冲突/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'关闭预览'}));
    // 换成与冲突无关的记录：警示消失
    fireEvent.click(within(cardByName('N-1')).getByRole('button',{name:'移出批次'}));
    fireEvent.click(within(cardByName('FAR-1')).getByRole('button',{name:'加入批次'}));
    fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
    expect(screen.getByRole('dialog',{name:'打印批次预览'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/采集点关系冲突/})).toBeNull();
  });

  it('批次成员不涉任何冲突时不显示关系警示',()=>{
    seed([rec(1),rec(2,{longitude:lon(40)})]);
    render(<App/>);
    openNear();
    fireEvent.click(within(cardByNos('N-1','N-2')).getByRole('button',{name:'确为两份'}));
    openDesk();
    fireEvent.click(within(cardByName('N-1')).getByRole('button',{name:'加入批次'}));
    fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
    expect(screen.getByRole('dialog',{name:'打印批次预览'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/采集点关系冲突/})).toBeNull();
  });
});

describe('编辑、删除、撤销及备份恢复后即时重算',()=>{
  it('编辑绑定字段使结论失效：冲突即时消失；撤销编辑也不复活',()=>{
    seedChain();
    render(<App/>);
    openNear();
    setRadius('100');
    markChain();
    openCheck();
    expect(screen.getByText('发现 1 项冲突')).toBeInTheDocument();
    // 修改 N-3 的纬度（绑定字段）：(1,3)、(2,3) 结论失效并被物理剔除
    openDesk();
    editNo('N-3','纬度','0.0001');
    openCheck();
    expect(screen.getByText('未发现冲突')).toBeInTheDocument();
    expect(screen.getByText('有效结论 1 条 · 同点复采分组 1 个')).toBeInTheDocument();
    expect(checkTab().querySelector('.tab-count')).toBeNull();
    // 撤销本次编辑：字段回到确认时原文，但旧结论不复活，报告保持无冲突
    openDesk();
    fireEvent.click(screen.getByRole('button',{name:'撤销本次编辑'}));
    openCheck();
    expect(screen.getByText('未发现冲突')).toBeInTheDocument();
    expect(screen.getByText('有效结论 1 条 · 同点复采分组 1 个')).toBeInTheDocument();
  });

  it('删除记录后冲突即时消失；恢复同内部编号备份也不复活',async()=>{
    seedChain();
    render(<App/>);
    openNear();
    setRadius('100');
    markChain();
    openDesk();
    const backup=localStorage.getItem(KEY)!; // 删除前备份：三条记录、原内部编号
    vi.spyOn(window,'confirm').mockReturnValue(true);
    fireEvent.click(within(cardByName('N-3')).getByRole('button',{name:'删除'}));
    openCheck();
    expect(screen.getByText('未发现冲突')).toBeInTheDocument();
    expect(screen.getByText('有效结论 1 条 · 同点复采分组 1 个')).toBeInTheDocument();
    // 恢复备份：记录回来了，旧结论不复活，报告保持无冲突
    openDesk();
    uploadFile('导入 JSON',new File([backup],'b.json',{type:'application/json'}));
    expect(await screen.findByText('已恢复 3 条记录')).toBeInTheDocument();
    openCheck();
    expect(screen.getByText('未发现冲突')).toBeInTheDocument();
    expect(screen.getByText('有效结论 1 条 · 同点复采分组 1 个')).toBeInTheDocument();
  });
});
