import {describe,expect,it} from 'vitest';
import {Specimen} from './types';
import {FieldMapping,emptyMapping,guessMapping,importMappedCsv,isStandardHeader,parseCsv,validateMapping} from './mapping';

const existing=(x:Partial<Specimen>={}):Specimen=>({id:'e1',collectionNo:'A-1',species:'松',collector:'甲',date:'2026-01-01',location:'北京',latitude:'39',longitude:'116',habitat:'',resolutions:{},...x});
// 乱序异名表头：0 标本名 1 经度 2 编号 3 纬度 4 采集者 5 时间 6 产地 7 环境
const csv='标本名,经度,编号,纬度,采集者,时间,产地,环境\n兰,102.5,B-100,25.5,乙,2026-02-28,云南,林下\n松,116.2,B-101,39.9,甲,2026-03-01,北京,山坡';
const full:FieldMapping={species:0,longitude:1,collectionNo:2,latitude:3,collector:4,date:5,location:6,habitat:7};
const tableOf=(text:string)=>{const t=parseCsv(text).table;if(!t)throw new Error('解析失败');return t};

describe('解析层',()=>{
  it('保留原始行号与列值：空行跳过后行号仍对应文件实际行，引号逗号与 BOM 正确处理',()=>{
    const p=parseCsv('﻿编号,名称\n\nA-1,"松, 柏"\nA-2,兰');
    expect(p.table!.header).toEqual(['编号','名称']);
    expect(p.table!.rows).toEqual([
      {line:3,cells:['A-1','松, 柏']},
      {line:4,cells:['A-2','兰']},
    ]);
  });
  it('空文件报错',()=>{
    expect(parseCsv('').error).toBe('文件为空');
    expect(parseCsv('\n\n').error).toBe('文件为空');
  });
  it('保留来源列首尾空格：表头与数据单元格均为原始值',()=>{
    const p=parseCsv('编号, 产地 \n A-1 ,  云南  ');
    expect(p.table!.header).toEqual(['编号',' 产地 ']);
    expect(p.table!.rows[0].cells).toEqual([' A-1 ','  云南  ']);
  });
  it('识别标准八列表头：仅完全一致才算标准，乱序或异名都进入映射',()=>{
    expect(isStandardHeader(['采集编号','物种名称','采集人','采集日期','地点','纬度','经度','生境备注'])).toBe(true);
    expect(isStandardHeader(['物种名称','采集编号','采集人','采集日期','地点','纬度','经度','生境备注'])).toBe(false);
    expect(isStandardHeader(['编号','物种名称','采集人','采集日期','地点','纬度','经度','生境备注'])).toBe(false);
    expect(isStandardHeader(['采集编号','物种名称'])).toBe(false);
  });
});

describe('映射预填与校验',()=>{
  it('同名且唯一的来源列自动对应，其余留空',()=>{
    const m=guessMapping(['物种名称','备注','采集编号']);
    expect(m.species).toBe(0);
    expect(m.collectionNo).toBe(2);
    expect(m.collector).toBeNull();
    expect(m.habitat).toBeNull();
  });
  it('同名来源列出现多次时不预填',()=>{
    expect(guessMapping(['采集编号','采集编号']).collectionNo).toBeNull();
  });
  it('采集编号、采集人、采集日期、地点缺来源时逐一报告',()=>{
    expect(validateMapping(emptyMapping())).toEqual([
      {kind:'missing',field:'collectionNo'},
      {kind:'missing',field:'collector'},
      {kind:'missing',field:'date'},
      {kind:'missing',field:'location'},
    ]);
    expect(validateMapping(full)).toEqual([]);
  });
  it('来源列被重复选择时报告该列与涉及字段',()=>{
    expect(validateMapping({...full,collector:2})).toEqual([
      {kind:'duplicate',column:2,fields:['collectionNo','collector']},
    ]);
  });
});

