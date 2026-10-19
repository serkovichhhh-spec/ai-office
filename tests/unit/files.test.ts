import {describe,it,expect,vi} from 'vitest';
import {inspectFile,publicAddress,downloadFile,MAX_FILE_BYTES,type DownloadDeps} from '@/lib/mcp/files';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=','base64');
async function* body(...parts:Uint8Array[]){for(const part of parts)yield part;}
const publicIP={address:'93.184.216.34',family:4};
const deps=(request:DownloadDeps['request']):DownloadDeps=>({resolve:async()=>[publicIP],request});
describe('file ingestion boundary',()=>{
 it('detects the real type, dimensions and hash, never the declared extension',()=>{
  expect(inspectFile(png)).toMatchObject({mime_type:'image/png',width:1,height:1,byte_size:png.length});
  expect(inspectFile(png).sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(()=>inspectFile(Buffer.from('<html>not a png</html>'))).toThrow('unsupported_type');
  expect(()=>inspectFile(Buffer.alloc(MAX_FILE_BYTES+1))).toThrow('file_too_large');
 });
 it.each(['127.0.0.1','10.2.3.4','172.16.1.1','192.168.1.1','169.254.169.254','100.64.1.1','0.0.0.0','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2002:7f00:1::'])('rejects non-public address %s',address=>expect(publicAddress(address)).toBe(false));
 it('allows public unicast and pins the resolved address into the request',async()=>{
  const request=vi.fn(async(_u,_address)=>({status:200,body:body(png)}));
  const bytes=await downloadFile('https://files.example/input.png',deps(request));
  expect(bytes).toEqual(png);expect(request.mock.calls[0][1]).toEqual(publicIP);
 });
 it('rejects private redirects and mixed public/private DNS answers',async()=>{
  const request=vi.fn(async()=>({status:302,location:'https://127.0.0.1/secret',body:body()}));
  await expect(downloadFile('https://files.example/input',deps(request))).rejects.toThrow('download_failed');
  expect(request).toHaveBeenCalledTimes(1);
  await expect(downloadFile('https://files.example/input',{...deps(request),resolve:async()=>[publicIP,{address:'10.0.0.1',family:4}]})).rejects.toThrow('download_failed');
  expect(request).toHaveBeenCalledTimes(1);
 });
 it.each(['http://files.example/a','https://user:password@files.example/a','https://files.example:8443/a','https://2130706433/a'])('rejects unsafe URL %s',async url=>{
  const request=vi.fn();await expect(downloadFile(url,deps(request))).rejects.toThrow('download_failed');expect(request).not.toHaveBeenCalled();
 });
 it('limits redirects and both declared and streamed byte size',async()=>{
  const redirects=vi.fn(async()=>({status:302,location:'/next',body:body()}));
  await expect(downloadFile('https://files.example/a',deps(redirects))).rejects.toThrow('download_failed');expect(redirects).toHaveBeenCalledTimes(4);
  await expect(downloadFile('https://files.example/a',deps(async()=>({status:200,length:String(MAX_FILE_BYTES+1),body:body()})))).rejects.toThrow('file_too_large');
  await expect(downloadFile('https://files.example/a',deps(async()=>({status:200,body:body(Buffer.alloc(MAX_FILE_BYTES),Buffer.from([1]))})))).rejects.toThrow('file_too_large');
 });
 it('times out DNS and requests within the same global budget',async()=>{
  vi.useFakeTimers();try{
   const promise=downloadFile('https://files.example/a',{resolve:()=>new Promise(()=>{}),request:vi.fn()});
   const check=expect(promise).rejects.toThrow('download_failed');await vi.advanceTimersByTimeAsync(20001);await check;
  }finally{vi.useRealTimers();}
 });
});
