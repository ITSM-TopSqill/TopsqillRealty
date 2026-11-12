import { SetMetadata, createParamDecorator, ExecutionContext } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";
/** Marks an endpoint as open to anyone (no token needed). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthUser = { id: string; type: string; isAdmin: boolean; demo?: boolean };
/** Injects the signed-in user into a controller method. */
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);
