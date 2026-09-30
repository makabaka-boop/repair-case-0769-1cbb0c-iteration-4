import{beforeEach,describe,expect,it,vi}from'vitest';
import React from'react';
import{cleanup,fireEvent,render,screen,within}from'@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from'./App';
import{Specimen}from'./types';
import{BATCH_KEY}from'./batch';

const KEY='plant-preflight-v1';
const rec=(x:Partial<Specimen>):Specimen=>({id:'id1',collectionNo:'A-001',species:'松 Pinus',collector:'甲',date:'2026-03-01',location:'北京',latitude:'39.9',longitude:'116.2',habitat:'山坡',resolutions:{},...x});
const pair=():Specimen[]=>[
  rec({id:'id1',species:'松 Pinus',collector:'甲',location:'北京',habitat:'阳坡'}),
  rec({id:'id2',species:'柏 Cupressus',collector:'乙',location:'上海',habitat:'沟谷'}),
];
const seed=(rows:Specimen[])=>localStorage.setItem(KEY,JSON.stringify(rows));
const cardByName=(no:string,species?:string)=>[...document.querySelectorAll('.record')].find(c=>c.textContent!.includes(no)&&(!species||c.textContent!.includes(species)))! as HTMLElement;
const mergeDialog=()=>screen.getByRole('dialog',{name:'合并重复采集编号'});
const chooseField=(label:string,index:number)=>{
  const row=[...mergeDialog().querySelectorAll('.merge-row')].find(r=>r.querySelector('span:first-child')!.textContent===label)!;
  fireEvent.click(row.querySelectorAll('input[type=radio]')[index]);
};
const chooseKeep=(index:number)=>fireEvent.click(mergeDialog().querySelectorAll('input[name="merge-keep"]')[index]);
const addToBatch=(c:HTMLElement)=>fireEvent.click(within(c).getByRole('button',{name:'加入批次'}));

beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();cleanup()});

