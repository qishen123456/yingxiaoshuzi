import { useEffect, useState } from 'react';
import { App as AntApp, Alert, Button, Card, Col, Image, Input, Modal, Row, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FileImage, UploadCloud } from 'lucide-react';
import { api, type PosterTemplateRow, type ProductPackageOption } from '../api';

async function compressImage(file: File): Promise<string> {
  const original = await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
  const img = await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片无法解码'));image.src=original;});
  const scale=Math.min(1,1200/img.width),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器不支持图片压缩');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.78);
}
export default function PosterTemplates() {
  const { message } = AntApp.useApp();
  const [rows,setRows]=useState<PosterTemplateRow[]>([]),[loading,setLoading]=useState(false),[products,setProducts]=useState<ProductPackageOption[]>([]);
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[packageId,setPackageId]=useState<string>(),[previewData,setPreviewData]=useState(''),[uploadName,setUploadName]=useState('');
  const load=()=>{setLoading(true);api.get<PosterTemplateRow[]>('/poster-templates').then(setRows).catch((e)=>message.error(e.message)).finally(()=>setLoading(false));};
  useEffect(()=>{load();api.get<ProductPackageOption[]>('/packages').then(setProducts).catch(()=>undefined);},[]);
  const save=async()=>{
    if(!name.trim()){message.warning('请填写海报模板名称');return;}
    try{await api.post('/poster-templates',{name:name.trim(),packageId:packageId||null,previewData,width:750,height:1600,svgSpec:{canvas:{width:750,height:1600},slots:{}}});message.success('海报模板已保存到数据库（草稿状态）');setOpen(false);setName('');setPackageId(undefined);setPreviewData('');setUploadName('');load();}
    catch(e){message.error((e as Error).message);}
  };
  const setStatus=async(row:PosterTemplateRow,status:string)=>{
    try{await api.patch('/poster-templates/'+row.id+'/status',{status});message.success('模板状态已更新');load();}
    catch(e){message.error((e as Error).message);}
  };
  const columns:ColumnsType<PosterTemplateRow>=[
    {title:'模板预览',dataIndex:'previewData',width:110,render:(v:string|null)=>v?<Image src={v} width={60} height={78} style={{objectFit:'contain'}}/>:<div style={{width:60,height:78,display:'grid',placeItems:'center',background:'#eef4fa',borderRadius:7,color:'#5f86a8'}}><FileImage/></div>},
    {title:'模板名称',dataIndex:'name',render:(v:string,row)=><><Typography.Text strong>{v}</Typography.Text><div style={{fontSize:10,color:'#8b98a7'}}>#{row.id} · {row.width} × {row.height}</div></>},
    {title:'适配产品包',dataIndex:'package',render:(v:PosterTemplateRow['package'])=>v?.name||'通用模板'},
    {title:'背景资源',dataIndex:'backgroundOssKey',render:(v:string|null)=>v||<Typography.Text type="secondary">未接入 OSS</Typography.Text>},
    {title:'状态',dataIndex:'status',render:(v:string)=> <Tag color={v==='published'?'green':v==='disabled'?'default':'gold'}>{v==='published'?'已发布':v==='disabled'?'已停用':'草稿'}</Tag>},
    {title:'操作',width:170,render:(_,row)=><Space><Button size="small" onClick={()=>setStatus(row,row.status==='published'?'draft':'published')}>{row.status==='published'?'撤回发布':'发布模板'}</Button><Button size="small" onClick={()=>setStatus(row,'disabled')}>停用</Button></Space>},
  ];
  return <Space direction="vertical" size="middle" style={{width:'100%'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><Typography.Title level={3} style={{margin:0}}>海报模板配置</Typography.Title><Typography.Paragraph type="secondary" style={{margin:'5px 0 0'}}>在研选系统集中维护海报模板，并将所选海报快照带入推送批次。图片预览存入数据库；正式生产建议将原图转存 OSS。</Typography.Paragraph></div><Button type="primary" icon={<UploadCloud size={14}/>} onClick={()=>setOpen(true)}>上传海报模板</Button></div>
    <Alert type="info" showIcon message="模板状态说明" description="发布模板只代表模板在系统内可供选择，不会触发实际发送。AI 合成与 OSS 背景图接入仍需按海报服务接口完成联调。" />
    <Row gutter={[12,12]}>{[{label:'模板总数',value:rows.length},{label:'已发布',value:rows.filter(r=>r.status==='published').length},{label:'草稿',value:rows.filter(r=>r.status==='draft').length}].map(x=><Col xs={8} md={6} key={x.label}><Card size="small"><Typography.Text type="secondary">{x.label}</Typography.Text><Typography.Title level={3} style={{margin:'4px 0 0'}}>{x.value}</Typography.Title></Card></Col>)}</Row>
    <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={{pageSize:10}} />
    <Modal title="上传海报模板" open={open} onCancel={()=>setOpen(false)} onOk={save} okText="保存模板" cancelText="取消">
      <Space direction="vertical" style={{width:'100%'}} size="middle">
        <div><Typography.Text>模板名称 *</Typography.Text><Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="例如：局部焕新通用海报"/></div>
        <div><Typography.Text>适配产品包</Typography.Text><Select allowClear style={{width:'100%'}} value={packageId} onChange={setPackageId} placeholder="通用模板（不绑定产品包）" options={products.map((p)=>({label:p.name,value:p.id}))} /></div>
        <Upload accept="image/png,image/jpeg,image/webp" maxCount={1} showUploadList={false} beforeUpload={async(file)=>{try{setPreviewData(await compressImage(file));setUploadName(file.name);message.success('图片已加载');}catch(e){message.error((e as Error).message);}return false;}}><Button icon={<UploadCloud size={14}/>}>选择背景海报</Button></Upload>
        {previewData&&<Image src={previewData} height={220} style={{objectFit:'contain',background:'#f6f8fb',padding:8}}/>}
        <Typography.Text type="secondary" style={{fontSize:11}}>{uploadName||'PNG / JPG / WEBP，上传后压缩为 JPEG 保存到数据库。模板首次保存为草稿。'}</Typography.Text>
      </Space>
    </Modal>
  </Space>;
}
