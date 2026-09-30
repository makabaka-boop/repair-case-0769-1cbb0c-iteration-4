import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{BATCH_KEY,LABELS_PER_PAGE}from'./batch';
import{EARTH_RADIUS_M}from'./near';

const KEY='plant-preflight-v1';
const DEG=EARTH_RADIUS_M*Math.PI/180;
const lon=(m:number)=>String(m/DEG);
// 同采集人/日期/物种、坐标合法：相邻编号经度相差 40 米，半径 100 内两两成对
const rec=(i:number,x:Partial<Specimen>={}):Specimen=>({id:`id${i}`,collectionNo:`G-${i}`,species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'赤道',latitude:'0',longitude:lon(40*(i-1)),habitat:'',resolutions:{},...x});
const seed=(rs:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rs));
const cardByName=(no:string):HTMLElement=>[...document.querySelectorAll('.record')].find(c=>c.textContent!.includes(no))! as HTMLElement;
const addByNo=(no:string)=>fireEvent.click(within(cardByName(no)).getByRole('button',{name:'加入批次'}));
const openPreview=()=>fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
const dialog=()=>screen.getByRole('dialog',{name:'打印批次预览'});
// 逐页读出每个单元格：空格记为 null，内容格取采集号
const sheetGrid=(root:ParentNode=document)=>[...root.querySelectorAll('.batch-sheet')].map(s=>[...s.querySelectorAll('.cell')].map(c=>c.classList.contains('cell-blank')?null:(c.textContent!.match(/采集号 (\S+)/)![1])));
const dialogSheets=()=>sheetGrid(dialog());
const printSheets=()=>sheetGrid(document.querySelector('.batch-print-root')!);
const openNear=()=>fireEvent.click(screen.getByRole('button',{name:/^近地点复核/}));
const openDesk=()=>fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
const setRadius=(v:string)=>fireEvent.change(screen.getByLabelText('复核半径，单位米'),{target:{value:v}});
const nearCards=()=>[...document.querySelectorAll('.near-pair')] as HTMLElement[];
const cardByNos=(a:string,b:string)=>nearCards().find(c=>c.textContent!.includes(a)&&c.textContent!.includes(b))!;
const markDup=(a:string,b:string)=>fireEvent.click(within(cardByNos(a,b)).getByRole('button',{name:'同点复采'}));
const markSep=(a:string,b:string)=>fireEvent.click(within(cardByNos(a,b)).getByRole('button',{name:'确为两份'}));
const modeGrouped=()=>fireEvent.click(within(dialog()).getByRole('button',{name:'同点分组排版'}));
const modeSequential=()=>fireEvent.click(within(dialog()).getByRole('button',{name:'手工八张顺排'}));

beforeEach(()=>{
  localStorage.clear();
  vi.restoreAllMocks();
  cleanup();
  const proto=Blob.prototype as unknown as {text?:unknown};
  if(!proto.text){
    proto.text=function(this:Blob){
      return new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(this)});
    };
  }
});
afterEach(()=>document.body.classList.remove('batch-print'));

