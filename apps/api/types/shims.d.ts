// Ambient module declarations for internal workspace packages referenced by the API.
// These mirror the actual package exports to preserve type safety without overriding
// external dependencies.

declare module '@surplus/rules' {
  export type CaseChecklistContext = import('../../../packages/rules/src/checklist').CaseChecklistContext;
  export type ChecklistItem = import('../../../packages/rules/src/schemas').ChecklistItem;
  export { CaseChecklistContextSchema, ChecklistGenerator } from '../../../packages/rules/src/checklist';
  export { RulesRegistry } from '../../../packages/rules/src/loader';
}

declare module '@surplus/shared' {
  export { UPL_DISCLAIMER, UPL_UI_NOTICE, AI_OUTPUT_RULES } from '../../../packages/shared/src/upl';
  export { NormalizedCaseSchema } from '../../../packages/shared/src/schemas';
  export type NormalizedCase = import('../../../packages/shared/src/schemas').NormalizedCase;
  export type TemplateDefinition = import('../../../packages/shared/src/communications/templates').TemplateDefinition;
  export { templateRegistry } from '../../../packages/shared/src/communications/templates';
  export { generateCaseRef } from '../../../packages/shared/src/caseRef';
}

declare module '@surplus/connectors' {
  export { ConnectorOrchestrator } from '../../../packages/connectors/src/orchestrator';
  export { ConnectorRegistry } from '../../../packages/connectors/src/registry';
  export { defaultConnectorStateStore } from '../../../packages/connectors/src/state';
}

declare module '@surplus/audit' {
  export { AuditEngine } from '../../../packages/audit/src';
  export type VerificationRange = import('../../../packages/audit/src').VerificationRange;
  export type VerificationResult = import('../../../packages/audit/src').VerificationResult;
}
