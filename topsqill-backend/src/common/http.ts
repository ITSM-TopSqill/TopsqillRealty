import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Observable, tap } from "rxjs";

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly log = new Logger("http");
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = process.hrtime.bigint();
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(tap(() => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      try { ctx.switchToHttp().getResponse().header("server-timing", `app;dur=${ms.toFixed(1)}`); } catch {}
      if (ms > 300) this.log.warn(`slow ${req?.method} ${req?.url} took ${ms.toFixed(0)}ms`);
    }));
  }
}

/** One error shape for the whole API, with no internal details leaked. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("error");
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const status = err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = err instanceof HttpException ? err.getResponse() : "Something went wrong. Please try again.";
    if (status >= 500) this.log.error({ err, url: req?.url }, "unhandled error");
    res.status(status).send(typeof body === "string" ? { statusCode: status, message: body } : body);
  }
}
