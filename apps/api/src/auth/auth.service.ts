import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { prisma } from '../prisma/prisma.client';
import { AuditService } from '../audit/audit.service';
import { Role } from './auth.decorators';
import { hashToken, verifyPassword } from './password.util';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(private auditService: AuditService) {}

  private signAccessToken(user: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: Role;
  }) {
    return jwt.sign(
      { sub: user.id, tenantId: user.tenantId, email: user.email, fullName: user.fullName, role: user.role },
      process.env.JWT_ACCESS_SECRET ?? 'local-dev-secret',
      { expiresIn: '15m' }
    );
  }

  private async createRefreshToken(userId: string, tenantId: string): Promise<string> {
    const token = randomBytes(48).toString('hex');
    const hash = hashToken(token);
    await prisma.session.create({
      data: {
        tenantId,
        userId,
        refreshTokenHash: hash,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
      }
    });
    return token;
  }

  async validateUser(tenantId: string, email: string, password: string) {
    const user = await prisma.user.findFirst({ where: { tenantId, email } });
    if (!user) {
      await this.auditService.logAction({
        tenantId,
        actorId: null,
        action: 'LOGIN_FAILED',
        metadata: { reason: 'user_not_found', email }
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.auditService.logAction({
        tenantId,
        actorId: user.id,
        action: 'LOGIN_FAILED',
        metadata: { reason: 'invalid_password', email }
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.auditService.logAction({
      tenantId,
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      metadata: { email }
    });

    return user;
  }

  async buildTokenPair(user: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: Role;
  }): Promise<TokenPair> {
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id, user.tenantId);
    return { accessToken, refreshToken };
  }

  async refreshTokens(refreshToken: string): Promise<{ user: any; tokens: TokenPair }> {
    const hash = hashToken(refreshToken);
    const session = await prisma.session.findFirst({ where: { refreshTokenHash: hash, revokedAt: null } });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await this.auditService.logAction({
          tenantId: session.tenantId,
          actorId: session.userId,
          action: 'REFRESH_DENIED',
          metadata: { reason: 'invalid_refresh' }
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await prisma.user.findFirstOrThrow({
      where: { id: session.userId, tenantId: session.tenantId }
    });

    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    });

    const tokens = await this.buildTokenPair(user);

    await this.auditService.logAction({
      tenantId: session.tenantId,
      actorId: user.id,
      action: 'TOKEN_REFRESHED',
      metadata: { sessionId: session.id }
    });

    return { user, tokens };
  }

  async logout(userId: string, tenantId: string, refreshToken?: string) {
    if (refreshToken) {
      const hash = hashToken(refreshToken);
      await prisma.session.updateMany({
        where: { userId, tenantId, refreshTokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    } else {
      await prisma.session.updateMany({
        where: { userId, tenantId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }

    await this.auditService.logAction({
      tenantId,
      actorId: userId,
      action: 'LOGOUT',
      metadata: { targetedToken: Boolean(refreshToken) }
    });

    return { success: true };
  }
}
