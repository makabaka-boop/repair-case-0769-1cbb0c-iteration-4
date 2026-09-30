import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{BATCH_KEY,LABELS_PER_PAGE}from'./batch';

const KEY='plant-preflight-v1';
const rec=(i:number,x:Partial<Specimen>={}):Specimen=>({id:`id${i}`,collectionNo:`A-00${i}`,species:`松 ${i} Pinus`,collector:'甲',date:'2026-03-01',location:'北京',latitude:'39.9',longitude:'116.2',habitat:'山坡',resolutions:{},...x});
const many=(n:number)=>Array.from({length:n},(_,i)=>rec(i+1));
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));
const sheetCells=()=>{
  const dialog=screen.getByRole('dialog',{name:'打印批次预览'});
  return [...dialog.querySelectorAll('.batch-sheet')].map(s=>[...s.querySelectorAll('.cell')] as HTMLElement[]);
};
const cardByName=(no:string):HTMLElement=>{
  const cards=[...document.querySelectorAll('.record')];
  return cards.find(c=>c.textContent!.includes(no))! as HTMLElement;
};
const addByNo=(no:string)=>{
  const c=cardByName(no);
  fireEvent.click(within(c).getByRole('button',{name:'加入批次'}));
};
const clickToggle=(no:string)=>{
  const c=cardByName(no);
  fireEvent.click(within(c).getByRole('button',{name:/批次/}));
};
const openPreview=()=>fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
const uploadJson=(text:string)=>{
  const label=screen.getByText('导入 JSON').closest('label')!;
  const input=label.querySelector('input[type=file]')!;
  fireEvent.change(input,{target:{files:[new File([text],'b.json',{type:'application/json'})]}});
};

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
afterEach(()=>document.body.classList.remove('batch-print'));

