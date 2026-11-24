import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()
    const raw = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const status = raw >= 400 && raw <= 599 ? raw : 500
    const names: Record<number,string> = {
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity',
      429: 'Too Many Requests', 500: 'Internal Server Error'
    }
    const title = names[status] ?? 'HTTP Error'
    const detail = exception instanceof HttpException
      ? (typeof exception.getResponse() === 'string'
        ? exception.getResponse() as string
        : exception.message)
      : 'Internal server error'
    response.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title,
      status,
      detail,
      instance: request.originalUrl ?? request.url
    })
  }
}
