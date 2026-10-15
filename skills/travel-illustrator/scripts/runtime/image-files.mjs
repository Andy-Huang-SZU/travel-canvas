import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const MAX_IMAGE_BYTES=25*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(data){let c=0xffffffff;for(const b of data)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
export function inspectImage(data){
  if(!Buffer.isBuffer(data))data=Buffer.from(data);
  if(!data.length || data.length>MAX_IMAGE_BYTES)throw new Error('图片为空或超过25MiB限制');
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
    let pos=8,width=0,height=0,ended=false,hasData=false;
    while(pos+12<=data.length){
      const length=data.readUInt32BE(pos),end=pos+12+length;
      if(end>data.length)throw new Error('PNG块不完整');
      const type=data.subarray(pos+4,pos+8).toString('ascii');
      if(crc32(data.subarray(pos+4,pos+8+length))!==data.readUInt32BE(pos+8+length))throw new Error('PNG校验不一致');
      if(type==='IHDR'){
        if(pos!==8 || length!==13)throw new Error('PNG头部无效');
        width=data.readUInt32BE(pos+8);height=data.readUInt32BE(pos+12);
      }
      if(type==='IDAT')hasData=true;
      pos=end;
      if(type==='IEND'){if(length!==0)throw new Error('PNG结束块无效');ended=true;break;}
    }
    if(!ended || !hasData || pos!==data.length || !width || !height)throw new Error('PNG结构不完整');
    return {mime:'image/png',extension:'.png',observedSize:[width,height],bytes:data.length,sha256:sha256(data)};
  }
  if(data.length>4 && data[0]===255 && data[1]===216 && data[data.length-2]===255 && data[data.length-1]===217){
    let pos=2,width=0,height=0;
    while(pos+4<data.length){
      if(data[pos++]!==255)throw new Error('JPEG标记无效');
      while(data[pos]===255)pos++;
      const marker=data[pos++];
      if(marker===0xda || marker===0xd9)break;
      if(marker===0x01 || marker>=0xd0 && marker<=0xd7)continue;
      const length=data.readUInt16BE(pos);
      if(length<2 || pos+length>data.length)throw new Error('JPEG块不完整');
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        if(length<8)throw new Error('JPEG尺寸块无效');
        height=data.readUInt16BE(pos+3);width=data.readUInt16BE(pos+5);
      }
      pos+=length;
    }
    if(!width || !height)throw new Error('无法读取JPEG实际尺寸');
    return {mime:'image/jpeg',extension:'.jpg',observedSize:[width,height],bytes:data.length,sha256:sha256(data)};
  }
  throw new Error('当前收图支持PNG和JPEG；未识别或不支持的格式不能作为已生成图片');
}
export async function readImage(filename){
  const stat=await fs.stat(filename);
  if(!stat.isFile() || stat.size>MAX_IMAGE_BYTES)throw new Error('素材不是文件或超过25MiB');
  const data=await fs.readFile(filename);
  return {data,...inspectImage(data),name:path.basename(filename)};
}
export function decodeImageBase64(value){
  if(typeof value!=='string')throw new Error('缺少图片数据');
  const raw=value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i,'').replace(/\s/g,'');
  if(raw.length>Math.ceil(MAX_IMAGE_BYTES/3)*4 || !raw.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length%4===1)throw new Error('图片Base64数据无效或过大');
  const data=Buffer.from(raw,'base64');inspectImage(data);return data;
}
export async function atomicJson(filename,value){
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const temp=filename+'.tmp-'+crypto.randomUUID();
  try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,filename);}
  catch(error){await fs.rm(temp,{force:true});throw error;}
}
export async function readBoundFile(directory,relative){
  if(typeof relative!=='string' || path.isAbsolute(relative))throw new Error('结果文件必须使用运行目录中的相对路径');
  const root=await fs.realpath(directory),file=await fs.realpath(path.resolve(root,relative));
  if(!file.startsWith(root+path.sep))throw new Error('结果文件越出了运行目录');
  return readImage(file);
}