describe('同点分组排版（浏览器）',()=>{
  it('默认顺排不变；切换分组后小组不跨页、空格补齐，再切回顺排恢复',()=>{
    // 7 张散点 + 3 张同点组（G-8/G-9/G-10）
    seed(Array.from({length:10},(_,i)=>rec(i+1)));
    render(<App/>);
    openNear();setRadius('100');
    markDup('G-8','G-9');markDup('G-9','G-10');
    openDesk();
    for(let i=1;i<=10;i++)addByNo(`G-${i}`);
    const batchBefore=localStorage.getItem(BATCH_KEY);
    openPreview();
    // 默认顺排：页 1 八张满，页 2 承接 G-9,G-10
    expect(dialogSheets()[0]).toEqual(Array.from({length:8},(_,i)=>`G-${i+1}`));
    expect(dialogSheets()[1].slice(0,2)).toEqual(['G-9','G-10']);
    expect(within(dialog()).getByText(/按加入顺序排列/)).toBeInTheDocument();
    // 切换分组：7 散点 + 1 空格，G-8/9/10 整组在第 2 页
    modeGrouped();
    expect(within(dialog()).getByRole('button',{name:'同点分组排版'})).toHaveAttribute('aria-pressed','true');
    expect(dialogSheets()[0]).toEqual(['G-1','G-2','G-3','G-4','G-5','G-6','G-7',null]);
    expect(dialogSheets()[1]).toEqual(['G-8','G-9','G-10',null,null,null,null,null]);
    expect(within(dialog()).getByText(/应用 1 个组/)).toBeInTheDocument();
    expect(within(dialog()).getByText(/补出 1 个空格/)).toBeInTheDocument();
    // 组内三格带同点组标记，空格在弹窗与打印根中都存在
    expect(dialog().querySelectorAll('.cell-group')).toHaveLength(3);
    // 排版只是视图：手工批次存储一字未改
    expect(localStorage.getItem(BATCH_KEY)).toBe(batchBefore);
    // 切回顺排：恢复默认八张顺排
    modeSequential();
    expect(dialogSheets()[0]).toEqual(Array.from({length:8},(_,i)=>`G-${i+1}`));
    expect(dialogSheets()[1].slice(0,2)).toEqual(['G-9','G-10']);
    expect(dialog().querySelectorAll('.cell-group')).toHaveLength(0);
  });

  it('预览与实际打印逐页同模型：弹窗与打印根的每格顺序、组标记与空格完全一致',()=>{
    vi.spyOn(window,'print').mockImplementation(()=>{});
    // 9 张构成同一同点组（相邻均 40 米）→ 超过 8 张，连续分页
    seed(Array.from({length:9},(_,i)=>rec(i+1)));
    render(<App/>);
    openNear();setRadius('100');
    for(let i=1;i<9;i++)markDup(`G-${i}`,`G-${i+1}`);
    openDesk();
    for(let i=1;i<=9;i++)addByNo(`G-${i}`);
    openPreview();
    modeGrouped();
    expect(dialogSheets()).toEqual([
      Array.from({length:8},(_,i)=>`G-${i+1}`),
      ['G-9',null,null,null,null,null,null,null],
    ]);
    // 打印根（实际打印内容）与弹窗逐页逐格一致
    expect(printSheets()).toEqual(dialogSheets());
    expect(document.querySelector('.batch-print-root')!.querySelectorAll('.cell-group').length)
      .toBe(dialog().querySelectorAll('.cell-group').length);
    fireEvent.click(within(dialog()).getByRole('button',{name:'打印全部标签'}));
    expect(window.print).toHaveBeenCalledOnce();
  });

  it('无有效同点关系时，分组排版与顺排逐页相同但每页仍 8 格',()=>{
    // G-4 放到 5000 米外，所有对都超出半径 → 没有可标记的组
    seed([rec(1),rec(2),rec(3),rec(4,{longitude:lon(5000)})]);
    render(<App/>);
    ['G-1','G-2','G-3','G-4'].forEach(addByNo);
    openPreview();
    const seq=dialogSheets();
    modeGrouped();
    expect(dialogSheets()).toEqual(seq);
    expect(within(dialog()).getByText(/应用 0 个组/)).toBeInTheDocument();
    expect(dialog().querySelectorAll('.batch-sheet')).toHaveLength(1);
    expect(dialog().querySelectorAll('.cell')).toHaveLength(LABELS_PER_PAGE);
  });

  it('冲突关系只显示警示：卷入冲突的整组不用于排版，成员维持手工批次顺序且无组标记',()=>{
    seed([rec(1),rec(2),rec(3),rec(4,{longitude:lon(5000)})]);
    render(<App/>);
    openNear();setRadius('100');
    markDup('G-1','G-2');markDup('G-2','G-3');markSep('G-1','G-3');
    openDesk();
    ['G-3','G-1','G-2','G-4'].forEach(addByNo);
    openPreview();
    modeGrouped();
    expect(within(dialog()).getByText(/0 个组/)).toBeInTheDocument();
    expect(within(dialog()).getByText(/1 个组卷入关系冲突，未用于排版/)).toBeInTheDocument();
    // 冲突链 3 张按手工批次顺序散排（G-3,G-1,G-2），没有任何同点组标记
    expect(dialogSheets()[0].slice(0,4)).toEqual(['G-3','G-1','G-2','G-4']);
    expect(dialog().querySelectorAll('.cell-group')).toHaveLength(0);
    // 警示仍在，且与“关系检查”同源：3 份涉及 1 项冲突
    expect(within(dialog()).getByRole('button',{name:/3 份标本涉及 1 项采集点关系冲突/})).toBeInTheDocument();
    expect(dialog().querySelectorAll('.cell-conflict')).toHaveLength(0);
    fireEvent.click(within(dialog()).getByRole('button',{name:/采集点关系冲突/}));
    expect(dialog().querySelectorAll('.cell-conflict')).toHaveLength(3);
  });

  it('旧页模型立即失效：预览打开期间批次变化，弹窗关闭并提示重新打开，不能照旧打印',()=>{
    const printSpy=vi.spyOn(window,'print').mockImplementation(()=>{});
    seed(Array.from({length:10},(_,i)=>rec(i+1)));
    render(<App/>);
    openNear();setRadius('100');
    markDup('G-8','G-9');markDup('G-9','G-10');
    openDesk();
    for(let i=1;i<=9;i++)addByNo(`G-${i}`);
    openPreview();modeGrouped();
    expect(screen.getByRole('dialog',{name:'打印批次预览'})).toBeInTheDocument();
    // 模态遮罩后仍可通过 DOM 触发卡片按钮（等同另一入口/快捷操作导致批次变化）
    addByNo('G-10');
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    expect(screen.getByText(/旧分页已失效，请重新打开预览/)).toBeInTheDocument();
    // 没有旧模型可打印：window.print 从未被调用
    expect(printSpy).not.toHaveBeenCalled();
    // 重新打开：新批次（10 张）重新成组排版，手工批次本身未被排版改坏
    openPreview();modeGrouped();
    expect(dialogSheets()[0]).toEqual(['G-1','G-2','G-3','G-4','G-5','G-6','G-7',null]);
    expect(dialogSheets()[1]).toEqual(['G-8','G-9','G-10',null,null,null,null,null]);
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(Array.from({length:10},(_,i)=>`id${i+1}`));
  });

  it('关系失效后旧模型作废：预览打开期间编辑组内绑定字段，弹窗关闭；重开后不再成组',()=>{
    vi.spyOn(window,'print').mockImplementation(()=>{});
    seed(Array.from({length:10},(_,i)=>rec(i+1)));
    render(<App/>);
    openNear();setRadius('100');
    markDup('G-8','G-9');markDup('G-9','G-10');
    openDesk();
    for(let i=1;i<=10;i++)addByNo(`G-${i}`);
    openPreview();modeGrouped();
    expect(dialogSheets()[1].slice(0,3)).toEqual(['G-8','G-9','G-10']);
    // 在卡片上编辑 G-9 的纬度（绑定字段）：相关结论失效 → 旧页模型立即作废
    const c=cardByName('G-9');
    fireEvent.click(within(c).getByRole('button',{name:'编辑'}));
    const latLabel=[...screen.getAllByText((_,el)=>!!el&&el.tagName==='SPAN'&&el.textContent==='纬度')][0];
    fireEvent.change(latLabel.parentElement!.querySelector('input')!,{target:{value:'0.0001'}});
    fireEvent.click(screen.getByText('保存记录'));
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    expect(screen.getByText(/旧分页已失效/)).toBeInTheDocument();
    // 重新打开分组排版：两条同点结论均失效，回到顺排分页
    openPreview();modeGrouped();
    expect(within(dialog()).getByText(/0 个组/)).toBeInTheDocument();
    expect(dialogSheets()[0]).toEqual(Array.from({length:8},(_,i)=>`G-${i+1}`));
    expect(dialogSheets()[1].slice(0,2)).toEqual(['G-9','G-10']);
  });

  it('关闭预览后改变关系（新确认同点），再开分组排版使用最新关系',()=>{
    seed(Array.from({length:3},(_,i)=>rec(i+1)));
    render(<App/>);
    ['G-1','G-2','G-3'].forEach(addByNo);
    openPreview();modeGrouped();
    expect(within(dialog()).getByText(/0 个组/)).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button',{name:'关闭预览'}));
    openNear();setRadius('100');
    markDup('G-1','G-2');markDup('G-2','G-3');
    openDesk();
    openPreview();modeGrouped();
    expect(within(dialog()).getByText(/应用 1 个组/)).toBeInTheDocument();
    expect(dialogSheets()[0].slice(0,3)).toEqual(['G-1','G-2','G-3']);
  });
});
