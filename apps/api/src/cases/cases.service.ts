import { Injectable } from '@nestjs/common';

import { prisma } from '../prisma/prisma.client';

@Injectable()
export class CasesService {
  async findByCaseRef(tenantId: string, caseRef: string) {
    return prisma.case.findFirst({
      where: { tenantId, caseRef },
      include: { assignedReviewer: true }
    });
  }
}
