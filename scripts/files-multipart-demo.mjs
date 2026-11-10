import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import {
  cleanBucket,
  ensureBucket,
  s3Client,
  storageConfig
} from './storage-utils.mjs'

const s3 = s3Client()
const cfg = storageConfig()
const key = 'multipart/demo-large.bin'
const MiB = 1024 * 1024
const totalSize = 16 * MiB + 123
const partSize = Math.max(5 * MiB, Math.ceil(totalSize / 3), Math.ceil(totalSize / 10000))
const bytes = Buffer.alloc(totalSize, 0x61)

try {
  await ensureBucket(s3, cfg.bucket)
  await cleanBucket(s3, cfg.bucket)

  const created = await s3.send(new CreateMultipartUploadCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: 'application/octet-stream'
  }))
  const uploadId = created.UploadId
  if (!uploadId) throw new Error('No UploadId returned')

  const firstProcessParts = []
  for (let partNumber = 1; partNumber <= 2; partNumber += 1) {
    const start = (partNumber - 1) * partSize
    const end = Math.min(start + partSize, totalSize)
    const uploaded = await s3.send(new UploadPartCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: bytes.subarray(start, end)
    }))
    firstProcessParts.push({ ETag: uploaded.ETag, PartNumber: partNumber })
  }

  let headBeforeComplete = 200
  try {
    await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
  } catch (error) {
    headBeforeComplete = error?.$metadata?.httpStatusCode ?? 404
  }

  const listed = await s3.send(new ListPartsCommand({
    Bucket: cfg.bucket,
    Key: key,
    UploadId: uploadId
  }))
  const present = new Set((listed.Parts ?? []).map(p => p.PartNumber))
  const completedParts = (listed.Parts ?? []).map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber }))

  let resumedParts = 0
  const totalParts = Math.ceil(totalSize / partSize)
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (present.has(partNumber)) continue
    const start = (partNumber - 1) * partSize
    const end = Math.min(start + partSize, totalSize)
    const uploaded = await s3.send(new UploadPartCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: bytes.subarray(start, end)
    }))
    completedParts.push({ ETag: uploaded.ETag, PartNumber: partNumber })
    resumedParts += 1
  }

  completedParts.sort((a, b) => a.PartNumber - b.PartNumber)
  const completeResponse = await s3.send(new CompleteMultipartUploadCommand({
    Bucket: cfg.bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: completedParts }
  }))

  const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
  const sizeMatch = head.ContentLength === totalSize ? 1 : 0
  const etag = (head.ETag ?? completeResponse.ETag ?? '').replaceAll('"', '')
  const etagMultipart = /-\d+$/.test(etag) ? 1 : 0
  const complete = completeResponse.$metadata.httpStatusCode ?? 200

  console.log(`head-before-complete=${headBeforeComplete}`)
  console.log(`resumed-parts=${resumedParts}`)
  console.log(`complete=${complete}`)
  console.log(`size-match=${sizeMatch}`)
  console.log(`etag-multipart=${etagMultipart}`)

  if (!(headBeforeComplete === 404 && resumedParts === 1 && complete === 200 && sizeMatch === 1 && etagMultipart === 1)) {
    process.exitCode = 1
  }
} finally {
  await cleanBucket(s3, cfg.bucket).catch(() => undefined)
  s3.destroy()
}
