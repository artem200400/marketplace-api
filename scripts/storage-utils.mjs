import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3'

export function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function storageConfig() {
  return {
    endpoint: required('STORAGE_ENDPOINT').replace(/\/$/, ''),
    accessKeyId: required('STORAGE_ACCESS_KEY'),
    secretAccessKey: required('STORAGE_SECRET_KEY'),
    bucket: required('STORAGE_BUCKET'),
    region: process.env.STORAGE_REGION ?? 'us-east-1'
  }
}

export function s3Client() {
  const c = storageConfig()
  return new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey
    },
    requestChecksumCalculation: 'WHEN_REQUIRED'
  })
}

export async function ensureBucket(s3, bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  }
}

export async function cleanBucket(s3, bucket) {
  const uploads = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }))
  for (const upload of uploads.Uploads ?? []) {
    if (upload.Key && upload.UploadId) {
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: upload.Key,
        UploadId: upload.UploadId
      }))
    }
  }

  const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
  const keys = (objects.Contents ?? []).flatMap(o => o.Key ? [{ Key: o.Key }] : [])
  if (keys.length) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys, Quiet: true }
    }))
  }
}

export function directObjectUrl(key) {
  const c = storageConfig()
  return `${c.endpoint}/${c.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
