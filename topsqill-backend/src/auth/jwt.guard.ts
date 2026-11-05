import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC } from "./public.decorator";

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (token) {
      try {
        const p = await this.jwt.verifyAsync(token);
        req.user = { id: p.sub, type: p.typ, isAdmin: !!p.adm };
      } catch { if (!isPublic) throw new UnauthorizedException("Your session has expired. Please sign in again."); }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException("Please sign in to continue.");
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user?.isAdmin) throw new UnauthorizedException("Admin access only.");
    return true;
  }
}
