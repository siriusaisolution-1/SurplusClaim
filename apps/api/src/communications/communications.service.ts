import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { templateRegistry, TemplateDefinition } from '@surplus/shared';
import { CommunicationChannel as PrismaChannel, CommunicationDirection, TierLevel } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { prisma } from '../prisma/prisma.client';

type PlanInput = {
  templateId: string;
  variables: Record<string, string>;
  sendAt?: string | Date;
};

type SendInput = PlanInput & {
  autoSend?: boolean;
};

@Injectable()
export class CommunicationsService {
  constructor(private auditService: AuditService) {}

  listTemplates() {
    return templateRegistry.list().map((tpl) => ({
      id: tpl.id,
      version: tpl.version,
      name: tpl.name,
      description: tpl.description,
      channel: tpl.channel,
      riskLevel: tpl.riskLevel,
      variables: Object.entries(tpl.variables).map(([key, rule]) => ({
        name: key,
        required: Boolean(rule.required),
        maxLength: rule.maxLength ?? null
      }))
    }));
  }

  async planCommunication(tenantId: string, caseRef: string, input: PlanInput) {
    const context = await this.loadCaseContext(tenantId, caseRef);
    const template = this.getTemplate(input.templateId);
    const plan = this.buildPlan(template, caseRef, input.variables, input.sendAt);
    const preview = templateRegistry.render(plan.templateId, plan.variables, plan.templateVersion);

    return {
      plan,
      preview,
      riskLevel: template.riskLevel,
      tier: context.tier
    };
  }

  async sendCommunication(tenantId: string, actorId: string, caseRef: string, input: SendInput) {
    const context = await this.loadCaseContext(tenantId, caseRef);
    const template = this.getTemplate(input.templateId);
    const plan = this.buildPlan(template, caseRef, input.variables, input.sendAt);
    const preview = templateRegistry.render(plan.templateId, plan.variables, plan.templateVersion);

    const autoSendAllowed = this.isAutoSendAllowed(context.tier, template);
    if (input.autoSend && !autoSendAllowed) {
      throw new BadRequestException('Auto-send is only allowed for Tier A cases with low-risk templates');
    }

    const record = await prisma.communication.create({
      data: {
        tenantId,
        caseId: context.caseId,
        caseRef,
        templateId: template.id,
        templateVersion: template.version,
        recipient: plan.variables.recipient_email,
        variables: plan.variables,
        subject: preview.subject,
        body: preview.body,
        direction: CommunicationDirection.OUTBOUND,
        channel: PrismaChannel.EMAIL,
        status: input.autoSend ? 'pending_auto' : 'pending',
        sendAt: plan.sendAt
      }
    });

    await this.auditService.logAction({
      tenantId,
      actorId,
      caseRef,
      caseId: context.caseId,
      action: 'COMMUNICATION_SCHEDULED',
      metadata: {
        templateId: template.id,
        templateVersion: template.version,
        autoSend: Boolean(input.autoSend),
        sendAt: plan.sendAt,
        recipient: plan.variables.recipient_email
      }
    });

    return { record, preview, autoSendAllowed };
  }

  async listCaseCommunications(tenantId: string, caseRef: string) {
    await this.loadCaseContext(tenantId, caseRef);
    const history = await prisma.communication.findMany({
      where: { tenantId, caseRef },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return history;
  }

  private buildPlan(
    template: TemplateDefinition,
    caseRef: string,
    variables: Record<string, string>,
    sendAt?: string | Date
  ) {
    const mergedVariables = { ...variables, case_ref: caseRef };
    const parsedSendAt = sendAt ? new Date(sendAt) : undefined;
    if (parsedSendAt && Number.isNaN(parsedSendAt.getTime())) {
      throw new BadRequestException('Invalid sendAt timestamp');
    }
    return templateRegistry.planEmail(template.id, mergedVariables, parsedSendAt, template.version);
  }

  private getTemplate(id: string): TemplateDefinition {
    try {
      return templateRegistry.get(id);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private async loadCaseContext(tenantId: string, caseRef: string) {
    const record = await prisma.case.findFirst({
      where: { tenantId, caseRef },
      select: {
        id: true,
        tierConfirmed: true,
        tierSuggested: true
      }
    });

    if (!record) {
      throw new NotFoundException('Case not found');
    }

    const tier = (record as any).tierConfirmed ?? (record as any).tierSuggested ?? TierLevel.LOW;
    return { caseId: (record as any).id, tier };
  }

  private isAutoSendAllowed(tier: TierLevel, template: TemplateDefinition) {
    return tier === TierLevel.LOW && template.riskLevel === 'LOW';
  }
}
