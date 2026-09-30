import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import'@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{BATCH_KEY,LABELS_PER_PAGE}from'./batch';
import{EARTH_RADIUS_M,NEAR_KEY,NearConclusion,pairKey}from'./near';

const KEY='plant-preflight-v1';
const DEG=EARTH_RADIUS_M*Math.PI/180;
const lon=(meters:number)=>String(meters/DEG);
const rec=(i:number|string,x:Partial<Specimen>={}):Specimen=>({id:`id${i}`,collectionNo:`N-${i}`,species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'赤道',latitude:'0',longitude:'0',habitat:'',resolutions:{},...x});
const seed=(rs:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rs));
// 直接写入已确认结论（与逐对点击同一存储结构）：pairs 为 [a,b,'dup'|'sep']
const seedConclusions=(rs:Specimen[],pairs:[string,string,'dup'|'sep'][])=>{
  const byId=new Map(rs.map(r=>[r.id,r]));
  const entries=JSON.stringify(pairs.map(([a,b,v],i)=>{
    const[x,y]=a<b?[a,b]:[b,a];
    const A=byId.get(x)!,B=byId.get(y)!;
    const fp=(r:Specimen)=>JSON.stringify(['collectionNo','species','collector','date','latitude','longitude'].map(f=>(r as unknown as Record<string,string>)[f]));
    return{pairKey:pairKey(x,y),ids:[x,y],verdict:v==='dup'?'duplicate':'separate',prints:[fp(A),fp(B)],savedAt:`2026-01-0${i+1}T00:00:00.000Z`}satisfies NearConclusion;
  }));
  localStorage.setItem(NEAR_KEY,entries);
};
const no=(i:number|string)=>`N-${i}`;
const addByNo=(n:string)=>{
  const c=[...document.querySelectorAll('.record')].find(el=>el.textContent!.includes(n))!;
  fireEvent.click(within(c as HTMLElement).getByRole('button',{name:'加入批次'}));
};
const openPreview=()=>fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
const dialog=()=>screen.getByRole('dialog',{name:'打印批次预览'});
const toggle=()=>{const cb=screen.getByRole('checkbox',{name:'同点分组排版'})as HTMLInputElement;fireEvent.click(cb);return cb;};
const pageMatrix=(root:ParentNode)=>[...root.querySelectorAll('.batch-sheet')].map(
  s=>[...s.querySelectorAll('.cell')].map(c=>{
    const m=c.textContent!.match(/采集号 (\S+)/);
    return m?m[1]:c.classList.contains('cell-blank')?'·':'';
  })
);
const previewPages=()=>pageMatrix(dialog());
const printPages=()=>pageMatrix(document.querySelector('.batch-print-root')!);
const groupFlags=(root:ParentNode)=>[...root.querySelectorAll('.cell')].map(c=>c.textContent!.includes('同点组')?(c.querySelector('.cell-group')!.textContent):null);
const openNear=()=>fireEvent.click(screen.getByRole('button',{name:/^近地点复核/}));
const openDesk=()=>fireEvent.click(screen.getByRole('button',{name:'预检工作台'}));
const nearCard=(a:string,b:string)=>[...document.querySelectorAll('.near-pair')].find(c=>c.textContent!.includes(a)&&c.textContent!.includes(b))! as HTMLElement;
const setRadius=(v:string)=>fireEvent.change(screen.getByLabelText('复核半径，单位米'),{target:{value:v}});

beforeEach(()=>{
  localStorage.clear();
  vi.restoreAllMocks();
  cleanup();
  const proto=Blob.prototype as unknown as{text?:unknown};
  if(!proto.text){proto.text=function(this:Blob){return new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsText(this)})};}
});
afterEach(()=>document.body.classList.remove('batch-print'));

