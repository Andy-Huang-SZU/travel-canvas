import path from 'node:path';
import {readImage,decodeImageBase64,MAX_IMAGE_BYTES} from './image-files.mjs';
const DRIVERS=['openai-images','openai-compatible','gemini-image','agent-native','manual'];
export class ProviderError extends Error{
  constructor(category,message,detail={}){
    super(message);this.name='ProviderError';this.category=category;
    this.status=detail.status??null;this.requestId=detail.requestId??null;
    this.retryAfterMs=detail.retryAfterMs??null;this.unknownOutcome=detail.unknownOutcome===true;
  }
}
const fail=(category,message)=>{throw new ProviderError(category,message);};
const localHost=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
export function validateEndpoint(value,{allowHttpLocalhost=false}={}){
  let url;try{url=new URL(value);}catch{fail('configuration','生图服务地址无效');}
  if(url.username || url.password || url.search || url.hash)fail('configuration','服务地址不得夹带凭证、查询参数或片段');
  if(url.protocol!=='https:' && !(url.protocol==='http:' && allowHttpLocalhost && localHost(url)))fail('configuration','服务地址需要HTTPS；本地协议测试可明确允许回环HTTP');
  return url;
}
export function validateProviderConfig(c){
  if(!c || !DRIVERS.includes(c.driver))fail('configuration','未支持的provider driver');
  if(['agent-native','manual'].includes(c.driver))return c;
  if(['apiKey','key','token','password','authorization'].some(k=>Object.hasOwn(c,k)))fail('configuration','密钥值不能放入provider配置，请使用apiKeyEnv环境变量名');
  validateEndpoint(c.baseUrl,{allowHttpLocalhost:c.allowHttpLocalhost===true});
  if(typeof c.model!=='string' || !/^[a-zA-Z0-9._-]+$/.test(c.model) || /user-selected|your-model|MODEL_ID/i.test(c.model))fail('configuration','先填写所选服务的真实图片模型标识');
  if(c.auth!=='none' && (typeof c.apiKeyEnv!=='string' || !/^[A-Z_][A-Z0-9_]*$/.test(c.apiKeyEnv)))fail('configuration','鉴权配置需要apiKeyEnv环境变量名，不能写入密钥值');
  if(c.timeoutMs!==undefined && (!Number.isInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>600000))fail('configuration','timeoutMs范围为1至600000毫秒');
  if(c.outputFormat && !['png','jpeg'].includes(c.outputFormat))fail('configuration','当前运行器收图支持PNG/JPEG，请选择其中一种');
  if(c.driver==='gemini-image' && c.imageConfigStyle && !['response-format','legacy-image-config','none'].includes(c.imageConfigStyle))fail('configuration','Gemini图片配置方式无效');
  return c;
}
export function configuredProfile(id,c){
  validateProviderConfig(c);
  const execution=c.driver==='agent-native'?'native':c.driver==='manual'?'manual':'api';
  const references=execution!=='api' || c.driver==='gemini-image' || c.driver==='openai-images' || c.referenceMode==='multipart-edit';
  return {id,execution,references,sizes:c.capabilities?.sizes??null,verified:c.capabilities?.verified===true,note:'来自用户配置；不是运行环境或模型实测结果。'};
}
function authentication(c,env){
  if(c.auth==='none')return {};
  const key=env[c.apiKeyEnv];
  if(!key)fail('configuration','未设置所选provider的密钥环境变量；无需把密钥写入聊天或项目文件');
  return c.driver==='gemini-image'?{'x-goog-api-key':key}:{Authorization:'Bearer '+key};
}
function usage(o){
  if(!o || typeof o!=='object')return null;
  const n=(...keys)=>{for(const key of keys)if(Number.isFinite(o[key])&&o[key]>=0)return o[key];return null;};
  return {inputTokens:n('input_tokens','promptTokenCount'),outputTokens:n('output_tokens','candidatesTokenCount'),totalTokens:n('total_tokens','totalTokenCount'),cost:null};
}
function normalizeError(status,body,headers){
  const code=String(body?.error?.code??'')+' '+String(body?.error?.status??'');
  const requestId=headers.get('x-request-id')||headers.get('x-goog-request-id')||null;
  const detail={status,requestId};
  // Never persist vendor messages, which can echo credentials or full private input.
  if(/moderation_blocked|safety|blocked/i.test(code))return new ProviderError('content','服务拒绝了这次内容；需检查并修订输入，不原样自动重试',detail);
  if(/insufficient_quota|quota|billing|RESOURCE_EXHAUSTED/i.test(code)||status===402)return new ProviderError('quota','服务额度或计费状态不允许继续，请检查账户',detail);
  if(status===401||status===403)return new ProviderError('authentication','服务鉴权失败，请检查所选环境变量与服务权限',detail);
  if(status===429){
    const after=headers.get('retry-after');let retryAfterMs=after===null?NaN:Number(after)*1000;
    if(!Number.isFinite(retryAfterMs)||retryAfterMs<0)retryAfterMs=Math.max(0,Date.parse(after)-Date.now());
    return new ProviderError('rate-limit','服务限流，已记录本次未成功请求',{...detail,retryAfterMs:Number.isFinite(retryAfterMs)?retryAfterMs:1000});
  }
  if(status>=500)return new ProviderError('server','服务内部错误；为避免重复生成，不自动重发状态不明确的提交',{...detail,unknownOutcome:true});
  return new ProviderError('request','服务未接受该请求，请核对模型、参数和参考图',detail);
}
async function readResponseBody(response,max=40*1024*1024){
  const length=Number(response.headers.get('content-length')||0);
  if(length>max)fail('response','服务响应超过允许大小');
  if(!response.body)return Buffer.alloc(0);
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('response','服务响应超过允许大小');}parts.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  return Buffer.concat(parts);
}
async function requestJson(url,init,c,{fetchImpl,signal,onSubmit}){
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('provider-timeout')),c.timeoutMs??180000);
  let submitted=false,requestId=null;
  try{
    await onSubmit?.();submitted=true;
    const response=await fetchImpl(url,{...init,signal:controller.signal,redirect:'error'});
    requestId=response.headers.get('x-request-id')||response.headers.get('x-goog-request-id')||null;
    const data=await readResponseBody(response);
    let body;try{body=JSON.parse(data.toString('utf8'));}catch{if(!response.ok)throw normalizeError(response.status,{},response.headers);throw new ProviderError('response','服务未返回可解析的JSON；提交结果尚不能确认',{status:response.status,unknownOutcome:true,requestId});}
    if(!response.ok)throw normalizeError(response.status,body,response.headers);
    return {body,requestId:response.headers.get('x-request-id')||response.headers.get('x-goog-request-id')||null};
  }catch(error){
    if(error instanceof ProviderError)throw error;
    if(!submitted)throw new ProviderError('local','无法保存提交状态，已停止请求',{unknownOutcome:false});
    if(signal?.aborted)throw new ProviderError('cancelled','本地请求已取消；远端是否已生成仍需检查',{unknownOutcome:true,requestId});
    if(controller.signal.aborted)throw new ProviderError('timeout','请求超时；远端结果未知，不自动重复提交',{unknownOutcome:true,requestId});
    throw new ProviderError('network','网络请求未完成；远端结果未知，不自动重复提交',{unknownOutcome:true,requestId});
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function references(job,assetRoot){
  const files=[];
  for(const a of job.assetRefs||[]){
    if(typeof a.uri!=='string'||/^[a-z][a-z0-9+.-]*:/i.test(a.uri)&&!/^[a-z]:[\\/]/i.test(a.uri))fail('reference','API运行器需要可访问的本地图片，宿主附件请先由agent解析为文件');
    try{files.push({...await readImage(path.resolve(assetRoot,a.uri)),id:a.id,role:a.role});}
    catch{fail('reference','参考素材不可读取或不是受支持的有效图片');}
  }
  return files;
}
function ratio(size){
  let a=size[0],b=size[1];while(b){const t=b;b=a%b;a=t;}return size[0]/a+':'+size[1]/a;
}
async function downloadImage(url,c,fetchImpl,signal){
  if(c.allowOutputUrls!==true)fail('response','服务返回图片URL；当前配置未允许下载该provider的输出URL');
  let target;try{target=new URL(url);}catch{fail('response','图片URL无效');}
  if(target.username||target.password || target.protocol!=='https:' && !(c.allowHttpLocalhost && target.protocol==='http:'&&localHost(target)))fail('response','图片URL的协议或凭证形式不允许');
  const allowed=c.outputHosts||[new URL(c.baseUrl).hostname];
  if(!allowed.includes(target.hostname))fail('response','图片URL主机不在此provider配置的输出主机列表中');
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),c.timeoutMs??180000);
  try{
    const response=await fetchImpl(target,{signal:controller.signal,redirect:'error'});
    if(!response.ok)throw new ProviderError('download','下载服务生成图片失败；不能因此重复生成',{unknownOutcome:true});
    return await readResponseBody(response,MAX_IMAGE_BYTES);
  }catch(error){
    if(error instanceof ProviderError)throw error;
    throw new ProviderError('download','图片下载未完成；生成提交已经发生，不自动重新生成',{unknownOutcome:true});
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function generateWithProvider(job,c,{assetRoot=process.cwd(),env=process.env,fetchImpl=globalThis.fetch,signal,onSubmit}={}){
  validateProviderConfig(c);
  if(['agent-native','manual'].includes(c.driver))return {status:'awaiting-result',execution:c.driver==='agent-native'?'native':'manual'};
  if(!['generate-page','generate-art'].includes(job.action))fail('request','未支持的生成动作');
  const headers=authentication(c,env);
  const inputs=await references(job,assetRoot);
  const base=c.baseUrl.replace(/\/+$/,'');
  let url,body,result;
  if(c.driver==='gemini-image'){
    url=base+'/models/'+encodeURIComponent(c.model)+':generateContent';
    const image={aspectRatio:ratio(job.requestedSize)};
    if(c.imageSize)image.imageSize=c.imageSize;
    const generationConfig={responseModalities:['IMAGE']};
    if(c.imageConfigStyle==='legacy-image-config')generationConfig.imageConfig=image;
    else if(c.imageConfigStyle!=='none')generationConfig.responseFormat={image};
    body={contents:[{role:'user',parts:[{text:job.prompt},...inputs.map(i=>({inlineData:{mimeType:i.mime,data:i.data.toString('base64')}}))]}],generationConfig};
    result=await requestJson(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)},c,{fetchImpl,signal,onSubmit});
    const candidates=result.body.candidates||[];
    const found=candidates.flatMap(x=>x.content?.parts||[]).map(p=>p.inlineData||p.inline_data).find(p=>p?.data);
    if(!found){
      if(result.body.promptFeedback?.blockReason || candidates.some(x=>/SAFETY|PROHIBITED_CONTENT|BLOCKLIST/.test(x.finishReason||'')))throw new ProviderError('content','服务拒绝了输出内容，需要检查输入',{requestId:result.requestId});
      throw new ProviderError('response','服务没有返回图片，不能记为生成成功',{requestId:result.requestId});
    }
    return {status:'generated',data:decodeImageBase64(found.data),requestId:result.requestId,usage:usage(result.body.usageMetadata),model:c.model};
  }
  const fields={model:c.model,prompt:job.prompt,n:1,size:job.requestedSize.join('x')};
  if(c.quality)fields.quality=c.quality;
  if(c.outputFormat)fields.output_format=c.outputFormat;
  if(c.driver==='openai-compatible'&&c.responseFormat)fields.response_format=c.responseFormat;
  if(inputs.length){
    if(c.driver==='openai-compatible'&&c.referenceMode!=='multipart-edit')fail('reference','此兼容服务未声明支持multipart参考图；不静默丢掉素材');
    url=base+'/images/edits';const form=new FormData();
    for(const [key,value]of Object.entries(fields))form.append(key,String(value));
    for(const input of inputs)form.append('image[]',new Blob([input.data],{type:input.mime}),input.name);
    body=form;
    result=await requestJson(url,{method:'POST',headers,body},c,{fetchImpl,signal,onSubmit});
  }else{
    url=base+'/images/generations';
    result=await requestJson(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(fields)},c,{fetchImpl,signal,onSubmit});
  }
  const image=result.body.data?.[0];
  if(!image)throw new ProviderError('response','服务没有返回图片，不能记为生成成功',{requestId:result.requestId});
  let data;
  if(image.b64_json)data=decodeImageBase64(image.b64_json);
  else if(image.url)data=await downloadImage(image.url,c,fetchImpl,signal);
  else throw new ProviderError('response','服务返回了未支持的图片结果格式',{requestId:result.requestId});
  return {status:'generated',data,requestId:result.requestId,usage:usage(result.body.usage),model:c.model};
}
