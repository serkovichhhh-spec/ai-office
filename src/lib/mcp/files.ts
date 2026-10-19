import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import {imageSize} from 'image-size';
export const MAX_FILE_BYTES=25*1024*1024;
export const INLINE_IMAGE_BYTES=3*1024*1024; // base64 stays under the hosting response limit
export class FileError extends Error {constructor(readonly code:string){super(code);}}
export interface FileMeta {sha256:string;mime_type:string;byte_size:number;width:number|null;height:number|null;extension:string}
export function inspectFile(bytes:Uint8Array):FileMeta {
 if(!bytes.length || bytes.length>MAX_FILE_BYTES)throw new FileError('file_too_large');
 const b=Buffer.from(bytes);let mime_type:string,extension:string;
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime_type='image/png';extension='png';}
 else if(b[0]===255&&b[1]===216&&b[2]===255){mime_type='image/jpeg';extension='jpg';}
 else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'&&b.readUInt32LE(4)+8===b.length){mime_type='image/webp';extension='webp';}
 else if(b.toString('ascii',0,5)==='%PDF-' && b.subarray(-1024).includes(Buffer.from('%%EOF'))){mime_type='application/pdf';extension='pdf';}
 else throw new FileError('unsupported_type');
 let width:number|null=null,height:number|null=null;
 if(mime_type.startsWith('image/')){
  try {const d=imageSize(b);width=d.width;height=d.height;}catch{throw new FileError('unsupported_type');}
  if(!width||!height||width>100000||height>100000)throw new FileError('unsupported_type');
 }
 return {sha256:createHash('sha256').update(b).digest('hex'),mime_type,byte_size:b.length,width,height,extension};
}
export function publicAddress(address:string):boolean {
 try{return ipaddr.process(address).range()==='unicast';}catch{return false;}
}
interface Address {address:string;family:number}
interface DownloadResponse {status:number;location?:string;length?:string;encoding?:string;body:AsyncIterable<Uint8Array>}
export interface DownloadDeps {
 resolve:(host:string)=>Promise<Address[]>;
 request:(url:URL,address:Address,signal:AbortSignal)=>Promise<DownloadResponse>;
}
const defaults:DownloadDeps={
 resolve:host=>lookup(host,{all:true,verbatim:true}),
 request:(url,address,signal)=>new Promise((resolve,reject)=>{
  const req=httpsRequest(url,{method:'GET',signal,family:address.family,headers:{'Accept-Encoding':'identity'},
   lookup:(_host,_options,cb)=>cb(null,address.address,address.family)},res=>{
    resolve({status:res.statusCode??0,location:res.headers.location,length:res.headers['content-length'],encoding:res.headers['content-encoding'],body:res});
  });
  req.on('error',reject);req.end();
 }),
};
/** Validate every redirect and pin its checked DNS result into the TLS connection. */
export async function downloadFile(raw:string,deps:DownloadDeps=defaults):Promise<Uint8Array>{
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),20_000);
 let onAbort:()=>void;
 const abort=new Promise<never>((_,reject)=>{onAbort=()=>reject(new FileError('download_failed'));controller.signal.addEventListener('abort',onAbort,{once:true});});
 try {
  let url=new URL(raw);
  for(let redirects=0;redirects<=3;redirects++){
   if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw new FileError('download_failed');
   const host=url.hostname.replace(/^\[|\]$/g,'');
   const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await Promise.race([deps.resolve(host),abort]);
   if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new FileError('download_failed');
   const response=await Promise.race([deps.request(url,addresses.find(a=>a.family===4)??addresses[0],controller.signal),abort]);
   if([301,302,303,307,308].includes(response.status)){
    // Drain the bounded response without exposing redirected bodies or signed URLs.
    const iterator=response.body[Symbol.asyncIterator]();await iterator.return?.();
    if(!response.location||redirects===3)throw new FileError('download_failed');
    url=new URL(response.location,url);continue;
   }
   if(response.status!==200 || (response.encoding && response.encoding!=='identity'))throw new FileError('download_failed');
   if(response.length && Number(response.length)>MAX_FILE_BYTES)throw new FileError('file_too_large');
   let size=0;const chunks:Uint8Array[]=[];
   const consume=async()=>{for await(const chunk of response.body){size+=chunk.length;if(size>MAX_FILE_BYTES)throw new FileError('file_too_large');chunks.push(chunk);}return Buffer.concat(chunks);};
   return await Promise.race([consume(),abort]);
  }
  throw new FileError('download_failed');
 }catch(e){if(e instanceof FileError)throw e;throw new FileError('download_failed');}
 finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',onAbort!);controller.abort();}
}
export function safeFileName(name:string|undefined):string{return (name??'file').split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f]/g,'').slice(0,160)||'file';}
