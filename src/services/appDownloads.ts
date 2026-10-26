import { supabase } from '@/lib/supabase'

export interface AppRelease {
  id:string; platform:'android'|'ios'; version:string; minimum_os:string; notes:string
  delivery:'android_apk'|'ios_archive'|'ios_store'; external_url:string|null; file_name:string|null
  file_size:number|null; sha256:string|null; published_at:string; is_active:boolean
}
export interface AppReleaseDraft { platform:'android'|'ios'; version:string; minimum_os:string; notes:string }
async function action<T>(body:Record<string,unknown>):Promise<T> {
  const {data,error}=await supabase.functions.invoke('app-releases',{body})
  if(error) {
    if(error.context instanceof Response) {
      const detail=await error.context.json().catch(()=>null)
      if(detail?.error&&typeof detail.error==='string') throw new Error(detail.error)
    }
    throw new Error('App downloads are not available. Please try again or contact the administrator.')
  }
  return data as T
}
export async function listAppReleases():Promise<AppRelease[]> {
  const {data,error}=await supabase.from('app_releases').select('id,platform,version,minimum_os,notes,delivery,external_url,file_name,file_size,sha256,published_at,is_active').eq('is_active',true).order('published_at',{ascending:false})
  if(error) throw error
  return data??[]
}
export async function appStorageConfigured():Promise<boolean> {return(await action<{configured:boolean}>({action:'status'})).configured===true}
export function readableAppSize(bytes:number|null):string {return bytes?`${(bytes/1024/1024).toFixed(1)} MB`:''}
export async function uploadAppRelease(file:File,draft:AppReleaseDraft,onProgress:(percent:number)=>void,signal:AbortSignal):Promise<void> {
  const extension=draft.platform==='android'?'.apk':'.ipa'
  if(!file.name.toLowerCase().endsWith(extension)||file.size<1||file.size>200*1024*1024) throw new Error(`Choose a ${extension.toUpperCase()} file up to 200 MB.`)
  const filename=file.name.replace(/\.(apk|ipa)$/i,extension)
  if(!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,110}\.(apk|ipa)$/.test(filename)) throw new Error('Use a simple file name containing letters, numbers, spaces, dots, dashes, or underscores.')
  onProgress(0)
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
  if(signal.aborted) throw new Error('Upload cancelled.')
  const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
  const reservation=await action<{id:string;url:string;content_type:string}>({action:'init',...draft,file_name:filename,file_size:file.size,sha256})
  if(signal.aborted) throw new Error('Upload cancelled.')
  await new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest()
    const abort=()=>xhr.abort()
    const done=()=>signal.removeEventListener('abort',abort)
    signal.addEventListener('abort',abort,{once:true})
    xhr.open('PUT',reservation.url)
    xhr.setRequestHeader('Content-Type',reservation.content_type)
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(95,Math.round(event.loaded/event.total*95)))}
    xhr.onload=()=>{done();xhr.status>=200&&xhr.status<300?resolve():reject(new Error('App storage rejected the upload. Ask the administrator to check R2 upload permissions and CORS.'))}
    xhr.onerror=()=>{done();reject(new Error('The upload could not reach app storage. Check your connection and R2 CORS settings.'))}
    xhr.onabort=()=>{done();reject(new Error('Upload cancelled.'))}
    xhr.send(file)
    if(signal.aborted)xhr.abort()
  })
  if(signal.aborted) throw new Error('Upload cancelled.')
  onProgress(96)
  await action({action:'publish',id:reservation.id})
  onProgress(100)
}
export async function publishIosLink(draft:Omit<AppReleaseDraft,'platform'>,externalUrl:string):Promise<void> {
  await action({action:'link',...draft,external_url:externalUrl.trim()})
}
export async function appDownloadUrl(release:AppRelease):Promise<string> {
  if(release.delivery==='ios_store') {
    if(!release.external_url||!/^https:\/\/(apps\.apple\.com\/[^\s]+|testflight\.apple\.com\/join\/[A-Za-z0-9]+)$/.test(release.external_url)) throw new Error('The iOS invitation link is unavailable.')
    return release.external_url
  }
  const result=await action<{url:string}>({action:'download',id:release.id})
  if(!/^https:\/\//.test(result.url)) throw new Error('The download link is unavailable.')
  return result.url
}
export async function unpublishAppRelease(id:string):Promise<void> {await action({action:'unpublish',id})}