describe('重复采集编号合并',()=>{
  it('指定保留项并逐字段选择后生成一条记录，两项都在批次时只保留较早位置',()=>{
    seed(pair());
    render(<App/>);
    addToBatch(cardByName('A-001','柏 Cupressus'));
    addToBatch(cardByName('A-001','松 Pinus'));
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id2','id1']);

    fireEvent.click(within(cardByName('A-001','松 Pinus')).getByRole('button',{name:'合并比较'}));
    expect(mergeDialog()).toBeInTheDocument();
    chooseKeep(1);
    chooseField('物种名称',1);
    chooseField('采集人',1);
    chooseField('采集日期',0);
    chooseField('地点',0);
    chooseField('纬度',0);
    chooseField('经度',0);
    chooseField('生境备注',1);
    fireEvent.click(screen.getByRole('button',{name:'确认合并'}));

    expect(screen.getByText('记录已合并，问题清单已重新计算')).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:'合并重复采集编号'})).not.toBeInTheDocument();
    expect([...document.querySelectorAll('.record')]).toHaveLength(1);
    const card=document.querySelector('.record')!;
    expect(card).toHaveTextContent('柏 Cupressus');
    expect(card).toHaveTextContent('乙');
    expect(card).toHaveTextContent('北京');
    expect(card).toHaveTextContent('沟谷');
    expect(card).not.toHaveTextContent('松 Pinus');
    expect(card).not.toHaveTextContent('上海');
    expect(screen.queryByText('采集编号重复')).not.toBeInTheDocument();

    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('id2');
    expect(stored[0]).toMatchObject({collectionNo:'A-001',species:'柏 Cupressus',collector:'乙',location:'北京',habitat:'沟谷'});
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id2']);

    fireEvent.click(screen.getByRole('button',{name:/打印批次/}));
    const cell=screen.getByRole('dialog',{name:'打印批次预览'}).querySelector('.cell')!;
    expect(cell).toHaveTextContent('A-001');
    expect(cell).toHaveTextContent('柏 Cupressus');
  });

  it('确认前任一记录已删除时拒绝提交，记录、问题处置和批次保持原状',()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    seed(pair());
    render(<App/>);
    const first=cardByName('A-001','松 Pinus');
    fireEvent.change(within(first).getByDisplayValue('待处理'),{target:{value:'fixed'}});
    fireEvent.click(within(first).getByRole('button',{name:'加入批次'}));
    fireEvent.click(within(first).getByRole('button',{name:'合并比较'}));
    fireEvent.click(within(cardByName('A-001','柏 Cupressus')).getByRole('button',{name:'删除'}));

    fireEvent.click(screen.getByRole('button',{name:'确认合并'}));
    expect(screen.getByText('无法合并：其中一条记录已被删除')).toBeInTheDocument();
    expect(mergeDialog()).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id1']);
    expect(JSON.parse(localStorage.getItem(KEY)!)[0].resolutions['id1:duplicate']).toMatchObject({status:'fixed'});
  });

  it('确认前编号已不再相同时拒绝提交并保持原状',()=>{
    seed(pair());
    render(<App/>);
    fireEvent.click(within(cardByName('A-001','松 Pinus')).getByRole('button',{name:'合并比较'}));
    fireEvent.click(within(cardByName('A-001','柏 Cupressus')).getByRole('button',{name:'编辑'}));
    fireEvent.change(screen.getByDisplayValue('A-001'),{target:{value:'B-002'}});
    fireEvent.click(screen.getByText('保存记录'));

    fireEvent.click(screen.getByRole('button',{name:'确认合并'}));
    expect(screen.getByText('无法合并：两条记录的采集编号已不再相同')).toBeInTheDocument();
    expect(mergeDialog()).toBeInTheDocument();
    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(stored).toHaveLength(2);
    expect(stored.map(r=>r.collectionNo).sort()).toEqual(['A-001','B-002']);
  });

  it('合并后新出现的预检问题不得沿用旧处置，重新显示为待处理',()=>{
    seed([
      rec({id:'id1',species:''}),
      rec({id:'id2',species:''}),
    ]);
    render(<App/>);
    const cards=[...document.querySelectorAll('.record')] as HTMLElement[];
    // 保留项（记录 A）把“物种名缺失”标记为已修正
    const speciesIssue=within(cards[0]).getByText('物种名缺失').closest('.issue')!;
    fireEvent.change(within(speciesIssue as HTMLElement).getByDisplayValue('待处理'),{target:{value:'fixed'}});
    fireEvent.click(within(cards[0]).getByRole('button',{name:'合并比较'}));
    // 物种字段改取记录 B（同样为空），其他字段保持记录 A；保留项为记录 A
    chooseField('物种名称',1);
    fireEvent.click(screen.getByRole('button',{name:'确认合并'}));
    expect(screen.getByText('记录已合并，问题清单已重新计算')).toBeInTheDocument();
    const card=document.querySelector('.record')!;
    expect(card).toHaveTextContent('物种名缺失');
    const remainingIssue=within(card as HTMLElement).getByText('物种名缺失').closest('.issue')!;
    const select=within(remainingIssue as HTMLElement).getByDisplayValue('待处理');
    expect(select).toBeInTheDocument();
    expect(within(remainingIssue as HTMLElement).getByPlaceholderText('处理说明')).toHaveValue('');
    const metricArticle=[...document.querySelectorAll('.metrics article')].find(a=>a.textContent!.includes('待处理问题'))!;
    expect(metricArticle.querySelector('strong')).toHaveTextContent('1');
    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(stored).toHaveLength(1);
    expect(stored[0].resolutions).toEqual({});
  });

  it('回归：编辑成仅首尾空格不同的同号记录，两条都显示重复并可合并',async()=>{
    seed([
      rec({id:'id1',collectionNo:'A-001',species:'松 Pinus'}),
      rec({id:'id2',collectionNo:'B-002',species:'柏 Cupressus'}),
    ]);
    render(<App/>);
    // 把第二条的采集编号编辑为仅首尾空格不同的同号
    fireEvent.click(within(cardByName('B-002')).getByRole('button',{name:'编辑'}));
    fireEvent.change(screen.getByDisplayValue('B-002'),{target:{value:'  A-001  '}});
    fireEvent.click(screen.getByText('保存记录'));
    await screen.findByText('记录已保存，问题清单已重新计算');
    // 两条记录都显示重复问题，且都有合并入口
    expect(screen.getAllByText('采集编号重复')).toHaveLength(2);
    expect(screen.getAllByRole('button',{name:'合并比较'})).toHaveLength(2);
    // 从保留项进入合并，确认后只剩一条记录且重复问题消失
    fireEvent.click(within(cardByName('A-001','松 Pinus')).getByRole('button',{name:'合并比较'}));
    expect(mergeDialog()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'确认合并'}));
    expect(screen.getByText('记录已合并，问题清单已重新计算')).toBeInTheDocument();
    expect([...document.querySelectorAll('.record')]).toHaveLength(1);
    expect(screen.queryByText('采集编号重复')).not.toBeInTheDocument();
    const stored=JSON.parse(localStorage.getItem(KEY)!) as Specimen[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({id:'id1',collectionNo:'A-001',species:'松 Pinus'});
  });

  it('持久化写入失败时停止提交并回滚记录与批次',()=>{
    seed(pair());
    render(<App/>);
    const first=cardByName('A-001','松 Pinus');
    const second=cardByName('A-001','柏 Cupressus');
    fireEvent.click(within(second).getByRole('button',{name:'加入批次'}));
    fireEvent.click(within(first).getByRole('button',{name:'合并比较'}));
    chooseKeep(1);chooseField('物种名称',1);

    const originalSet=Storage.prototype.setItem;
    let failed=false;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string){
      if(key===BATCH_KEY&&!failed){failed=true;throw new Error('quota');}
      return originalSet.call(this,key,value);
    });
    fireEvent.click(screen.getByRole('button',{name:'确认合并'}));
    vi.mocked(Storage.prototype.setItem).mockRestore();

    expect(screen.getByText('无法合并：本地工作集写入失败，原数据已保持不变')).toBeInTheDocument();
    expect(mergeDialog()).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(BATCH_KEY)!)).toEqual(['id2']);
    expect([...document.querySelectorAll('.record')]).toHaveLength(2);
  });
});
