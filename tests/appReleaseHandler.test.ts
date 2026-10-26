// @vitest-environment node
import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createAppReleaseHandler,type AppReleaseDependencies,type UploadReservation} from '../supabase/functions/app-releases/handler'
import {verifyAndSealPackage,type PackageStorage} from '../supabase/functions/app-releases/packageVerification'
const id='a0000000-0000-4000-8000-000000000001'
const upload:UploadReservation={id,uploaded_by:'admin',platform:'android',version:'1.0',minimum_os:'',notes:'',file_name:'app.apk',file_size:8,content_type:'application/vnd.android.package-archive',sha256:'a'.repeat(64),staging_key:`staging/${id}/app.apk`,object_key:`releases/${id}/app.apk`}
let deps:AppReleaseDependencies
const request=(body:unknown,token='token',origin='https://school.example')=>new Request('https://backend.example/app-releases',{method:'POST',headers:{origin,...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)})
beforeEach(()=>{deps={allowedOrigins:['https://school.example'],identify:vi.fn(async()=>({id:'admin',role:'admin'})),reserve:vi.fn(async()=>upload),uploadUrl:vi.fn(async()=> 'https://private.r2.example/presigned'),reservation:vi.fn(async()=>upload),verifyAndSeal:vi.fn(async()=>{}),publish:vi.fn(async()=>id),download:vi.fn(async()=> 'https://private.r2.example/download'),unpublish:vi.fn(async()=>{}),configured:()=>false}})
describe('app release endpoint',()=>{
  it('requires verified authentication before any storage or mutation access',async()=>{
    const handler=createAppReleaseHandler(deps)
    expect((await handler(request({action:'download',id},''))).status).toBe(401)
    expect(deps.download).not.toHaveBeenCalled()
    deps.identify=vi.fn(async()=>null)
    expect((await handler(request({action:'init'}))).status).toBe(401)
    expect(deps.reserve).not.toHaveBeenCalled()
  })
  it('permits signed-in student downloads but prevents managing releases',async()=>{
    deps.identify=vi.fn(async()=>({id:'student',role:'student'}))
    const handler=createAppReleaseHandler(deps)
    expect((await handler(request({action:'download',id}))).status).toBe(200)
    expect(deps.download).toHaveBeenCalledWith('student',id)
    for(const action of ['init','publish','link','unpublish','status'])expect((await handler(request({action,id}))).status).toBe(403)
    expect(deps.publish).not.toHaveBeenCalled()
  })
  it('returns an honest setup-pending status without exposing credentials',async()=>{
    const response=await createAppReleaseHandler(deps)(request({action:'status'}))
    expect(await response.json()).toEqual({configured:false})
  })
  it('reserves bounded matching packages and never accepts oversized or mismatched files',async()=>{
    const handler=createAppReleaseHandler(deps),input={action:'init',platform:'android',version:'1.0',minimum_os:'Android 9',notes:'New version',file_name:'app.apk',file_size:55*1024*1024,sha256:'a'.repeat(64)}
    expect((await handler(request(input))).status).toBe(200)
    expect(deps.reserve).toHaveBeenCalledTimes(1)
    expect((await handler(request({...input,file_size:201*1024*1024}))).status).toBe(400)
    expect((await handler(request({...input,file_name:'app.ipa'}))).status).toBe(400)
    expect((await handler(request({...input,sha256:'forged'}))).status).toBe(400)
    expect(deps.reserve).toHaveBeenCalledTimes(1)
  })
  it('verifies and seals server-selected object bytes before publishing metadata',async()=>{
    const order:string[]=[]
    deps.verifyAndSeal=vi.fn(async()=>{order.push('verified')})
    deps.publish=vi.fn(async()=>{order.push('published');return id})
    expect((await createAppReleaseHandler(deps)(request({action:'publish',id,object_key:'attacker-chosen-key'}))).status).toBe(200)
    expect(order).toEqual(['verified','published'])
    expect(deps.verifyAndSeal).toHaveBeenCalledWith(upload)
    expect(deps.publish).toHaveBeenCalledWith('admin',id)
  })
  it('does not publish unverified, expired, or cross-admin uploads and hides provider errors',async()=>{
    const handler=createAppReleaseHandler(deps)
    deps.reservation=vi.fn(async()=>null)
    expect((await handler(request({action:'publish',id}))).status).toBe(409)
    deps.reservation=vi.fn(async()=>upload)
    deps.verifyAndSeal=vi.fn(async()=>{throw Object.assign(new Error('secret-r2-url'),{code:'PACKAGE_MISMATCH'})})
    const response=await handler(request({action:'publish',id}))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('secret-r2-url')
    expect(deps.publish).not.toHaveBeenCalled()
  })
  it('allows only real Apple invitation/store destinations and rejects foreign CORS origins',async()=>{
    const handler=createAppReleaseHandler(deps),input={action:'link',version:'1.0',minimum_os:'iOS 15',notes:'',external_url:'https://testflight.apple.com/join/AbCd1234'}
    expect((await handler(request(input))).status).toBe(200)
    expect((await handler(request({...input,external_url:'https://testflight.apple.com.attacker.invalid/join/AbCd1234'}))).status).toBe(400)
    expect((await handler(request(input,'token','https://attacker.invalid'))).status).toBe(403)
  })
})
describe('actual app package verification',()=>{
  const body=Uint8Array.from([80,75,3,4,1,2,3,4])
  function fixture(){
    const input={...upload,sha256:createHash('sha256').update(body).digest('hex')}
    const hash=createHash('sha256')
    const storage:PackageStorage={head:vi.fn(async()=>({size:8,type:upload.content_type,etag:'"actual-object-etag"'})),read:vi.fn(async()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(body.slice(0,1));controller.enqueue(body.slice(1));controller.close()}})),seal:vi.fn(async()=>{})}
    return{input,storage,hash:{update:(chunk:Uint8Array)=>{hash.update(chunk)},digest:()=>hash.digest('hex')}}
  }
  it('hashes actual streamed bytes and binds publication to the checked staging object',async()=>{
    const {input,storage,hash}=fixture()
    await verifyAndSealPackage(input,storage,hash)
    expect(storage.read).toHaveBeenCalledWith(input.staging_key,'"actual-object-etag"')
    expect(storage.seal).toHaveBeenCalledWith(input.staging_key,input.object_key,'"actual-object-etag"',input)
    expect(storage.head).toHaveBeenCalledTimes(2)
  })
  it.each(['size','type','hash','key'] as const)('rejects a package with a wrong %s before publishing',async(kind)=>{
    const {input,storage,hash}=fixture()
    if(kind==='size')input.file_size=9
    if(kind==='type')input.content_type='application/octet-stream'
    if(kind==='hash')input.sha256='b'.repeat(64)
    if(kind==='key')input.staging_key='releases/other/app.apk'
    await expect(verifyAndSealPackage(input,storage,hash)).rejects.toMatchObject({code:'PACKAGE_MISMATCH'})
    expect(storage.seal).not.toHaveBeenCalled()
  })
})
