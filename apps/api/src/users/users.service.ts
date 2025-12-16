import { Injectable } from '@nestjs/common';

import { prisma } from '../prisma/prisma.client';
import { hashPasswordForStorage } from '../auth/password.util';

@Injectable()
export class UsersService {
  async findById(id: string, tenantId: string) {
    return prisma.user.findFirst({ where: { id, tenantId } });
  }

  async createUser(params: {
    tenantId: string;
    email: string;
    fullName: string;
    role: string;
    password: string;
  }) {
    return prisma.user.create({
      data: {
        tenantId: params.tenantId,
        email: params.email,
        fullName: params.fullName,
        role: params.role as any,
        passwordHash: hashPasswordForStorage(params.password)
      }
    });
  }
}
