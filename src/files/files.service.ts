import { Injectable } from '@nestjs/common'
import {
  HeadObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { PutObjectCommand } from '@aws-sdk/client-s3'
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
