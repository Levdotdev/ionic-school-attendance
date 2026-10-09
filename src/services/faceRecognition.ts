import type Human from '@vladmandic/human'

export const FACE_MODEL_VERSION = 'human-faceres-3.3.6'

export interface FaceAnalysis {
  embedding: number[]
  detectionScore: number
  livenessScore: number
  antiSpoofScore: number
  yaw: number
}

let humanPromise: Promise<Human> | null = null

async function getHuman(): Promise<Human> {
  if (!humanPromise) {
    humanPromise = import('@vladmandic/human').then(async ({ default: HumanRuntime }) => {
      const human = new HumanRuntime({
        backend: 'webgl',
        modelBasePath: '/face-models/',
        cacheModels: true,
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
          },
          mesh: { enabled: true, modelPath: 'facemesh.json' },
          description: { enabled: true, modelPath: 'faceres.json', minConfidence: 0.65 },
          antispoof: { enabled: true, modelPath: 'antispoof.json' },
          liveness: { enabled: true, modelPath: 'liveness.json' },
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

export async function analyzeFace(blob: Blob): Promise<FaceAnalysis> {
  const [human, image] = await Promise.all([getHuman(), blobImage(blob)])
  const result = await human.detect(image)

  if (result.face.length === 0) {
    throw new Error('No face was found. Face the camera in good light and try again.')
  }
  if (result.face.length > 1) {
    throw new Error('More than one face was found. Make sure only you are in the photo.')
  }

  const face = result.face[0]
  if (!face.embedding?.length) {
    throw new Error('Your face could not be measured clearly. Move closer and try again.')
  }

  const faceWidthRatio = face.box[2] / Math.max(image.naturalWidth, 1)
  if (faceWidthRatio < 0.16) {
    throw new Error('Move closer to the camera so your face fills more of the frame.')
  }

  return {
    embedding: Array.from(face.embedding),
    detectionScore: face.boxScore,
    livenessScore: face.live ?? 0,
    antiSpoofScore: face.real ?? 0,
    yaw: face.rotation?.angle.yaw ?? 0,
  }
}

export function averageFaceEmbeddings(samples: number[][]): number[] {
  if (samples.length < 1) throw new Error('At least one face sample is required.')
  const size = samples[0]?.length ?? 0
  if (!size || samples.some((sample) => sample.length !== size)) {
    throw new Error('Face samples are not compatible. Please restart enrollment.')
  }

  const average = new Array<number>(size).fill(0)
  samples.forEach((sample) => sample.forEach((value, index) => { average[index] += value }))
  return average.map((value) => value / samples.length)
}

export async function faceSimilarity(first: number[], second: number[]): Promise<number> {
  const human = await getHuman()
  return human.match.similarity(first, second)
}

export async function validateEnrollmentSamples(samples: FaceAnalysis[]): Promise<number[]> {
  if (samples.length < 3) throw new Error('Three face photos are required for enrollment.')

  for (let index = 1; index < samples.length; index += 1) {
    const similarity = await faceSimilarity(samples[0].embedding, samples[index].embedding)
    if (similarity < 0.5) {
      throw new Error('The enrollment photos do not appear to show the same person. Please restart.')
    }
  }

  return averageFaceEmbeddings(samples.map((sample) => sample.embedding))
}