describe('映射导入',()=>{
  it('乱序异名表头成功导入：按映射取值生成 Specimen，整批通过才产出',()=>{
    const r=importMappedCsv(tableOf(csv),full,[existing()]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows![0]).toMatchObject({collectionNo:'B-100',species:'兰',collector:'乙',date:'2026-02-28',location:'云南',latitude:'25.5',longitude:'102.5',habitat:'林下',resolutions:{}});
    expect(r.rows![1]).toMatchObject({collectionNo:'B-101',species:'松',collector:'甲',location:'北京'});
    expect(r.rows!.every(x=>x.id.length>0)).toBe(true);
    expect(new Set(r.rows!.map(x=>x.id)).size).toBe(2);
  });
  it('重复映射被拦截：不产出任何记录',()=>{
    const r=importMappedCsv(tableOf(csv),{...full,collector:2,habitat:2},[]);
    expect(r.rows).toBeUndefined();
    expect(r.errors).toEqual([{kind:'duplicate',column:2,fields:['collectionNo','collector','habitat']}]);
  });
  it('必填映射缺失被拦截：不做行级校验',()=>{
    const r=importMappedCsv(tableOf(csv),{...full,date:null,location:null},[]);
    expect(r.rows).toBeUndefined();
    expect(r.errors).toEqual([{kind:'missing',field:'date'},{kind:'missing',field:'location'}]);
  });
  it('任一数据行不合法则整批不写入，错误带原始行号',()=>{
    const bad='标本名,经度,编号,纬度,采集者,时间,产地,环境\n兰,102.5,B-100,25.5,乙,2026-02-30,云南,林下\n松,116.2,B-101,39.9,甲,2026-03-01,北京,山坡';
    const r=importMappedCsv(tableOf(bad),full,[]);
    expect(r.rows).toBeUndefined();
    expect(r.errors).toEqual([{kind:'row',line:2,message:'第 2 行：采集日期不合法'}]);
  });
  it('复用重复编号校验：与现有记录或批内编号重复都拒绝',()=>{
    const clash=importMappedCsv(tableOf(csv),full,[existing({collectionNo:'B-100'})]);
    expect(clash.rows).toBeUndefined();
    expect(clash.errors).toEqual([{kind:'row',line:2,message:'第 2 行：采集编号 B-100 重复'}]);
    const dup='标本名,经度,编号,纬度,采集者,时间,产地,环境\n兰,102.5,B-100,25.5,乙,2026-02-28,云南,林下\n松,116.2,B-100,39.9,甲,2026-03-01,北京,山坡';
    const r=importMappedCsv(tableOf(dup),full,[]);
    expect(r.errors).toEqual([{kind:'row',line:3,message:'第 3 行：采集编号 B-100 重复'}]);
  });
  it('复用坐标校验：经纬度未映射时按空值导入并逐行报错',()=>{
    const r=importMappedCsv(tableOf(csv),{...full,latitude:null,longitude:null},[]);
    expect(r.rows).toBeUndefined();
    expect(r.errors).toEqual([
      {kind:'row',line:2,message:'第 2 行：经纬度超出范围或缺失'},
      {kind:'row',line:3,message:'第 3 行：经纬度超出范围或缺失'},
    ]);
  });
  it('未映射的可选字段按空值导入',()=>{
    const r=importMappedCsv(tableOf(csv),{...full,species:null,habitat:null},[]);
    expect(r.errors).toEqual([]);
    expect(r.rows![0]).toMatchObject({species:'',habitat:'',collectionNo:'B-100'});
  });
  it('映射导入把原始列值写入记录，不去首尾空格',()=>{
    const padded='标本名,经度,编号,纬度,采集者,时间,产地,环境\n 兰 ,102.5, B-100 ,25.5,乙,2026-02-28,  云南  ,林下';
    const r=importMappedCsv(tableOf(padded),full,[]);
    expect(r.errors).toEqual([]);
    expect(r.rows![0]).toMatchObject({collectionNo:' B-100 ',species:' 兰 ',location:'  云南  ',habitat:'林下'});
  });
});
