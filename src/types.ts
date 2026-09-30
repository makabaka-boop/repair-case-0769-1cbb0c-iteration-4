export type IssueStatus='pending'|'fixed'|'kept';
export type Specimen={id:string;collectionNo:string;species:string;collector:string;date:string;location:string;latitude:string;longitude:string;habitat:string;resolutions:Record<string,{status:IssueStatus;note:string}>};
export type UndoEntry={id:string;snapshot:Specimen;savedAt:string};
export type Issue={key:string;type:'物种名缺失'|'日期晚于当前日期'|'经纬度不合法'|'采集编号重复';recordId:string};
export const fields=['collectionNo','species','collector','date','location','latitude','longitude','habitat'] as const;
export const headers=['采集编号','物种名称','采集人','采集日期','地点','纬度','经度','生境备注'];