describe('同点分组排版（浏览器逐页核对）',()=>{
  it('组顺序按最早批次位置、不跨页补空格；预览与打印共用同一页模型',()=>{
    // 组 G1 = id2,id3（40 米内），id1/id4/id5/id6 为散张
    const rs=[rec(1,{longitude:lon(5000)}),rec(2),rec(3,{longitude:lon(40)}),
      rec(4,{longitude:lon(5100)}),rec(5,{longitude:lon(5200)}),rec(6,{longitude:lon(5300)})];
    seed(rs);
    seedConclusions(rs,[['id2','id3','dup']]);
    render(<App/>);
    // 批次顺序：散1, 组(id2,id3), 散4,散5,散6 —— 组的最早位置是第 2 位
    [1,2,3,4,5,6].forEach(i=>addByNo(no(i)));
    openPreview();
    // 默认仍是八张顺排
    expect(screen.getByText(/按加入顺序排列/)).toBeInTheDocument();
    expect(previewPages()).toEqual([[no(1),no(2),no(3),no(4),no(5),no(6),'·','·']]);
    const cb=toggle();
    expect(cb.checked).toBe(true);
    expect(screen.getByText(/同点分组排版 · 1 个确认同点组保持同页/)).toBeInTheDocument();
    // 6 张全部放得下一页：组内成员聚到一起，顺序为 散1 → 组(id2,id3) → 散4,5,6
    expect(previewPages()).toEqual([[no(1),no(2),no(3),no(4),no(5),no(6),'·','·']]);
    const flags=groupFlags(dialog());
    expect(flags).toEqual([null,'同点组 1','同点组 1',null,null,null,null,null]);
    // 实际打印（portal）与预览逐页、逐格完全一致，且为同一份模型的同一输出
    expect(printPages()).toEqual(previewPages());
    expect(groupFlags(document.querySelector('.batch-print-root')!)).toEqual(flags);
    // 排版是只读操作：手工批次存储仍是加入顺序
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual([1,2,3,4,5,6].map(i=>`id${i}`));
    // 取消勾选回到默认顺排
    toggle();
    expect(screen.getByText(/按加入顺序排列/)).toBeInTheDocument();
    expect(previewPages()).toEqual([[no(1),no(2),no(3),no(4),no(5),no(6),'·','·']]);
  });

  it('页边界：当前页放不下的小组补空格另起页，绝不跨页',()=>{
    // 6 散张 + 3 张同点组（id7,id8,id9）
    const rs=[1,2,3,4,5,6].map(i=>rec(i,{longitude:lon(5000+i*100)}))
      .concat([rec(7),rec(8,{longitude:lon(40)}),rec(9,{longitude:lon(80)})]);
    seed(rs);
    seedConclusions(rs,[['id7','id8','dup'],['id8','id9','dup']]);
    render(<App/>);
    [1,2,3,4,5,6,7,8,9].forEach(i=>addByNo(no(i)));
    openPreview();
    // 顺排：9 张正常跨页
    expect(previewPages()).toEqual([
      [1,2,3,4,5,6,7,8].map(no),
      [no(9),'·','·','·','·','·','·','·'],
    ]);
    toggle();
    // 分组：6 散张后 3 张组放不下余 2 格 → 补 2 空格、组整体在第 2 页
    expect(previewPages()).toEqual([
      [1,2,3,4,5,6].map(no).concat(['·','·']),
      [no(7),no(8),no(9),'·','·','·','·','·'],
    ]);
    expect(printPages()).toEqual(previewPages());
    expect(screen.getByText(/共 2 页/)).toBeInTheDocument();
  });

  it('超过八张的组按原顺序连续分页，中间不插空格',()=>{
    // 9 张全部同点：id1..id9，相邻 40 米都在 100 米半径候选内；结论直接全链确认
    const rs=Array.from({length:9},(_,i)=>rec(i+1,{longitude:lon(i*40)}));
    seed(rs);
    const pairs:[string,string,'dup'|'sep'][]=[];
    for(let i=1;i<=8;i++)pairs.push([`id${i}`,`id${i+1}`,'dup']);
    seedConclusions(rs,pairs);
    render(<App/>);
    [1,2,3,4,5,6,7,8,9].forEach(i=>addByNo(no(i)));
    openPreview();
    toggle();
    expect(previewPages()).toEqual([
      [1,2,3,4,5,6,7,8].map(no),
      [no(9),'·','·','·','·','·','·','·'],
    ]);
    // 九格全部标注为同点组 1（组连续跨页）
    const flats=groupFlags(dialog()).filter(Boolean);
    expect(flats).toEqual(Array(9).fill('同点组 1'));
    expect(printPages()).toEqual(previewPages());
  });

  it('冲突组不参与分组排版：成员保持顺排，警示照常显示且与关系检查同源',()=>{
    // id1-id2-id3 同点链，同时 id1、id3 被判两份 → 整组有矛盾，不得据此合并
    const rs=[rec(1),rec(2,{longitude:lon(40)}),rec(3,{longitude:lon(80)}),rec(4,{longitude:lon(5000)})];
    seed(rs);
    seedConclusions(rs,[['id1','id2','dup'],['id2','id3','dup'],['id1','id3','sep']]);
    render(<App/>);
    [1,2,3].forEach(i=>addByNo(no(i)));
    openPreview();
    expect(screen.getByRole('button',{name:/3 份标本涉及 1 项采集点关系冲突/})).toBeInTheDocument();
    toggle();
    // 有矛盾的同点组不合并：三张按批次原序排列、无同点组标注
    expect(previewPages()).toEqual([[no(1),no(2),no(3),'·','·','·','·','·']]);
    expect(groupFlags(dialog()).every(f=>f===null)).toBe(true);
    expect(screen.getByText(/同点分组排版 · 0 个确认同点组保持同页/)).toBeInTheDocument();
    // 冲突警示在分组模式下仍然存在、可定位，人工结论未被更改
    expect(screen.getByRole('button',{name:/3 份标本涉及 1 项采集点关系冲突/})).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toHaveLength(3);
  });

  it('打开预览默认顺排；关闭重开不保留勾选（旧数据恢复与默认八张顺排不变）',()=>{
    const rs=[rec(1),rec(2,{longitude:lon(40)})];
    seed(rs);
    seedConclusions(rs,[['id1','id2','dup']]);
    render(<App/>);
    addByNo(no(1));addByNo(no(2));
    openPreview();
    toggle();
    expect((screen.getByRole('checkbox',{name:'同点分组排版'})as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'关闭预览'}));
    openPreview();
    const cb=screen.getByRole('checkbox',{name:'同点分组排版'})as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(screen.getByText(/按加入顺序排列/)).toBeInTheDocument();
  });
});

