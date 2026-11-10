import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Post
} from '@nestjs/common'
import { FilesService } from './files.service.js'

@Controller('uploads')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('intent')
  async intent(
    @Headers('x-user-id') userId: string | undefined,
    @Body() body: { filename?: string; contentType?: string; size?: number }
  ) {
    if (!userId) throw new BadRequestException('x-user-id is required')
    if (!body.contentType) throw new BadRequestException('contentType is required')

    try {
      return await this.files.createIntent(userId, body.contentType, body.size)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid upload intent')
    }
  }

  @Post('commit')
  async commit(
    @Headers('x-user-id') userId: string | undefined,
    @Body() body: { id?: string }
  ) {
    if (!userId) throw new BadRequestException('x-user-id is required')
    if (!body.id) throw new BadRequestException('id is required')

    try {
      return await this.files.commit(userId, body.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Commit failed'
      if (/not.?found|NoSuchKey|404/i.test(message)) {
        throw new ConflictException('Object has not been uploaded')
      }
      throw new BadRequestException(message)
    }
  }
}
