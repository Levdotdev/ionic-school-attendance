import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand,CopyObjectCommand,DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3.1156.0'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.1156.0'
import { createSHA256 } from 'npm:hash-wasm@4.12.0'
import { createAppReleaseHandler,type UploadReservation } from './handler.ts'
import { validatePackageKeys,verifyAndSealPackage } from './packageVerification.ts'

const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
const site=Deno.env.get('SITE_URL')||'https://ionic-school-attendance.vercel.app'
let s3:S3Client|undefined
function storage() {
  const account=Deno.env.get('R2_ACCOUNT_ID'),bucket=Deno.env.get('R2_BUCKET'),key=Deno.env.get('R2_ACCESS_KEY_ID'),secret=Deno.env.get('R2_SECRET_ACCESS_KEY')
  if(!account||!/^[a-f0-9]{32}$/.test(account)||!bucket||!key||!secret) throw new Error('App storage configuration unavailable')
  s3??=new S3Client({region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId:key,secretAccessKey:secret},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'})
  return {client:s3,bucket}
}
const rpc=async(name:string,args:Record<string,unknown>)=>{
  const result=await admin.rpc(name,args)
  if(result.error) throw result.error
  return result.data
}
Deno.serve(createAppReleaseHandler({
  allowedOrigins:[new URL(site).origin,'http://localhost:5173','http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173','https://localhost','capacitor://localhost'],
  async identify(token) {
    const auth=await admin.auth.getUser(token)
    if(auth.error||!auth.data.user?.email_confirmed_at) return null
    const result=await admin.from('profiles').select('id,role,onboarding_completed_at').eq('id',auth.data.user.id).maybeSingle()
    const profile=result.data
    return result.error||!profile?.onboarding_completed_at||!['admin','teacher','student','parent'].includes(profile.role)?null:{id:profile.id,role:profile.role}
  },
  async reserve(actor,input) {
    const rows=await rpc('reserve_app_release_upload',{p_actor:actor,p_platform:input.platform,p_version:input.version,p_minimum_os:input.minimum_os,p_notes:input.notes,p_file_name:input.file_name,p_file_size:input.file_size,p_content_type:input.platform==='android'?'application/vnd.android.package-archive':'application/octet-stream',p_sha256:input.sha256})
    if(!rows?.[0]) throw new Error('Upload reservation unavailable')
    return rows[0]
  },
  async uploadUrl(upload) {
    validatePackageKeys(upload)
    const {client,bucket}=storage()
    return getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:upload.staging_key,ContentType:upload.content_type,ContentLength:upload.file_size,Metadata:{sha256:upload.sha256}}),{expiresIn:900,signableHeaders:new Set(['content-type','content-length'])})
  },
  async reservation(actor,id) {return(await rpc('app_release_upload_for_publish',{p_actor:actor,p_id:id}))?.[0]??null},
  async verifyAndSeal(upload) {
    const {client,bucket}=storage()
    // R2 does not support SHA256 FULL_OBJECT checksums. Compute the actual
    // digest incrementally rather than trusting client-controlled metadata.
    const hasher=await createSHA256();hasher.init()
    await verifyAndSealPackage(upload,{
      async head(key){const value=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));return{size:value.ContentLength,type:value.ContentType,etag:value.ETag}},
      async read(key,etag){const value=await client.send(new GetObjectCommand({Bucket:bucket,Key:key,IfMatch:etag}));if(!value.Body)throw new Error('Package unavailable');return value.Body.transformToWebStream()},
      async seal(source,destination,etag,value){await client.send(new CopyObjectCommand({Bucket:bucket,Key:destination,CopySource:`${bucket}/${source}`,CopySourceIfMatch:etag,MetadataDirective:'REPLACE',Metadata:{sha256:value.sha256},ContentType:value.content_type,ContentDisposition:`attachment; filename="${value.file_name}"`}))},
    },{update:bytes=>hasher.update(bytes),digest:()=>hasher.digest('hex')})
  },
  async publish(actor,id,input) {
    const result=await rpc('publish_app_release',{p_actor:actor,p_id:id,p_external_url:input?.external_url??null,p_version:input?.version??'',p_minimum_os:input?.minimum_os??'',p_notes:input?.notes??''})
    if(id) {
      const {client,bucket}=storage()
      const upload=(await admin.from('app_releases').select('platform').eq('id',id).single()).data
      if(upload) await client.send(new DeleteObjectCommand({Bucket:bucket,Key:`staging/${id}/app${upload.platform==='android'?'.apk':'.ipa'}`})).catch(()=>undefined)
    }
    return result
  },
  async download(actor,id) {
    const rows=await rpc('app_release_object',{p_actor:actor,p_id:id})
    if(!rows?.[0]) return null
    const {client,bucket}=storage()
    return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:rows[0].object_key,ResponseContentDisposition:`attachment; filename="${rows[0].file_name}"`}),{expiresIn:300})
  },
  async unpublish(actor,id) {await rpc('unpublish_app_release',{p_actor:actor,p_id:id})},
  configured() {return ['R2_ACCOUNT_ID','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'].every(name=>Boolean(Deno.env.get(name)?.trim()))},
}))
