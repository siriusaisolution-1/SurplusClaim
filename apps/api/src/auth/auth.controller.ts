import { Body, Controller, Post } from '@nestjs/common';

import { Public, CurrentUser } from './auth.decorators';
import { AuthService } from './auth.service';

interface LoginDto {
  tenantId: string;
  email: string;
  password: string;
}

interface RefreshDto {
  refreshToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @Public()
  async login(@Body() body: LoginDto) {
    const user = await this.authService.validateUser(body.tenantId, body.email, body.password);
    const tokens = await this.authService.buildTokenPair(user);

    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      ...tokens
    };
  }

  @Post('refresh')
  @Public()
  async refresh(@Body() body: RefreshDto) {
    const { user, tokens } = await this.authService.refreshTokens(body.refreshToken);
    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      ...tokens
    };
  }

  @Post('logout')
  async logout(@CurrentUser() user: any, @Body() body: RefreshDto) {
    await this.authService.logout(user.sub, user.tenantId, body?.refreshToken);
    return { success: true };
  }
}
