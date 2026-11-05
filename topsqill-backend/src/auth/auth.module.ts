import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { env } from "../common/env";

@Module({
  imports: [JwtModule.register({ secret: env.JWT_SECRET, signOptions: { issuer: "topsqill.ai" } })],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
