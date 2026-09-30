import{ChangeEvent,useEffect,useMemo,useState}from'react';import{createPortal}from'react-dom';import{headers,IssueStatus,Specimen,UndoEntry,fields}from'./types';import{clearUndo,consumeUndo,importCsv,issuesFor,loadUndo,parseBackup,required,samples,saveUndo,speciesCount,validCoords,validDate}from'./data';import{BatchLayoutMode,BatchModel,BATCH_KEY,LABELS_PER_PAGE,addToBatch,buildBatchModel,buildGroupedBatchModel,loadBatch,pruneBatch,removeFromBatch,saveBatch}from'./batch';import{MergeState,buildMergedSpecimen,defaultSelections,getMergePair,mergeBatchIds,mergeRows}from'./merge';import{CsvTable,FieldMapping,MappingError,guessMapping,importMappedCsv,isStandardHeader,parseCsv}from'./mapping';
import{NearConclusion,NearPair,NearVerdict,buildConclusion,findNearPairs,formatMeters,hasComparableRecords,loadConclusions,pairKey,parseRadius,reconcileConclusions,saveConclusions,upsertConclusion,verdictLabel}from'./near';
import{RelationReport,buildRelationReport,groupableSiteGroups}from'./relation';
const KEY='plant-preflight-v1';const blank:Specimen={id:'',collectionNo:'',species:'',collector:'',date:'',location:'',latitude:'',longitude:'',habitat:'',resolutions:{}};
type MappingState={table:CsvTable;mapping:FieldMapping;errors:MappingError[];file:string};
function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
export default function App(){const[rows,setRowsRaw]=useState<Specimen[]>(load);const[edit,setEdit]=useState<Specimen|null>(null);const[msg,setMsg]=useState<{kind:'ok'|'err';text:string}|null>(null);const[filters,setFilters]=useState({species:'',collector:'',location:'',status:'all'});const[undo,setUndoRaw]=useState<UndoEntry|null>(()=>{const e=loadUndo();return e==='invalid'?null:e});const setRows=(x:Specimen[])=>{setRowsRaw(x);localStorage.setItem(KEY,JSON.stringify(x))};
 // 导入提交前先试写本地存储：空间不足等写入失败时返回 false，界面与数据保持原样（setItem 失败不会部分写入，无需回滚）
 const persistRows=(x:Specimen[])=>{try{localStorage.setItem(KEY,JSON.stringify(x));return true}catch{return false}};const setUndo=(e:UndoEntry|null)=>{setUndoRaw(e);e?saveUndo(e.id,e.snapshot,e.savedAt):clearUndo()};const[batchIds,setBatchIdsRaw]=useState<string[]>(loadBatch);const[batchModel,setBatchModel]=useState<BatchModel|null>(null);const[batchModelSig,setBatchModelSig]=useState<string>('');const[merge,setMerge]=useState<MergeState|null>(null);const[csvMap,setCsvMap]=useState<MappingState|null>(null);const setBatchIds=(x:string[])=>{setBatchIdsRaw(x);saveBatch(x)};
 // 旧页模型立即失效：签名覆盖记录、手工批次与有效同点关系；任一变化即关闭旧预览，避免预览/打印与数据脱节
 const modelSig=(mode:BatchLayoutMode,ids:string[])=>JSON.stringify([rows,ids,nearLive.map(c=>[c.pairKey,c.verdict]),mode]);
 const rebuildBatchModel=(mode:BatchLayoutMode):BatchModel=>
   mode==='grouped'?buildGroupedBatchModel(batchIds,rows,siteGroups):buildBatchModel(batchIds,rows);
 // 近地点复核：独立按键、独立视图，结论绑定双方字段指纹；不触碰工作集、问题、撤销项与批次
 const[view,setView]=useState<'desk'|'near'|'check'>('desk');
 const[radiusText,setRadiusText]=useState('50');
 const[nearEntries,setNearEntriesRaw]=useState<NearConclusion[]>(loadConclusions);
 const nearPairs=useMemo(()=>{const n=parseRadius(radiusText);return n===null?[]:findNearPairs(rows,n)},[rows,radiusText]);
 // 展示与统计一律以“与当前记录指纹核对后仍有效”的结论为准；存储里的失效条目不伪装成已确认
 const nearLive=useMemo(()=>reconcileConclusions(nearEntries,rows),[nearEntries,rows]);
 // 采集点关系检查：分组、冲突卡片与打印预览警示共用同一份推导结果；纯只读，不写回结论、记录或批次
 const relationReport=useMemo(()=>buildRelationReport(nearLive),[nearLive]);
 // 同点分组排版只取当前有效、无矛盾的同点组；冲突整组排除，冲突仍只走警示
 const siteGroups=useMemo(()=>groupableSiteGroups(relationReport),[relationReport]);
 const[highlightConflicts,setHighlightConflicts]=useState(false);
 // 打印预览警示：与关系检查视图同一份 relationReport，仅用于定位高亮，不改写批次
 const batchConflict=useMemo(()=>{
   if(!batchModel)return{specimens:0,conflicts:0,ids:new Set<string>()};
   const inBatch=new Set<string>();
   for(const pg of batchModel.pages)for(const c of pg.cells)if(c)inBatch.add(c.specimen.id);
   const ids=new Set([...inBatch].filter(id=>relationReport.involved.has(id)));
   return{specimens:ids.size,conflicts:relationReport.conflicts.filter(c=>c.path.some(id=>inBatch.has(id))).length,ids};
 },[batchModel,relationReport]);
 // 点击警示：高亮卷入冲突的标签格并滚动到第一格（jsdom 无 scrollIntoView，安全缺席）
 const locateConflicts=()=>{setHighlightConflicts(true);setTimeout(()=>{document.querySelector('.batch-modal .cell-conflict')?.scrollIntoView?.({block:'nearest'})},0)};
 const nearActive=new Map(nearLive.map(e=>[e.pairKey,e]));
 const nearPending=nearPairs.filter(p=>!nearActive.has(pairKey(p.ids[0],p.ids[1]))).length;
 // 结论写入：基于核对后的有效结论集合更新，再试写浏览器；
 // 写入失败时界面保持原状态，不留下“已确认”的假象
 const setNearVerdict=(pair:NearPair,verdict:NearVerdict)=>{
   const c=buildConclusion(rows,pair.ids[0],pair.ids[1],verdict);
   if(!c)return flash('err','无法标记：其中一条记录已不存在');
   const next=upsertConclusion(nearLive,c);
   if(!saveConclusions(next))return flash('err','无法保存复核结论：浏览器存储写入失败，结论未改变');
   setNearEntriesRaw(next);
   flash('ok',`已标记为“${verdictLabel(verdict)}”，结论绑定双方字段指纹`);
 };
 // 确认有效期以“成功变更”为准：工作集每次变化（编辑、撤销、删除、导入、合并、清空、载入示例）及页面挂载时，
 // 立即把指纹失效或记录缺失的结论从状态与浏览器存储中一并物理剔除——此后即便把字段改回确认时的文本、
 // 撤销编辑或恢复同内部编号的备份，旧结论也不复活，只能重新逐对确认；
 // 未改绑定字段的编辑与单纯调整半径不产生失效，其它记录对的结论原样保留
 useEffect(()=>{
   if(nearLive.length===nearEntries.length)return;
   saveConclusions(nearLive); // 存储写失败也先更新状态：界面不留下“已确认”的假象
   setNearEntriesRaw(nearLive);
 },[nearLive,nearEntries]);
 // 卡片上的加入/移出按钮：去重、保序由领域层保证
 const toggleBatch=(id:string)=>setBatchIds(batchIds.includes(id)?removeFromBatch(batchIds,id):addToBatch(batchIds,id));
 // 打开预览时清理已不存在的成员（导入 JSON、载入示例或删除记录后可能失效）；空批次只提示，不改变工作集；
 // 默认八张顺排，同点分组需在预览中手动勾选；排版只读手工批次，绝不改写存储
 const openBatch=()=>{setHighlightConflicts(false);const{ids,removed}=pruneBatch(batchIds,rows);if(ids.length!==batchIds.length)setBatchIds(ids);if(!ids.length){flash('err',removed.length?`已自动剔除 ${removed.length} 条不存在于当前工作集的批次记录，请先选择标本`:'请先选择标本');return}const model=buildBatchModel(ids,rows);setBatchModel(model);setBatchModelSig(modelSig('sequence',ids));if(removed.length)flash('err',`已自动剔除 ${removed.length} 条不存在于当前工作集的批次记录`)};
 // 切换“同点分组排版”：只重建页模型（同一模型同时供预览与实际打印），手工批次不变
 const setBatchLayout=(mode:BatchLayoutMode)=>{if(!batchModel||batchModel.mode===mode)return;setHighlightConflicts(false);setBatchModel(rebuildBatchModel(mode));setBatchModelSig(modelSig(mode,batchIds));};
 // 关系失效、记录编辑或批次变化后，旧页模型立即失效（连同打印 portal），避免按旧页打印
 useEffect(()=>{if(batchModel&&modelSig(batchModel.mode,batchIds)!==batchModelSig)setBatchModel(null);});
 const printBatch=()=>{document.body.classList.add('batch-print');try{window.print()}finally{setTimeout(()=>document.body.classList.remove('batch-print'),1500)}};const undoTarget=undo?rows.find(r=>r.id===undo.id)||null:null;
 const flash=(kind:'ok'|'err',text:string)=>{setMsg({kind,text});setTimeout(()=>setMsg(null),4500)};
useEffect(()=>{const boot=loadUndo();if(boot==='invalid'||(boot&&!rows.some(r=>r.id===boot.id))){clearUndo();setUndoRaw(null);flash('err','最近编辑已无法撤销')}},
 // 仅在挂载时校验一次持久化撤销项
 // eslint-disable-next-line react-hooks/exhaustive-deps
 []);const issues=useMemo(()=>issuesFor(rows),[rows]);const visible=rows.filter(r=>{const ri=issues.filter(x=>x.recordId===r.id);const status=ri.length?ri.some(x=>(r.resolutions[x.key]?.status||'pending')==='pending')?'pending':'resolved':'clean';return r.species.toLowerCase().includes(filters.species.toLowerCase())&&r.collector.toLowerCase().includes(filters.collector.toLowerCase())&&r.location.toLowerCase().includes(filters.location.toLowerCase())&&(filters.status==='all'||filters.status===status)});
 const save=()=>{if(!edit)return;const errs=[];if(!edit.collectionNo.trim())errs.push('采集编号');if(!edit.collector.trim())errs.push('采集人');if(!edit.date.trim())errs.push('采集日期');if(!edit.location.trim())errs.push('地点');if(edit.date&&!validDate(edit.date))errs.push('合法日期');if(errs.length)return flash('err',`请填写/修正：${errs.join('、')}`);if(edit.id){const prev=rows.find(x=>x.id===edit.id);const next=rows.map(x=>x.id===edit.id?edit:x);setRows(next);if(prev)setUndo({id:prev.id,snapshot:structuredClone(prev),savedAt:new Date().toISOString()});}else setRows([...rows,{...edit,id:crypto.randomUUID()}]);setEdit(null);flash('ok','记录已保存，问题清单已重新计算')};
 const undoEdit=()=>{if(!undo)return;const restored=consumeUndo(rows,undo);if(!restored){setUndo(null);return flash('err','最近编辑已无法撤销')}setRows(restored);const no=undo.snapshot.collectionNo;setUndo(null);flash('ok',`已撤销对 ${no} 的编辑，问题清单已重新计算`)};
 const fileText=(e:ChangeEvent<HTMLInputElement>,cb:(s:string,name:string)=>void)=>{const f=e.target.files?.[0];if(!f)return;f.text().then(s=>cb(s,f.name));e.target.value=''};
 const exportJson=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));a.download=`植物标本备份-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
 const importJson=(text:string)=>{const x=parseBackup(text);if(!x)return flash('err','JSON 备份无效，当前数据未改变');setRows(x);setUndo(null);flash('ok',`已恢复 ${x.length} 条记录`)};
 // 标准八列表头走原路径直接导入；其他表头打开映射面板，确认前不改变工作集
 const importCsvFile=(text:string,file:string)=>{
  const parsed=parseCsv(text);
  if(!parsed.table)return flash('err',parsed.error||'文件为空');
  if(isStandardHeader(parsed.table.header)){
    const x=importCsv(text,rows);
    if(x.errors.length)return flash('err',x.errors.join('；'));
    const next=[...rows,...x.rows!];
    if(!persistRows(next))return flash('err','无法导入：本地工作集写入失败，原数据已保持不变');
    setRowsRaw(next);
    return flash('ok',`成功导入 ${x.rows!.length} 条，数据已完整写入`);
  }
  setCsvMap({table:parsed.table,mapping:guessMapping(parsed.table.header),errors:[],file});
 };
 // 提交映射：任一行不合法则整批不写入，仅在面板回显问题；全部通过时先写本地存储，成功后才更新界面并关闭面板
 const commitMapping=()=>{
  if(!csvMap)return;
  const result=importMappedCsv(csvMap.table,csvMap.mapping,rows);
  if(result.errors.length){
    setCsvMap({...csvMap,errors:result.errors});
    return;
  }
  const next=[...rows,...result.rows!];
  if(!persistRows(next))return flash('err','无法导入：本地工作集写入失败，原数据已保持不变');
  setRowsRaw(next);
  setCsvMap(null);
  flash('ok',`成功导入 ${result.rows!.length} 条，数据已完整写入`);
 };
 const resolve=(r:Specimen,key:string,status:IssueStatus,note:string)=>setRows(rows.map(x=>x.id===r.id?{...x,resolutions:{...x.resolutions,[key]:{status,note}}}:x));
 const openMerge=(r:Specimen)=>{const other=rows.find(x=>x.id!==r.id&&x.collectionNo.trim()===r.collectionNo.trim());if(!other)return flash('err','无法合并：重复关系已失效');const pair:[Specimen,Specimen]=[r,other];setMerge({pair,keepId:r.id,selections:defaultSelections()})};
 const setMergeKeep=(keepId:string)=>setMerge(m=>m&&{...m,keepId});
 const setMergeChoice=(field:typeof fields[number],choice:0|1)=>setMerge(m=>m&&{...m,selections:{...m.selections,[field]:choice}});
 const commitMerge=()=>{
  if(!merge)return;
  const check=getMergePair(rows,[merge.pair[0].id,merge.pair[1].id]);
  if(!check.pair)return flash('err',check.error||'无法合并：关系已失效');
  const merged=buildMergedSpecimen(check.pair,merge.keepId,merge.selections);
  const otherId=check.pair.find(r=>r.id!==merge.keepId)!.id;
  const nextRows=mergeRows(rows,otherId,merged);
  const nextBatch=mergeBatchIds(batchIds,otherId,merge.keepId);
  const previousData=localStorage.getItem(KEY);const previousBatch=localStorage.getItem(BATCH_KEY);
  try{
    localStorage.setItem(KEY,JSON.stringify(nextRows));
    localStorage.setItem(BATCH_KEY,JSON.stringify(nextBatch));
  }catch{
    previousData===null?localStorage.removeItem(KEY):localStorage.setItem(KEY,previousData);
    previousBatch===null?localStorage.removeItem(BATCH_KEY):localStorage.setItem(BATCH_KEY,previousBatch);
    return flash('err','无法合并：本地工作集写入失败，原数据已保持不变');
  }
  setRowsRaw(nextRows);setBatchIdsRaw(nextBatch);
  if(undo&&[merge.keepId,otherId].includes(undo.id))setUndo(null);
  setMerge(null);
  flash('ok','记录已合并，问题清单已重新计算');
 };
 return <><header><div><span className="eyebrow">HERBARIUM DESK · 01</span><h1>植物标本标签<br/>预检台</h1><p>在打印之前，把每一份野外记录整理得准确、完整、可追溯。</p></div><button className="primary" onClick={()=>setEdit({...blank})}>＋ 新增标本</button></header><main><nav className="workspace-tabs" aria-label="工作区切换">{[{k:'desk',t:'预检工作台'},{k:'near',t:'近地点复核'},{k:'check',t:'关系检查'}].map(x=><button key={x.k} className={view===x.k?'tab-on':''} aria-pressed={view===x.k} onClick={()=>setView(x.k as 'desk'|'near'|'check')}>{x.t}{x.k==='near'&&nearPending>0&&<span className="tab-count">{nearPending}</span>}{x.k==='check'&&relationReport.conflicts.length>0&&<span className="tab-count tab-alert">{relationReport.conflicts.length}</span>}</button>)}</nav>{msg&&<div role="alert" className={`toast ${msg.kind}`}>{msg.text}</div>}{view==='desk'&&<><section className="metrics"><article><span>馆藏记录</span><strong>{rows.length}</strong><small>当前工作集</small></article><article><span>待处理问题</span><strong>{issues.filter(i=>(rows.find(r=>r.id===i.recordId)?.resolutions[i.key]?.status||'pending')==='pending').length}</strong><small>需要人工复核</small></article><article><span>预检通过</span><strong>{rows.filter(r=>!issues.some(i=>i.recordId===r.id&&(r.resolutions[i.key]?.status||'pending')==='pending')).length}</strong><small>可进入打印</small></article><article><span>物种数</span><strong>{speciesCount(rows)}</strong><small>已识别名称</small></article></section>
 <section className="toolbar"><div><b>标本工作集</b><span>{visible.length} / {rows.length} 条</span></div><div className="actions"><label className="button">导入 CSV<input type="file" accept=".csv,text/csv" onChange={e=>fileText(e,importCsvFile)}/></label><label className="button">导入 JSON<input type="file" accept=".json" onChange={e=>fileText(e,importJson)}/></label><button onClick={exportJson}>导出 JSON</button><button className="primary" onClick={openBatch}>打印批次<span className="batch-count" aria-label={`批次含 ${batchIds.length} 份标本`}>{batchIds.length}</span></button><button onClick={()=>{setRows(samples);setUndo(null);flash('ok','示例数据已载入')}}>载入示例</button><button className="danger" onClick={()=>{if(confirm('确定清空全部记录？此操作无法撤销。')){setRows([]);setUndo(null);flash('ok','已清空全部记录')}}}>一键清空</button></div></section>
 {undo&&undoTarget&&<section className="undo-bar"><span>最近保存的编辑：<b>{undoTarget.collectionNo}</b>{undo.snapshot.collectionNo!==undoTarget.collectionNo&&<>（保存前编号：{undo.snapshot.collectionNo}）</>}</span><button className="primary" onClick={undoEdit}>撤销本次编辑</button></section>}
 <section className="filters"><input placeholder="按物种筛选" value={filters.species} onChange={e=>setFilters({...filters,species:e.target.value})}/><input placeholder="按采集人筛选" value={filters.collector} onChange={e=>setFilters({...filters,collector:e.target.value})}/><input placeholder="按地点筛选" value={filters.location} onChange={e=>setFilters({...filters,location:e.target.value})}/><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="all">全部问题状态</option><option value="pending">待处理</option><option value="resolved">已处理</option><option value="clean">无问题</option></select></section>
 {!rows.length?<section className="empty"><div>❧</div><h2>还没有标本记录</h2><p>新增一份记录，或导入包含 8 个标准表头的 CSV 文件。</p><button className="primary" onClick={()=>setEdit({...blank})}>创建第一份标本</button></section>:!visible.length?<section className="empty"><h2>没有符合条件的记录</h2><p>尝试清除或调整筛选条件。</p></section>:<section className="cards">{visible.map(r=>{const ri=issues.filter(i=>i.recordId===r.id);return <article className="record" key={r.id}><div className="record-head"><div><span className="number">{r.collectionNo}</span><h2>{r.species||<em>物种名待补充</em>}</h2></div><div><button onClick={()=>setEdit(structuredClone(r))}>编辑</button><button className={batchIds.includes(r.id)?'batch-on':''} onClick={()=>toggleBatch(r.id)}>{batchIds.includes(r.id)?'移出批次':'加入批次'}</button><button className="danger" onClick={()=>confirm(`删除 ${r.collectionNo}？`)&&(undo?.id===r.id&&setUndo(null),setRows(rows.filter(x=>x.id!==r.id)))}>删除</button></div></div><dl><div><dt>采集人</dt><dd>{r.collector}</dd></div><div><dt>采集日期</dt><dd>{r.date}</dd></div><div><dt>地点</dt><dd>{r.location}</dd></div><div><dt>坐标</dt><dd className={!validCoords(r.latitude,r.longitude)?'bad':''}>{r.latitude}, {r.longitude}</dd></div><div><dt>生境</dt><dd>{r.habitat||'—'}</dd></div></dl>{ri.length?<div className="issues"><b>预检问题 · {ri.length}</b>{ri.map(i=>{const v=r.resolutions[i.key]||{status:'pending',note:''};return <div className="issue" key={i.key}><span>{i.type}{i.type==='采集编号重复'&&<button type="button" className="merge-entry" onClick={()=>openMerge(r)}>合并比较</button>}</span><select value={v.status} onChange={e=>resolve(r,i.key,e.target.value as IssueStatus,v.note)}><option value="pending">待处理</option><option value="fixed">已修正</option><option value="kept">确认保留</option></select><input placeholder="处理说明" value={v.note} onChange={e=>resolve(r,i.key,v.status,e.target.value)}/></div>})}</div>:<div className="pass">✓ 预检通过</div>}<details><summary>打印标签预览</summary><div className="label"><b>植物标本 HERBARIUM SPECIMEN</b><h3>{r.species||'（物种名待定）'}</h3><p>采集号 {r.collectionNo}　采集人 {r.collector}</p><p>{r.date} · {r.location}</p><p>坐标 {r.latitude}, {r.longitude}</p><p>{r.habitat}</p><code>QR: specimen://{r.collectionNo}</code><button onClick={()=>window.print()}>打印标签</button></div></details></article>})}</section>}</>}
{view==='near'&&<NearSection rows={rows} pairs={nearPairs} entries={nearLive} radiusText={radiusText} setRadiusText={setRadiusText} onVerdict={setNearVerdict}/>}
{view==='check'&&<CheckSection rows={rows} report={relationReport}/>}
</main>
 {edit&&<div className="modal"><form onSubmit={e=>{e.preventDefault();save()}}><div className="modal-head"><div><span className="eyebrow">SPECIMEN RECORD</span><h2>{edit.id?'编辑标本':'新增标本'}</h2></div><button type="button" onClick={()=>setEdit(null)}>×</button></div><div className="formgrid">{headers.map((h,i)=>{const k=['collectionNo','species','collector','date','location','latitude','longitude','habitat'][i] as keyof Specimen;return <label key={h} className={k==='habitat'?'wide':''}><span>{h}{['collectionNo','collector','date','location'].includes(k)?' *':''}</span>{k==='habitat'?<textarea value={String(edit[k])} onChange={e=>setEdit({...edit,[k]:e.target.value})}/>:<input type={k==='date'?'date':'text'} value={String(edit[k])} onChange={e=>setEdit({...edit,[k]:e.target.value})}/>}</label>})}</div><footer><button type="button" onClick={()=>setEdit(null)}>取消</button><button className="primary">保存记录</button></footer></form></div>}
 {merge&&<div className="modal merge-modal" role="dialog" aria-label="合并重复采集编号"><form onSubmit={e=>{e.preventDefault();commitMerge()}}><div className="modal-head"><div><span className="eyebrow">MERGE COMPARE · {merge.pair[0].collectionNo}</span><h2>合并重复采集编号</h2></div><button type="button" onClick={()=>setMerge(null)}>×</button></div><div className="merge-keep"><b>保留记录</b>{merge.pair.map((r,i)=><label key={r.id}><input type="radio" name="merge-keep" checked={merge.keepId===r.id} onChange={()=>setMergeKeep(r.id)}/><span>记录 {i===0?'A':'B'} · 内部编号 {r.id}</span></label>)}</div><div className="merge-table" role="group" aria-label="逐字段选择合并内容"><div className="merge-row merge-head-row"><span>字段</span><b>记录 A</b><b>记录 B</b></div>{fields.map((f,k)=>{const label=headers[k];return <div className="merge-row" key={f}><span>{label}</span><label className={merge.keepId===merge.pair[0].id?'kept':''}><input type="radio" name={`merge-${f}`} checked={merge.selections[f]===0} onChange={()=>setMergeChoice(f,0)}/><em>{merge.pair[0][f]||'（空）'}</em></label><label className={merge.keepId===merge.pair[1].id?'kept':''}><input type="radio" name={`merge-${f}`} checked={merge.selections[f]===1} onChange={()=>setMergeChoice(f,1)}/><em>{merge.pair[1][f]||'（空）'}</em></label></div>})}</div><p className="merge-note">确认后保留项继续使用原内部编号；被合并项的批次位置将改指保留项，并只保留最早加入位置。</p><footer><button type="button" onClick={()=>setMerge(null)}>取消</button><button className="primary">确认合并</button></footer></form></div>}
 {csvMap&&<div className="modal mapping-modal" role="dialog" aria-label="CSV 字段映射"><form onSubmit={e=>{e.preventDefault();commitMapping()}}><div className="modal-head"><div><span className="eyebrow">FIELD MAPPING · {csvMap.file}</span><h2>映射 CSV 字段</h2></div><button type="button" onClick={()=>setCsvMap(null)}>×</button></div><p className="mapping-note">表头与标准八列不一致，请将来源列对应到标本字段。采集编号、采集人、采集日期、地点为必填映射，每个来源列只能使用一次；未映射的字段按空值导入。</p><div className="mapping-grid" role="group" aria-label="字段与来源列对应">{fields.map((f,i)=>{const err=csvMap.errors.find(e=>(e.kind==='missing'&&e.field===f)||(e.kind==='duplicate'&&e.fields.includes(f)));return <div className={`mapping-row${err?' map-bad':''}`} key={f}><span>{headers[i]}{(required as readonly string[]).includes(f)?' *':''}</span><select aria-label={`${headers[i]}来源列`} value={csvMap.mapping[f]===null?'':String(csvMap.mapping[f])} onChange={e=>setCsvMap(m=>m&&{...m,mapping:{...m.mapping,[f]:e.target.value===''?null:Number(e.target.value)}})}><option value="">（不导入）</option>{csvMap.table.header.map((h,c)=><option key={c} value={c}>第 {c+1} 列{h?` · ${h}`:''}</option>)}</select>{err&&<em className="mapping-err">{err.kind==='missing'?'必填字段未选择来源列':'来源列被重复选择'}</em>}</div>})}</div>{csvMap.errors.some(e=>e.kind==='row')&&<div className="mapping-errlist"><b>以下数据行未通过校验，整批未写入</b>{csvMap.errors.filter((e):e is Extract<MappingError,{kind:'row'}>=>e.kind==='row').map((e,i)=><span key={i}>{e.message}</span>)}</div>}<div className="mapping-preview"><table><thead><tr><th>行号</th>{csvMap.table.header.map((h,c)=><th key={c} className={csvMap.errors.some(e=>e.kind==='duplicate'&&e.column===c)?'map-bad':''}>{h||'（空表头）'}</th>)}</tr></thead><tbody>{csvMap.table.rows.map(r=><tr key={r.line} className={csvMap.errors.some(e=>e.kind==='row'&&e.line===r.line)?'bad-row':''}><td>{r.line}</td>{csvMap.table.header.map((_,c)=><td key={c}>{r.cells[c]??''}</td>)}</tr>)}</tbody></table></div><footer><button type="button" onClick={()=>setCsvMap(null)}>取消</button><button className="primary">确认导入</button></footer></form></div>}
 {batchModel&&<div className="modal batch-modal" role="dialog" aria-label="打印批次预览"><form onSubmit={e=>e.preventDefault()}><div className="modal-head"><div><span className="eyebrow">BATCH PRINT · A4 × 8</span><h2>打印批次预览</h2></div><button type="button" onClick={()=>setBatchModel(null)}>×</button></div><div className="batch-meta"><b>{batchModel.total} 份标本</b><span>共 {batchModel.pages.length} 页，每页 {LABELS_PER_PAGE} 格，{batchModel.mode==='grouped'?`同点分组排版 · ${batchModel.groups.length} 个确认同点组保持同页，冲突关系仅警示不分组`:'按加入顺序排列'}</span><label className="batch-layout"><input type="checkbox" checked={batchModel.mode==='grouped'} onChange={e=>setBatchLayout(e.target.checked?'grouped':'sequence')}/>同点分组排版</label></div>{batchModel.withPending>0&&<div className="batch-warning">⚠ {batchModel.withPending} 份标本仍有 {batchModel.totalPending} 项待处理问题，仍可打印，请自行核对。</div>}{batchConflict.conflicts>0&&<button type="button" className="batch-conflict" onClick={locateConflicts}>⚠ 本批次 {batchConflict.specimens} 份标本涉及 {batchConflict.conflicts} 项采集点关系冲突（与“关系检查”同一计算结果），点击定位相关标签。</button>}<BatchSheets model={batchModel} conflictIds={highlightConflicts?batchConflict.ids:undefined}/><footer><button type="button" onClick={()=>setBatchModel(null)}>关闭预览</button><button type="button" className="primary" onClick={printBatch}>打印全部标签</button></footer></form></div>}
 {batchModel&&createPortal(<div className="batch-print-root" aria-hidden="true"><BatchSheets model={batchModel}/></div>,document.body)}</>}

function LabelCell({cell,conflict}:{cell:{specimen:Specimen;pendingIssues:number;groupIndex?:number};conflict?:boolean}){const r=cell.specimen;return <div className={`label cell${conflict?' cell-conflict':''}`}>{conflict&&<span className="cell-conflict-flag">关系冲突</span>}{cell.groupIndex!==undefined&&<span className="cell-group">同点组 {cell.groupIndex}</span>}{cell.pendingIssues>0&&<span className="cell-warn">待处理问题 {cell.pendingIssues}</span>}<b>植物标本 HERBARIUM SPECIMEN</b><h3>{r.species||'（物种名待定）'}</h3><p>采集号 {r.collectionNo}　采集人 {r.collector}</p><p>{r.date} · {r.location}</p><p>坐标 {r.latitude}, {r.longitude}</p><p>{r.habitat}</p><code>QR: specimen://{r.collectionNo}</code></div>}
function BatchSheets({model,conflictIds}:{model:BatchModel;conflictIds?:ReadonlySet<string>}){return <div className="batch-sheets">{model.pages.map(pg=><section className="batch-sheet" key={pg.index}>{pg.cells.map((c,k)=>c?<LabelCell key={k} cell={c} conflict={!!conflictIds?.has(c.specimen.id)}/>:<div className="label cell cell-blank" key={k}/>)}</section>)}</div>}

function NearSection({rows,pairs,entries,radiusText,setRadiusText,onVerdict}:{rows:Specimen[];pairs:NearPair[];entries:NearConclusion[];radiusText:string;setRadiusText:(s:string)=>void;onVerdict:(p:NearPair,v:NearVerdict)=>void}){
  const byId=new Map(rows.map(r=>[r.id,r]));
  const active=new Map(entries.map(e=>[e.pairKey,e]));
  const radius=parseRadius(radiusText);
  const done=pairs.filter(p=>active.has(pairKey(p.ids[0],p.ids[1]))).length;
  return <>
    <section className="near-head"><div><span className="eyebrow">NEAR-SITE REVIEW · 02</span><h2>近地点复核</h2><p>按相同采集人、日期与物种筛选坐标有效的记录，逐对核对编号不同却可能在同一采集点重复登记的标签。距离按球面计算并已考虑跨 180° 经线；结论只保存在本浏览器，任一方修改编号、物种、采集人、日期或坐标后自动回到待复核。</p></div>
      <label className="near-radius"><span>复核半径（1～1000 米）</span><input aria-label="复核半径，单位米" inputMode="decimal" value={radiusText} onChange={e=>setRadiusText(e.target.value)}/><em>米</em></label></section>
    {radius===null
      ?<section className="empty"><h2>请输入 1～1000 之间的半径（米）</h2><p>仅接受数字；超出范围或留空时不进行任何配对。</p></section>
      :!hasComparableRecords(rows)
        ?<section className="empty"><div>❧</div><h2>暂无可参与比对的记录</h2><p>需要至少两条含有效坐标、且采集人、日期、物种与采集编号齐备的记录。</p></section>
        :pairs.length===0
          ?<section className="empty"><h2>半径 {radiusText.trim()} 米内没有待复核记录对</h2><p>调大半径，或先在预检工作台补全坐标与各字段。</p></section>
          :<section className="near-summary"><b>共 {pairs.length} 对</b><span>{pairs.length-done} 对待复核 · {done} 对已有结论</span></section>}
    {radius!==null&&<div className="near-list">{pairs.map(p=>{
      const[a,b]=[byId.get(p.ids[0]),byId.get(p.ids[1])];
      if(!a||!b)return null;
      const c=active.get(pairKey(a.id,b.id));
      return <article className={`near-pair${c?` near-${c.verdict==='duplicate'?'dup':'sep'}`:''}`} key={pairKey(a.id,b.id)}>
        <div className="near-pair-head"><span className="near-dist">{formatMeters(p.distance)}</span>{c?<em className="near-done">已判：{verdictLabel(c.verdict)}</em>:<em className="near-todo">待复核</em>}</div>
        <div className="near-sides">{[a,b].map((r,i)=><div className="near-side" key={r.id}><span className="near-mark">{i===0?'A':'B'}</span><div><b className="number">{r.collectionNo}</b><h3>{r.species||<em>物种名待补充</em>}</h3><p>{r.collector} · {r.date}</p><p>{r.location}</p><p className={!validCoords(r.latitude,r.longitude)?'bad':''}>{r.latitude}, {r.longitude}</p><p className="near-id">内部 ID {r.id}</p></div></div>)}</div>
        <div className="near-actions"><button className={c?.verdict==='duplicate'?'near-on':''} aria-pressed={c?.verdict==='duplicate'} onClick={()=>onVerdict(p,'duplicate')}>同点复采</button><button className={c?.verdict==='separate'?'near-on':''} aria-pressed={c?.verdict==='separate'} onClick={()=>onVerdict(p,'separate')}>确为两份</button></div>
      </article>})}</div>}
  </>;
}

// 采集点关系检查：只读视图，不提供任何写操作；分组、冲突卡片与打印预览警示共用 App 层同一份 relationReport
function CheckSection({rows,report}:{rows:Specimen[];report:RelationReport}){
  const byId=new Map(rows.map(r=>[r.id,r]));
  const no=(id:string)=>byId.get(id)?.collectionNo||id;
  return <>
    <section className="near-head"><div><span className="eyebrow">RELATION CHECK · 03</span><h2>采集点关系检查</h2><p>只读汇总：仅依据当前仍有效的复核结论，把“同点复采”连成采集点分组；若某条“确为两份”的两端落在同一分组，则列为冲突并给出连接两端的最短同点路径（并列时按内部记录 ID 序列取唯一结果）。检查不改写任何结论、记录与打印批次，未复核的记录对不会自动视为已确认。</p></div></section>
    {report.conclusions===0
      ?<section className="empty"><div>❧</div><h2>暂无有效复核结论</h2><p>请先在“近地点复核”中逐对确认，此处会自动汇总同点复采分组与冲突。</p></section>
      :<>
        <section className="near-summary"><b>{report.conflicts.length?`发现 ${report.conflicts.length} 项冲突`:'未发现冲突'}</b><span>有效结论 {report.conclusions} 条 · 同点复采分组 {report.groups.length} 个</span></section>
        {report.conflicts.length>0&&<div className="check-list">{report.conflicts.map((c,i)=><article className="check-conflict" key={c.pairKey}>
          <div className="near-pair-head"><b>冲突 {i+1} · {no(c.ids[0])} × {no(c.ids[1])}</b><em className="near-done check-sep">相异关系：确为两份</em></div>
          <p className="check-why">两端经“同点复采”链相连，却又被判定为两份标本；交付打印前请人工定夺。</p>
          <ol className="check-path">{c.path.map(id=><li key={id}><b className="number">{no(id)}</b><span className="near-id">内部 ID {id}</span></li>)}</ol>
        </article>)}</div>}
        {report.groups.length>0&&<div className="check-groups">{report.groups.map(g=><article className="check-group" key={g.index}>
          <b>分组 {g.index} · {g.memberIds.length} 条记录</b>
          <ul>{g.memberIds.map(id=><li key={id} className={report.involved.has(id)?'check-hit':''}><b className="number">{no(id)}</b><span className="near-id">内部 ID {id}</span>{report.involved.has(id)&&<em>卷入冲突</em>}</li>)}</ul>
        </article>)}</div>}
      </>}
  </>;
}
