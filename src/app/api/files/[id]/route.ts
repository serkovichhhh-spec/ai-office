import {currentUser} from '@/lib/supabase';
import {asUser,db} from '@/lib/db';
import {fileStore} from '@/lib/mcp/file-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await currentUser();if(!user)return new Response('unauthorized',{status:401});
 const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return new Response('not found',{status:404});
 const [file]=await asUser(db(),user.id,tx=>tx`select storage_path from office.artifact_files where id=${id}::uuid`);
 if(!file)return new Response('not found',{status:404});
 const url=await fileStore().signedUrl(String(file.storage_path));
 return new Response(null,{status:307,headers:{Location:url,'Cache-Control':'private, no-store'}});
}
