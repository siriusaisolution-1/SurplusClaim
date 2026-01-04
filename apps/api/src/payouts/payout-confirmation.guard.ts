import { BadRequestException } from '@nestjs/common';
import { LegalExecutionMode } from '@prisma/client';

type PayoutEvidence = {
  evidenceKey?: string | null;
  evidenceSha256?: string | null;
  artifactId?: string | null;
};

export function assertPayoutConfirmable(params: {
  legalExecutionMode?: LegalExecutionMode | null;
  assignedAttorneyId?: string | null;
  evidence?: PayoutEvidence | null;
}) {
  const { legalExecutionMode, assignedAttorneyId, evidence } = params;

  if (!legalExecutionMode) {
    throw new BadRequestException('Legal execution metadata must be set before payout confirmation');
  }

  if (legalExecutionMode === LegalExecutionMode.ATTORNEY_REQUIRED && !assignedAttorneyId) {
    throw new BadRequestException('Attorney assignment required before payout confirmation');
  }

  const hasEvidence = Boolean(evidence?.artifactId || evidence?.evidenceKey || evidence?.evidenceSha256);

  if (!hasEvidence) {
    throw new BadRequestException('Trust disbursement evidence required before payout confirmation');
  }
}
