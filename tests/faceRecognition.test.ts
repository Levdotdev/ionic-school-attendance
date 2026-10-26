import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ config: null as any, detect: vi.fn(), load: vi.fn() }))
vi.mock('@vladmandic/human', () => ({ default: class {
  constructor(config: unknown) { runtime.config = config }
  load = runtime.load
  detect = runtime.detect
} }))
import { analyzeFace, averageFaceEmbeddings, FACE_EMBEDDING_SIZE, faceSimilarity, validFaceEmbedding, validateEnrollmentSamples, validateFaceQuality, type FaceAnalysis } from '@/services/faceRecognition'

const vector = (value: number) => Array(FACE_EMBEDDING_SIZE).fill(value)
const sample = (value = 1): FaceAnalysis => ({ embedding: vector(value), detectionScore: .99, livenessScore: .99, antiSpoofScore: .99, yaw: 0 })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('fresh FaceRes identity matching', () => {
  it('rejects descriptors which share a direction but have a different FaceRes distance', async () => {
    const first=vector(1), other=vector(2)
    // Raw cosine is1 here: the previous server matcher accepted this pair.
    const dot=first.reduce((total,value,index) => total+value*other[index],0)
    const cosine=dot/Math.sqrt(first.reduce((sum,v) => sum+v*v,0)*other.reduce((sum,v) => sum+v*v,0))
    expect(cosine).toBe(1)
    expect(await faceSimilarity(first,other)).toBe(0)
    expect(await faceSimilarity(first,first)).toBe(1)
  })
  it('matches the pinned package FaceRes normalization, without substituting a cosine score', async () => {
    const first=vector(1), second=vector(1.3)
    // Human's normalized squared-Euclidean FaceRes formula gives0.53.
    expect(await faceSimilarity(first,second)).toBe(.53)
    await expect(faceSimilarity(first,vector(1.31))).resolves.toBe(.51)
  })
  it('rejects malformed, nonfinite, zero and incompatible descriptors', async () => {
    for(const input of [[],Array(64).fill(1),vector(0),[NaN,...vector(1).slice(1)],[Infinity,...vector(1).slice(1)],vector(1e308)]) {
      expect(validFaceEmbedding(input)).toBe(false)
      await expect(faceSimilarity(vector(1),input)).rejects.toThrow('not compatible')
    }
    expect(() => averageFaceEmbeddings([vector(0)])).toThrow('not compatible')
  })
  it('requires all three enrollment photos to agree, including the second and third pair', async () => {
    // Each extreme matches the midpoint, while the extremes do not match.
    await expect(validateEnrollmentSamples([sample(1),sample(.82),sample(1.18)])).rejects.toThrow('same person')
    await expect(validateEnrollmentSamples([sample(1),sample(1.01),sample(.99)])).resolves.toEqual(vector(1))
  })
  it('rejects low quality and non-live enrollment samples instead of enrolling them', async () => {
    expect(() => validateFaceQuality({...sample(),livenessScore:.2})).toThrow('live face')
    expect(() => validateFaceQuality({...sample(),antiSpoofScore:NaN})).toThrow('live face')
    expect(() => validateFaceQuality({...sample(),detectionScore:.2})).toThrow('not clear enough')
    await expect(validateEnrollmentSamples([sample(),sample(),{...sample(),antiSpoofScore:.1}])).rejects.toThrow('live face')
  })
  it('runs independent inference for every still photograph with no result reuse', async () => {
    class PreviewImage {
      naturalWidth=1280; naturalHeight=1280
      onload: (()=>void)|null=null; onerror: (()=>void)|null=null
      set src(_value:string) { queueMicrotask(() => this.onload?.()) }
    }
    class PreviewUrl extends URL { static createObjectURL() { return 'blob:test-photo' }; static revokeObjectURL() {} }
    vi.stubGlobal('Image',PreviewImage); vi.stubGlobal('URL',PreviewUrl)
    const face=(value:number) => ({embedding:vector(value),box:[0,0,256,256],boxScore:.99,live:.99,real:.99})
    runtime.detect.mockResolvedValueOnce({face:[face(1)]}).mockResolvedValueOnce({face:[face(2)]})
    const results=await Promise.all([analyzeFace(new Blob(['one'])),analyzeFace(new Blob(['two']))])
    expect(results[0].embedding).toEqual(vector(1))
    expect(results[1].embedding).toEqual(vector(2))
    expect(runtime.detect).toHaveBeenCalledTimes(2)
    expect(runtime.config.cacheSensitivity).toBe(0)
    for(const model of ['detector','description','antispoof','liveness']) {
      expect(runtime.config.face[model].skipTime).toBe(0)
      expect(runtime.config.face[model].skipFrames).toBe(0)
    }
  })
})
