export interface ReleaseActor { id: string; role: string }
export interface UploadReservation {
  id: string; uploaded_by: string; platform: 'android'; version: string; minimum_os: string; notes: string
  file_name: string; file_size: number; content_type: string; sha256: string; staging_key: string; object_key: string
}
export interface AppReleaseDependencies {
  allowedOrigins: string[]
  identify: (token: string) => Promise<ReleaseActor|null>
  reserve: (actor: string, input: Record<string, unknown>) => Promise<UploadReservation>
  uploadUrl: (upload: UploadReservation) => Promise<string>
  reservation: (actor: string, id: string) => Promise<UploadReservation|null>
  verifyAndSeal: (upload: UploadReservation) => Promise<void>
  publish: (actor: string, id: string) => Promise<string>
  download: (actor: string, id: string) => Promise<string|null>
  unpublish: (actor: string, id: string) => Promise<void>
  configured: () => boolean
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function createAppReleaseHandler(deps: AppReleaseDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin=request.headers.get('origin')??''
    const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}
    if(deps.allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin']=origin
    headers['Access-Control-Allow-Headers']='authorization, apikey, x-client-info, content-type'
    headers['Access-Control-Allow-Methods']='POST, OPTIONS'
    const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers})
    if(request.method!=='POST') return response({error:'Method not allowed'},405)
    if(origin&&!deps.allowedOrigins.includes(origin)) return response({error:'This origin is not allowed'},403)
    const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if(!token) return response({error:'Sign in before downloading the app.'},401)
    try {
      const actor=await deps.identify(token)
      if(!actor) return response({error:'A verified, completed account is required.'},401)
      const text=await request.text()
      if(text.length>16000) return response({error:'The request is too large.'},413)
      let input:Record<string,unknown>
      try { input=JSON.parse(text); if(!input||Array.isArray(input)||typeof input!=='object') throw new Error() }
      catch { return response({error:'The app request is invalid.'},400) }
      if(input.action==='download') {
        if(typeof input.id!=='string'||!UUID.test(input.id)) return response({error:'Choose a published app version.'},400)
        const url=await deps.download(actor.id,input.id)
        return url?response({url,expires_in:300}):response({error:'This app version is no longer available.'},404)
      }
      if(actor.role!=='admin') return response({error:'Administrator access is required to manage app releases.'},403)
      if(input.action==='status') return response({configured:deps.configured()})
      if(input.action==='init') {
        const platform=input.platform
        const fileName=input.file_name
        if(platform!=='android'||typeof fileName!=='string'
          ||!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,110}\.apk$/.test(fileName)
          ||!Number.isInteger(input.file_size)||Number(input.file_size)<1||Number(input.file_size)>200*1024*1024
          ||typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256)
          ||typeof input.version!=='string'||!input.version.trim()||input.version.length>40
          ||typeof input.minimum_os!=='string'||input.minimum_os.length>80||typeof input.notes!=='string'||input.notes.length>2000) {
          return response({error:'Choose an Android APK package up to 200 MB and enter its version.'},400)
        }
        const upload=await deps.reserve(actor.id,input)
        const url=await deps.uploadUrl(upload)
        return response({id:upload.id,url,content_type:upload.content_type,expires_in:900})
      }
      if(input.action==='publish') {
        if(typeof input.id!=='string'||!UUID.test(input.id)) return response({error:'Choose a completed upload.'},400)
        const upload=await deps.reservation(actor.id,input.id)
        if(!upload) return response({error:'This upload expired or is already published. Start a new upload.'},409)
        await deps.verifyAndSeal(upload)
        return response({id:await deps.publish(actor.id,input.id)})
      }
      if(input.action==='unpublish') {
        if(typeof input.id!=='string'||!UUID.test(input.id)) return response({error:'Choose a published app version.'},400)
        await deps.unpublish(actor.id,input.id)
        return response({unpublished:true})
      }
      return response({error:'This app action is not supported.'},400)
    } catch(error) {
      const code=error&&typeof error==='object'&&'code' in error?String(error.code):''
      if(code==='42901') return response({error:'Please wait before starting another app upload.'},429)
      if(code==='PACKAGE_MISMATCH') return response({error:'The uploaded package did not match its size, type, or checksum. Start a new upload.'},400)
      // Provider responses may contain signed URLs or credentials. Never expose
      // raw error bodies or private object keys to clients or logs.
      return response({error:'App storage is unavailable or the upload could not be verified. Please try again or contact the administrator.'},503)
    }
  }
}
