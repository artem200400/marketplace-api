import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, UnauthorizedException, CanActivate, ExecutionContext
} from '@nestjs/common'
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request } from 'express'
import type { PoolClient } from 'pg'
import { DatabaseService } from '../database/database.service.js'

const scrypt = promisify(scryptCallback)
const ACCESS_SECONDS = 600
const REFRESH_SECONDS = 7 * 86400
const issuer = 'marketplace-api'
const audience = 'marketplace-client'
type Claims = { sub: string; sid: string; role: 'USER'|'ADMIN'; exp: number; iat: number; iss: string; aud: string }
export type Principal = { id: string; role: 'USER'|'ADMIN'; sessionId: string }
export type AuthenticatedRequest = Request & { principal?: Principal }

function secret(): string {
  const value = process.env.AUTH_JWT_SECRET
  if (!value || Buffer.byteLength(value) < 32) throw new Error('AUTH_JWT_SECRET must be at least 32 bytes')
  return value
}
function digest(s: string): string { return createHash('sha256').update(s).digest('hex') }
function signature(text: string): string {
  return createHmac('sha256', secret()).update(text).digest('base64url')
}
function createAccess(user: {id: string; role: 'USER'|'ADMIN'}, sid: string): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: Claims = {
    sub: user.id, sid, role: user.role, iat: now, exp: now + ACCESS_SECONDS, iss: issuer, aud: audience
  }
  const input = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url') +
    '.' + Buffer.from(JSON.stringify(payload)).toString('base64url')
  return input + '.' + signature(input)
}
function verify(token: string): Claims {
  const parts = token.split('.')
  if (parts.length !== 3) throw new UnauthorizedException('Invalid access token')
  const [head, body, sig] = parts
  if (!head || !body || !sig) throw new UnauthorizedException('Invalid access token')
  try {
    const header = JSON.parse(Buffer.from(head,'base64url').toString('utf8'))
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Wrong algorithm')
    const a = Buffer.from(signature(head+'.'+body))
    const b = Buffer.from(sig)
    if (a.length !== b.length || !timingSafeEqual(a,b)) throw new Error('Signature invalid')
    const c = JSON.parse(Buffer.from(body,'base64url').toString('utf8')) as Claims
    const now = Math.floor(Date.now()/1000)
    if (c.iss !== issuer || c.aud !== audience || c.exp <= now || c.iat > now ||
      !/^\d+$/.test(c.sub) || !/^[0-9a-f-]{36}$/i.test(c.sid) ||
      !['USER','ADMIN'].includes(c.role)) throw new Error('Claims invalid')
    return c
  } catch { throw new UnauthorizedException('Invalid access token') }
}
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, Buffer.from(salt,'hex'), 64)) as Buffer
  return salt + ':' + hash.toString('hex')
}
async function validPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(':')
  if (!salt || !expected) return false
  const test = (await scrypt(password, Buffer.from(salt,'hex'), 64)) as Buffer
  const buf = Buffer.from(expected,'hex')
  return test.length === buf.length && timingSafeEqual(test,buf)
}
function validate(email: string, password: string): void {
  if (typeof email !== 'string' || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new BadRequestException('Valid email and a 12-128 character password required')
}
type Account = { id: string; role: 'USER'|'ADMIN'; password_hash: string|null }

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService) {}

  async register(email: string, password: string) {
    validate(email,password)
    const value = email.toLowerCase().trim()
    const hash = await hashPassword(password)
    const result = await this.db.query<{id: string}>(
      `INSERT INTO users(name,email,balance_cents,password_hash,role)
       VALUES($1,$2,0,$3,'USER') ON CONFLICT(email) DO NOTHING RETURNING id::text`,
       [value.split('@')[0].slice(0,120),value,hash])
    if (!result.rowCount) throw new ConflictException('Account already exists')
    return { id: result.rows[0].id }
  }

  async login(email: string, password: string) {
    if (typeof email !== 'string' || typeof password !== 'string') throw new UnauthorizedException('Invalid credentials')
    const account = (await this.db.query<Account>(
      'SELECT id::text,role,password_hash FROM users WHERE email=$1',
      [email.toLowerCase().trim()]
    )).rows[0]
    if (!account?.password_hash || !(await validPassword(password,account.password_hash)))
      throw new UnauthorizedException('Invalid credentials')
    return this.issue(account)
  }

  private async issue(user: {id:string;role:'USER'|'ADMIN'}, family = randomUUID()) {
    const sid = randomUUID()
    const refresh = randomBytes(32).toString('base64url')
    await this.db.query(
      `INSERT INTO auth_sessions(id,family_id,user_id,refresh_hash,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '7 days')`,
      [sid,family,user.id,digest(refresh)])
    return { access_token: createAccess(user,sid), refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_SECONDS }
  }

  async authenticate(header: string | undefined): Promise<Principal> {
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? '')
    if (!match) throw new UnauthorizedException('Bearer token required')
    const c = verify(match[1])
    const session = (await this.db.query<{ role: string }>(
      `SELECT u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [c.sid,c.sub]
    )).rows[0]
    if (!session || session.role !== c.role) throw new UnauthorizedException('Session expired or revoked')
    return { id: c.sub, role: c.role, sessionId: c.sid }
  }

  async refresh(refresh: string) {
    if (typeof refresh !== 'string' || refresh.length < 20) throw new UnauthorizedException('Invalid refresh token')
    return this.db.withClient(async (client: PoolClient) => {
      await client.query('BEGIN')
      try {
        const row = (await client.query<{
          id:string;family_id:string;user_id:string;role:'USER'|'ADMIN';revoked_at:Date|null;expires_at:Date
        }>(`SELECT s.id,s.family_id,s.user_id::text,u.role,s.revoked_at,s.expires_at
            FROM auth_sessions s JOIN users u ON u.id=s.user_id
            WHERE s.refresh_hash=$1 FOR UPDATE OF s`,[digest(refresh)])).rows[0]
        if (!row) throw new UnauthorizedException('Invalid refresh token')
        if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
          await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1',[row.family_id])
          await client.query('COMMIT')
          throw new UnauthorizedException('Refresh token reuse or expiry: family revoked')
        }
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[row.id])
        const sid = randomUUID(), next = randomBytes(32).toString('base64url')
        await client.query(
          `INSERT INTO auth_sessions(id,family_id,user_id,refresh_hash,expires_at)
           VALUES($1,$2,$3,$4,now()+interval '7 days')`,
          [sid,row.family_id,row.user_id,digest(next)])
        await client.query('COMMIT')
        return { access_token:createAccess({id:row.user_id,role:row.role},sid),
          refresh_token:next,token_type:'Bearer',expires_in:ACCESS_SECONDS }
      } catch(error) {
        // If the family has already been revoked and committed, do not rollback.
        if ((client as unknown as { _courseworkCommitted?: boolean })._courseworkCommitted !== true) {
          try { await client.query('ROLLBACK') } catch { /* no transaction */ }
        }
        throw error
      }
    })
  }

  async logout(p: Principal): Promise<{revoked:boolean}> {
    await this.db.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2',[p.sessionId,p.id])
    return {revoked:true}
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly auth:AuthService) {}
  async canActivate(context:ExecutionContext):Promise<boolean> {
    const req=context.switchToHttp().getRequest<AuthenticatedRequest>()
    req.principal=await this.auth.authenticate(req.headers.authorization)
    return true
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context:ExecutionContext):boolean {
    const req=context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (req.principal?.role !== 'ADMIN') throw new ForbiddenException('Admin role required')
    return true
  }
}
