import type Human from '@vladmandic/human'

// The embedding model is unchanged; the suffix identifies the fresh-capture
// policy so the server can require an updated app without deleting templates.
export const FACE_MODEL_VERSION = 'human-faceres-3.3.6-fresh-v2'
export const FACE_EMBEDDING_SIZE = 1024
export const FACE_MATCH_THRESHOLD = 0.55
export const FACE_QUALITY_THRESHOLD = 0.6

export interface FaceAnalysis {
  embedding: number[]
  detectionScore: number
  livenessScore: number
  antiSpoofScore: number
  yaw: number
}

let humanPromise: Promise<Human> | null = null
let analysisQueue: Promise<void> = Promise.resolve()

async function getHuman(): Promise<Human> {
  if (!humanPromise) {
    humanPromise = import('@vladmandic/human').then(async ({ default: HumanRuntime }) => {
      const human = new HumanRuntime({
        backend: 'webgl',
        modelBasePath: '/face-models/',
        cacheModels: true,
        // Model weights may be cached. Identity and liveness results must be
        // recomputed for every independently captured still photo.
        cacheSensitivity: 0,
        debug: false,
        async: true,
        face: {
          enabled: true,
          detector: {
            enabled: true,
            modelPath: 'blazeface.json',
            maxDetected: 2,
            minConfidence: 0.65,
            rotation: true,
            skipFrames: 0,
            skipTime: 0,
          },
          mesh: { enabled: true, modelPath: 'facemesh.json' },
          description: { enabled: true, modelPath: 'faceres.json', minConfidence: 0.65, skipFrames: 0, skipTime: 0 },
          antispoof: { enabled: true, modelPath: 'antispoof.json', skipFrames: 0, skipTime: 0 },
          liveness: { enabled: true, modelPath: 'liveness.json', skipFrames: 0, skipTime: 0 },
          iris: { enabled: false },
          emotion: { enabled: false },
          attention: { enabled: false },
          gear: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        segmentation: { enabled: false },
        gesture: { enabled: false },
      })

      await human.load()
      return human
    }).catch(error => {
      humanPromise = null
      throw error
    })
  }

  return humanPromise
}

async function blobImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The face photo could not be read. Please take it again.'))
    }
    image.src = url
  })
}

async function analyzeCapturedFace(blob: Blob): Promise<FaceAnalysis> {
  const [human, image] = await Promise.all([getHuman(), blobImage(blob)])
  const result = await human.detect(image)

  if (result.face.length === 0) {
    throw new Error('No face was found. Face the camera in good light and try again.')
  }
  if (result.face.length > 1) {
    throw new Error('More than one face was found. Make sure only you are in the photo.')
  }

  const face = result.face[0]
  const embedding = face.embedding ? Array.from(face.embedding) : []
  if (!validFaceEmbedding(embedding)) {
    throw new Error('Your face could not be measured clearly. Move closer and try again.')
  }

  const faceWidthRatio = face.box[2] / Math.max(image.naturalWidth, 1)
  if (faceWidthRatio < 0.16 || face.box[2] < 224) {
    throw new Error('Move closer to the camera so your face fills more of the frame.')
  }

  const analysis = {
    embedding,
    detectionScore: face.boxScore,
    livenessScore: face.live ?? 0,
    antiSpoofScore: face.real ?? 0,
    yaw: face.rotation?.angle.yaw ?? 0,
  }
  validateFaceQuality(analysis)
  return analysis
}

export function analyzeFace(blob: Blob): Promise<FaceAnalysis> {
  // Human owns mutable inference buffers. Never let enrollment and check-in
  // requests concurrently consume one another's most recent result.
  const task = analysisQueue.then(() => analyzeCapturedFace(blob))
  analysisQueue = task.then(() => undefined, () => undefined)
  return task
}

export function validFaceEmbedding(embedding: number[]): boolean {
  if (embedding.length !== FACE_EMBEDDING_SIZE || !embedding.every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) return false
  return embedding.reduce((total, value) => total + value * value, 0) > 1e-12
}

export function validateFaceQuality(sample: FaceAnalysis): void {
  if (!validFaceEmbedding(sample.embedding)) throw new Error('Your face could not be measured clearly. Retake the photo in good light.')
  if (!Number.isFinite(sample.detectionScore) || sample.detectionScore < 0.65 || sample.detectionScore > 1) throw new Error('Your face is not clear enough. Face the camera in good light and try again.')
  if (!Number.isFinite(sample.livenessScore) || !Number.isFinite(sample.antiSpoofScore)
    || sample.livenessScore < FACE_QUALITY_THRESHOLD || sample.antiSpoofScore < FACE_QUALITY_THRESHOLD
    || sample.livenessScore > 1 || sample.antiSpoofScore > 1) {
    throw new Error('A clear, live face photo is required. Take a new photo of yourself in good light.')
  }
}

export function averageFaceEmbeddings(samples: number[][]): number[] {
  if (samples.length < 1) throw new Error('At least one face sample is required.')
  const size = FACE_EMBEDDING_SIZE
  if (samples.some((sample) => !validFaceEmbedding(sample))) {
    throw new Error('Face samples are not compatible. Please restart enrollment.')
  }

  const average = new Array<number>(size).fill(0)
  samples.forEach((sample) => sample.forEach((value, index) => { average[index] += value }))
  return average.map((value) => value / samples.length)
}

export async function faceSimilarity(first: number[], second: number[]): Promise<number> {
  if (!validFaceEmbedding(first) || !validFaceEmbedding(second)) throw new Error('Face samples are not compatible. Please restart enrollment.')
  // Exact FaceRes distance normalization from Human3.3.6 face/match.ts:
  // order2, multiplier25, min0.2, max0.8. Cosine is not the same score.
  const sum = first.reduce((total, value, index) => total + (value - second[index]) ** 2, 0)
  const distance = Math.round(2500 * sum) / 100
  if (distance === 0) return 1
  const normalized = (1 - Math.sqrt(distance) / 100 - 0.2) / 0.6
  return Math.round(100 * Math.max(0, Math.min(1, normalized))) / 100
}

export async function validateEnrollmentSamples(samples: FaceAnalysis[]): Promise<number[]> {
  if (samples.length < 3) throw new Error('Three face photos are required for enrollment.')
  samples.forEach(validateFaceQuality)
  for (let first = 0; first < samples.length; first += 1) {
    for (let second = first + 1; second < samples.length; second += 1) {
      const similarity = await faceSimilarity(samples[first].embedding, samples[second].embedding)
      if (similarity < FACE_MATCH_THRESHOLD) {
        throw new Error('The enrollment photos do not appear to show the same person. Please restart.')
      }
    }
  }

  return averageFaceEmbeddings(samples.map((sample) => sample.embedding))
}
