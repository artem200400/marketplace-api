import { Injectable } from '@nestjs/common'
import {
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { DatabaseService } from '../database/database.service.js'

const CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

@Injectable()
export class FilesService {
  private readonly bucket = required('STORAGE_BUCKET')
  private readonly s3 = new S3Client({
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.STORAGE_ENDPOINT),
    credentials: {
      accessKeyId: required('STORAGE_ACCESS_KEY'),
      secretAccessKey: required('STORAGE_SECRET_KEY')
    },
    requestChecksumCalculation: 'WHEN_REQUIRED'
  })

  constructor(private readonly db: DatabaseService) {}

  async createIntent(ownerId: string, contentType: string, expectedSize?: number) {
    const extension = CONTENT_TYPES[contentType]
    if (!extension) throw new Error('Unsupported content type')

    const key = `uploads/${ownerId}/${randomUUID()}.${extension}`
    const expiresIn = Number(process.env.STORAGE_PRESIGNED_TTL ?? 120)

    const row = await this.db.query<{ id: string }>(
      `INSERT INTO files ("key","owner_id","status","content_type","size")
       VALUES ($1,$2,'PENDING',$3,$4)
       RETURNING id::text`,
      [key, ownerId, contentType, expectedSize ?? null]
    )

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType
      }),
      { expiresIn }
    )

    return { id: row.rows[0].id, key, uploadUrl, expiresIn }
  }

  async createMultipartIntent(
    ownerId: string,
    contentType: string,
    size: number
  ) {
    const extension = CONTENT_TYPES[contentType]
    if (!extension) throw new Error('Unsupported content type')
    if (!Number.isFinite(size) || size <= 0) throw new Error('Invalid size')

    const key = `uploads/${ownerId}/${randomUUID()}.${extension}`
    const upload = await this.s3.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType
    }))

    if (!upload.UploadId) throw new Error('Storage did not return upload id')

    const minimumPart = 5 * 1024 * 1024
    const preferredPart = 8 * 1024 * 1024
    const partSize = Math.max(
      minimumPart,
      preferredPart,
      Math.ceil(size / 10000)
    )
    const partCount = Math.ceil(size / partSize)
    const expiresIn = Number(process.env.STORAGE_PRESIGNED_TTL ?? 120)

    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1
        const url = await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: upload.UploadId,
            PartNumber: partNumber
          }),
          { expiresIn }
        )
        return { partNumber, url }
      })
    )

    const row = await this.db.query<{ id: string }>(
      `INSERT INTO files ("key","owner_id","status","content_type","size","upload_id")
       VALUES ($1,$2,'PENDING',$3,$4,$5)
       RETURNING id::text`,
      [key, ownerId, contentType, size, upload.UploadId]
    )

    return {
      id: row.rows[0].id,
      key,
      uploadId: upload.UploadId,
      partSize,
      partCount,
      parts,
      expiresIn
    }
  }

  async listUploadedParts(ownerId: string, id: string) {
    const result = await this.db.query<{ key: string; upload_id: string | null }>(
      `SELECT "key","upload_id" FROM files WHERE id=$1 AND owner_id=$2`,
      [id, ownerId]
    )
    const file = result.rows[0]
    if (!file?.upload_id) throw new Error('Multipart upload not found')

    const listed = await this.s3.send(new ListPartsCommand({
      Bucket: this.bucket,
      Key: file.key,
      UploadId: file.upload_id
    }))

    return (listed.Parts ?? []).map(part => ({
      partNumber: part.PartNumber,
      etag: part.ETag
    }))
  }

  async commit(ownerId: string, id: string) {
    const result = await this.db.query<{
      key: string
      size: string | null
      status: string
    }>(
      `SELECT "key","size","status"
       FROM files
       WHERE id=$1 AND owner_id=$2`,
      [id, ownerId]
    )

    const file = result.rows[0]
    if (!file) throw new Error('File not found')

    const head = await this.s3.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: file.key
    }))

    if (
      file.size !== null &&
      head.ContentLength !== Number(file.size)
    ) {
      throw new Error('Uploaded size does not match intent')
    }

    await this.db.query(
      `UPDATE files
       SET status='COMPLETED',
           size=$1,
           completed_at=now()
       WHERE id=$2 AND owner_id=$3`,
      [head.ContentLength ?? 0, id, ownerId]
    )

    return { id, key: file.key, status: 'COMPLETED', size: head.ContentLength ?? 0 }
  }
}
