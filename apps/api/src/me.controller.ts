import { Controller, Get, NotFoundException } from '@nestjs/common';

import { CurrentUser } from './auth/auth.decorators';
import { UsersService } from './users/users.service';

@Controller()
export class MeController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: any) {
    const profile = await this.usersService.findById(user.sub, user.tenantId);
    if (!profile) {
      throw new NotFoundException('User not found');
    }
    return {
      id: profile.id,
      tenantId: profile.tenantId,
      email: profile.email,
      fullName: profile.fullName,
      role: profile.role
    };
  }
}