describe('打印批次闭环',()=>{
  it('加入/移出更新数量徽标与本地存储，重复加入不增量，顺序保持',async()=>{
    seed(many(3));
    render(<App/>);
    const btn=screen.getByRole('button',{name:/打印批次/});
    expect(within(btn).getByText('0')).toBeInTheDocument();
    addByNo('A-002');
    addByNo('A-001');
    expect(within(btn).getByText('2')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id2','id1']);
    // 再次点击同一张卡：按钮变为“移出批次”
    const c2=cardByName('A-002');
    expect(within(c2).getByRole('button',{name:'移出批次'})).toBeInTheDocument();
    fireEvent.click(within(c2).getByRole('button',{name:'移出批次'}));
    expect(within(btn).getByText('1')).toBeInTheDocument();
    // 重新加入 id2 排在 id1 之后；已是成员时重复操作不增量
    clickToggle('A-002');
    expect(within(btn).getByText('2')).toBeInTheDocument();
    fireEvent.click(within(c2).getByRole('button',{name:'移出批次'}));
    clickToggle('A-002');
    expect(within(btn).getByText('2')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1','id2']);
    openPreview();
    const cells=sheetCells();
    expect(cells).toHaveLength(1);
    expect(cells[0].slice(0,2).map(c=>c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('A-001'),expect.stringContaining('A-002')])
    );
    // 按加入顺序：先 id1 后 id2（再次加入 id2 不改变原位置）
    expect(cells[0][0]).toHaveTextContent('A-001');
    expect(cells[0][1]).toHaveTextContent('A-002');
    expect(cells[0].filter(c=>c.classList.contains('cell-blank'))).toHaveLength(LABELS_PER_PAGE-2);
  });

  it('八条以上记录跨页：每页 8 格，第二页承接余下记录',()=>{
    seed(many(9));
    render(<App/>);
    many(9).forEach(r=>addByNo(r.collectionNo));
    expect(within(screen.getByRole('button',{name:/打印批次/})).getByText('9')).toBeInTheDocument();
    openPreview();
    const cells=sheetCells();
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveLength(LABELS_PER_PAGE);
    expect(cells[0].every(c=>!c.classList.contains('cell-blank'))).toBe(true);
    expect(cells[0].map(c=>c.textContent!.match(/采集号 (\S+)/)![1])).toEqual(many(8).map(r=>r.collectionNo));
    expect(cells[1][0]).toHaveTextContent('A-009');
    expect(cells[1].slice(1).every(c=>c.classList.contains('cell-blank'))).toBe(true);
    expect(screen.getByText(/9 份标本/)).toBeInTheDocument();
    expect(screen.getByText(/共 2 页/)).toBeInTheDocument();
  });

  it('一次调用浏览器打印：打印全部标签只触发一次 window.print',()=>{
    seed(many(9));
    render(<App/>);
    const printSpy=vi.spyOn(window,'print').mockImplementation(()=>{});
    many(9).forEach(r=>addByNo(r.collectionNo));
    openPreview();
    fireEvent.click(screen.getByRole('button',{name:'打印全部标签'}));
    expect(printSpy).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('batch-print')).toBe(true);
  });

  it('空批次点击预览只反馈“请先选择标本”，不打开预览且不改变工作集',()=>{
    seed(many(2));
    render(<App/>);
    openPreview();
    expect(screen.getByText('请先选择标本')).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    expect([...document.querySelectorAll('.record')]).toHaveLength(2);
  });

  it('待处理问题在卡片格内与模态摘要提示，但打印按钮仍可点击',()=>{
    seed([rec(1,{species:''})]);
    render(<App/>);
    addByNo('A-001');
    openPreview();
    expect(screen.getByText(/1 份标本仍有 1 项待处理问题/)).toBeInTheDocument();
    expect(sheetCells()[0][0]).toHaveTextContent('待处理问题 1');
    const printSpy=vi.spyOn(window,'print').mockImplementation(()=>{});
    fireEvent.click(screen.getByRole('button',{name:'打印全部标签'}));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it('删除批次成员后打开预览自动剔除并明确提示；恰好清空时提示先选择标本',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    seed(many(2));
    render(<App/>);
    addByNo('A-001');addByNo('A-002');
    // 删除两张卡片
    fireEvent.click(within(cardByName('A-001')).getByRole('button',{name:'删除'}));
    fireEvent.click(within(cardByName('A-002')).getByRole('button',{name:'删除'}));
    openPreview();
    expect(await screen.findByText(/已自动剔除 2 条不存在于当前工作集的批次记录，请先选择标本/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    // 失效成员已从存储清理
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual([]);
  });

  it('仅部分成员失效时打开预览：剔除并提示，剩余成员正常分页打印',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    seed(many(3));
    render(<App/>);
    addByNo('A-001');addByNo('A-002');addByNo('A-003');
    fireEvent.click(within(cardByName('A-002')).getByRole('button',{name:'删除'}));
    openPreview();
    expect(await screen.findByText(/已自动剔除 1 条不存在于当前工作集的批次记录/)).toBeInTheDocument();
    const cells=sheetCells();
    expect(cells[0].slice(0,2).map(c=>c.textContent!.match(/采集号 (\S+)/)![1])).toEqual(['A-001','A-003']);
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1','id3']);
  });

  it('导入 JSON 替换工作集导致批次失效时，打开预览自动剔除并提示',async()=>{
    seed(many(2));
    render(<App/>);
    addByNo('A-001');addByNo('A-002');
    uploadJson(JSON.stringify([rec(9,{collectionNo:'NEW-1'})]));
    expect(await screen.findByText('已恢复 1 条记录')).toBeInTheDocument();
    openPreview();
    expect(await screen.findByText(/已自动剔除 2 条不存在于当前工作集的批次记录，请先选择标本/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
  });

  it('载入示例后失效成员在打开预览时清理，可与示例记录共存',async()=>{
    seed(many(1));
    render(<App/>);
    addByNo('A-001');
    fireEvent.click(screen.getByText('载入示例'));
    expect(await screen.findByText('示例数据已载入')).toBeInTheDocument();
    // 工具栏数量仍含失效编号（清理延迟到打开预览时）
    openPreview();
    expect(await screen.findByText(/已自动剔除 1 条不存在于当前工作集的批次记录，请先选择标本/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    // 把示例记录加入后可正常预览
    fireEvent.click(within(cardByName('BJ-2026-001')).getByRole('button',{name:'加入批次'}));
    openPreview();
    const cells=sheetCells();
    expect(cells[0][0]).toHaveTextContent('BJ-2026-001');
  });

  it('批次持久化：刷新（重新挂载）后仍按原顺序预览',()=>{
    seed(many(3));
    const{unmount}=render(<App/>);
    addByNo('A-003');addByNo('A-001');
    unmount();
    render(<App/>);
    openPreview();
    const cells=sheetCells();
    expect(cells[0].slice(0,2).map(c=>c.textContent!.match(/采集号 (\S+)/)![1])).toEqual(['A-003','A-001']);
  });

  it('关闭预览后可调整批次再次打开，工作集不受清理影响',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    seed(many(2));
    render(<App/>);
    addByNo('A-001');
    openPreview();
    fireEvent.click(screen.getByRole('button',{name:'关闭预览'}));
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    addByNo('A-002');
    openPreview();
    const cells=sheetCells();
    expect(cells[0].slice(0,2).map(c=>c.textContent!.match(/采集号 (\S+)/)![1])).toEqual(['A-001','A-002']);
    expect([...document.querySelectorAll('.record')]).toHaveLength(2);
  });
});
