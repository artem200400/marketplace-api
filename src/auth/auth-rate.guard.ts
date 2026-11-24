import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'
import type { Request } from 'express'

@Injectable()
export class AuthRateGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context:ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const route = req.path
    const max = route.endsWith('/register') ? 5 : route.endsWith('/login') ? 10 : 20
    // Use the socket remote address, never a spoofable X-Forwarded-For header.
    const identity = (req.socket.remoteAddress ?? 'unknown').slice(0,100)
    const key = route + ':' + identity
    const row = (await this.db.query<{attempts:number}>(`
      INSERT INTO auth_rate_limits(key,window_start,attempts)
      VALUES($1,date_trunc('minute',now()),1)
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < date_trunc('minute',now())
                        THEN 1 ELSE auth_rate_limits.attempts+1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < date_trunc('minute',now())
                            THEN date_trunc('minute',now()) ELSE auth_rate_limits.window_start END
      RETURNING attempts
    `,[key])).rows[0]
    if (row.attempts > max) throw new TooManyRequestsException('Too many authentication attempts')
    return true
  }
}
