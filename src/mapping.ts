import {fields,headers,Specimen} from './types';
import {checkRow,csvLine,required} from './data';

export type FieldKey=typeof fields[number];
export type FieldMapping=Record<FieldKey,number|null>;
export type CsvRow={line:number;cells:string[]};
export type CsvTable={header:string[];rows:CsvRow[]};
export type MappingError=
  |{kind:'missing';field:FieldKey}
  |{kind:'duplicate';column:number;fields:FieldKey[]}
  |{kind:'row';line:number;message:string};

// 解析层：过滤空行并保留原始列值，供映射面板定位来源行；行号在过滤前赋好，空行不会压缩后续行号
export function parseCsv(text:string):{table?:CsvTable;error?:string}{
  const rawLines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  const lines=rawLines.map((raw,i)=>({raw,line:i+1})).filter(x=>x.raw);
  if(!lines.length)return{error:'文件为空'};
  const[head,...rest]=lines;
  return{table:{header:csvLine(head.raw),rows:rest.map(x=>({line:x.line,cells:csvLine(x.raw)}))}};
}
// 仅列名与顺序完全一致才算标准文件；乱序或异名都进入映射面板
export function isStandardHeader(header:string[]){
  return header.length===headers.length&&header.every((h,i)=>h===headers[i]);
}
export const emptyMapping=():FieldMapping=>Object.fromEntries(fields.map(f=>[f,null])) as FieldMapping;
// 预填：来源表头与标准字段同名且仅出现一次时自动对应，其余留空由用户在面板中选择
export function guessMapping(header:string[]):FieldMapping{
  const m=emptyMapping();
  fields.forEach((f,i)=>{
    const hit=header.map((h,c)=>[h,c] as const).filter(([h])=>h===headers[i]);
    if(hit.length===1)m[f]=hit[0][1];
  });
  return m;
}
// 映射校验：必填字段必须各有来源，且任何字段之间都不能复用来源列
export function validateMapping(mapping:FieldMapping):MappingError[]{
  const errors:MappingError[]=[];
  for(const f of required)if(mapping[f]===null)errors.push({kind:'missing',field:f});
  const used=new Map<number,FieldKey[]>();
  for(const f of fields){
    const c=mapping[f];
    if(c===null)continue;
    used.set(c,[...(used.get(c)||[]),f]);
  }
  for(const [column,list] of used)if(list.length>1)errors.push({kind:'duplicate',column,fields:list});
  return errors;
}
// 映射导入：按列序号直接取值（同名表头不影响），任一行不合法则整批不产出记录
export function importMappedCsv(table:CsvTable,mapping:FieldMapping,existing:Specimen[]):{rows?:Specimen[];errors:MappingError[]}{
  const errors:MappingError[]=validateMapping(mapping);
  if(errors.length)return{errors};
  const seen=new Set(existing.map(x=>x.collectionNo));
  const batch=new Set<string>();
  const rows:Specimen[]=[];
  for(const row of table.rows){
    const rec=Object.fromEntries(
      fields.map(f=>{
        const c=mapping[f];
        return[f,c===null?'':row.cells[c]??''];
      })
    ) as Record<FieldKey,string>;
    const before=errors.length;
    const specimen=checkRow(
      row.line,rec,seen,batch,
      message=>errors.push({kind:'row',line:row.line,message})
    );
    if(errors.length===before)rows.push(specimen);
  }
  return errors.length?{errors}:{rows,errors};
}