describe('关系失效、记录编辑或批次变化后旧页模型立即失效',()=>{
  it('预览打开期间追加同点结论以外的关系操作不改批次；关系失效后预览立即关闭',()=>{
    // id1-id2 同点；预览分组后，在近地点页把 id2 的绑定结论改判不会失效（同对仍有效），
    // 而新增 id2-id3 同点后会改变可用分组——该操作通过改变有效关系使旧签名失配。
    const rs=[rec(1),rec(2,{longitude:lon(40)}),rec(3,{longitude:lon(80)})];
    seed(rs);
    seedConclusions(rs,[['id1','id2','dup']]);
    render(<App/>);
    addByNo(no(1));addByNo(no(2));addByNo(no(3));
    openPreview();
    toggle();
    expect(previewPages()).toEqual([[no(1),no(2),no(3),'·','·','·','·','·']]);
    expect(dialog().querySelectorAll('.cell-group')).toHaveLength(2);
    // 让 (id1,id2) 结论失效：切到近地点页，改判不影响有效性；真正的失效用编辑绑定字段验证于下例。
    // 这里验证新增一条同点关系（id2,id3）后旧页模型立即作废
    openNear();setRadius('100');
    fireEvent.click(within(nearCard(no(2),no(3))).getByRole('button',{name:'同点复采'}));
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    expect(document.querySelector('.batch-print-root')).toBeNull();
    // 重新打开：新关系已生效，三张同属一组（组仍不跨页）
    openDesk();openPreview();
    toggle();
    expect(groupFlags(dialog()).slice(0,3)).toEqual(['同点组 1','同点组 1','同点组 1']);
  });

  it('编辑记录后旧页模型立即关闭；改绑定字段使结论失效，重开后不再成组（手工批次不被改坏）',()=>{
    const rs=[rec(1),rec(2,{longitude:lon(40)})];
    seed(rs);
    seedConclusions(rs,[['id1','id2','dup']]);
    render(<App/>);
    addByNo(no(1));addByNo(no(2));
    openPreview();toggle();
    expect(dialog().querySelectorAll('.cell-group')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button',{name:'关闭预览'}));
    // 编辑 id2 的绑定字段（纬度）：记录编辑即令旧模型失效；结论同时失效并被物理剔除
    const c2=[...document.querySelectorAll('.record')].find(el=>el.textContent!.includes(no(2)))! as HTMLElement;
    fireEvent.click(within(c2).getByRole('button',{name:'编辑'}));
    const latLab=[...screen.getAllByText((_,el)=>!!el&&el.tagName==='SPAN'&&el.closest('.modal')!==null&&el.textContent==='纬度')][0];
    fireEvent.change(latLab.parentElement!.querySelector('input,textarea')!,{target:{value:'0.0001'}});
    fireEvent.click(screen.getByText('保存记录'));
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    expect(document.querySelector('.batch-print-root')).toBeNull();
    expect(JSON.parse(localStorage.getItem(NEAR_KEY)!)).toEqual([]);
    // 手工批次原样保留，重开分组模式后成员回归散张顺排
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1','id2']);
    openPreview();toggle();
    expect(groupFlags(dialog()).every(f=>f===null)).toBe(true);
    expect(previewPages()).toEqual([[no(1),no(2),'·','·','·','·','·','·']]);
  });

  it('批次变化（加入新成员）后旧页模型立即失效，重开包含新成员且手工批次未被排版破坏',()=>{
    const rs=[rec(1),rec(2,{longitude:lon(40)}),rec(3,{longitude:lon(5000)})];
    seed(rs);
    seedConclusions(rs,[['id1','id2','dup']]);
    render(<App/>);
    addByNo(no(1));addByNo(no(2));
    openPreview();toggle();
    expect(previewPages()).toEqual([[no(1),no(2),'·','·','·','·','·','·']]);
    // 预览打开期间把 id3 加入批次（底层卡片仍可操作）：旧模型立即作废
    addByNo(no(3));
    expect(screen.queryByRole('dialog',{name:'打印批次预览'})).not.toBeInTheDocument();
    // 手工批次保持加入顺序，未被分组重排改写
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1','id2','id3']);
    openPreview();
    expect(previewPages()).toEqual([[no(1),no(2),no(3),'·','·','·','·','·']]);
  });
});
