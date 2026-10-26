import type { UploadReservation } from './handler.ts'
interface ObjectHead { size:number|undefined;type:string|undefined;etag:string|undefined }
interface StreamingHash { update(bytes:Uint8Array):void;digest():string }
export interface PackageStorage {
  head:(key:string)=>Promise<ObjectHead>
  read:(key:string,etag:string)=>Promise<ReadableStream<Uint8Array>>
  seal:(source:string,destination:string,etag:string,upload:UploadReservation)=>Promise<void>
}
export function packageMismatch():never{throw Object.assign(new Error('Package mismatch'),{code:'PACKAGE_MISMATCH'})}
export function validatePackageKeys(upload:UploadReservation){
  const suffix=upload.platform==='android'?'.apk':'.ipa'
  if(upload.staging_key!==`staging/${upload.id}/app${suffix}`||upload.object_key!==`releases/${upload.id}/app${suffix}`)packageMismatch()
}
export async function verifyAndSealPackage(upload:UploadReservation,storage:PackageStorage,hash:StreamingHash):Promise<void>{
  validatePackageKeys(upload)
  const head=await storage.head(upload.staging_key)
  if(head.size!==Number(upload.file_size)||head.type!==upload.content_type||!head.etag)packageMismatch()
  const stream=await storage.read(upload.staging_key,head.etag)
  const reader=stream.getReader()
  let bytes=0
  const signature:number[]=[]
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break
      bytes+=chunk.value.byteLength
      if(bytes>Number(upload.file_size))packageMismatch()
      for(let i=0;i<chunk.value.length&&signature.length<4;i++)signature.push(chunk.value[i])
      hash.update(chunk.value)
    }
  }finally{await reader.cancel().catch(()=>undefined)}
  if(bytes!==Number(upload.file_size)||hash.digest()!==upload.sha256||signature.join(',')!=='80,75,3,4')packageMismatch()
  // The published key never has a presigned PUT, and CopySourceIfMatch binds
  // it to the exact staging object whose bytes were hashed above.
  await storage.seal(upload.staging_key,upload.object_key,head.etag,upload)
  const sealed=await storage.head(upload.object_key)
  if(sealed.size!==bytes||sealed.etag!==head.etag||sealed.type!==upload.content_type)packageMismatch()
}
