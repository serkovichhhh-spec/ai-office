import {createClient} from '@supabase/supabase-js';
import {FileError} from './files';
export interface FileStore {
 put:(path:string,bytes:Uint8Array,mime:string)=>Promise<void>;
 get:(path:string)=>Promise<Uint8Array>;
 signedUrl:(path:string)=>Promise<string>;
}
/** Credentials are server environment variables, never accepted as tool arguments. */
export function fileStore():FileStore{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new FileError('files_not_configured');
 const storage=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).storage.from('office-files');
 return {
  async put(path,bytes,mime){const {error}=await storage.upload(path,bytes,{contentType:mime,upsert:false});if(error && String((error as {statusCode?:string}).statusCode)!=='409')throw new FileError('storage_failed');},
  async get(path){const {data,error}=await storage.download(path);if(error||!data)throw new FileError('storage_failed');return new Uint8Array(await data.arrayBuffer());},
  async signedUrl(path){const {data,error}=await storage.createSignedUrl(path,600);if(error||!data)throw new FileError('storage_failed');return data.signedUrl;},
 };
}
