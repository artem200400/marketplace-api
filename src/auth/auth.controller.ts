import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import type { AuthenticatedRequest } from './auth.service.js'
import { AuthService, AccessGuard } from './auth.service.js'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth:AuthService) {}
  @Post('register')
  async register(@Body() body:{email:string;password:string}) {
    return this.auth.register(body?.email,body?.password)
  }
  @Post('login')
  @HttpCode(200)
  async login(@Body() body:{email:string;password:string}) {
    return this.auth.login(body?.email,body?.password)
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body:{refresh_token:string}) {
    return this.auth.refresh(body?.refresh_token)
  }
  @Post('logout')
  @HttpCode(200)
  @UseGuards(AccessGuard)
  async logout(@Req() req:AuthenticatedRequest) {
    return this.auth.logout(req.principal!)
  }
}
