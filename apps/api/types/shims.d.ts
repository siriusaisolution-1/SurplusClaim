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
  export const UPL_DISCLAIMER: typeof import('../../../packages/shared/src/upl').UPL_DISCLAIMER;
  export const UPL_UI_NOTICE: typeof import('../../../packages/shared/src/upl').UPL_UI_NOTICE;
  export const AI_OUTPUT_RULES: typeof import('../../../packages/shared/src/upl').AI_OUTPUT_RULES;
  export { NormalizedCaseSchema } from '../../../packages/shared/src/schemas';
  export type NormalizedCase = import('../../../packages/shared/src/schemas').NormalizedCase;
  export type TemplateDefinition = import('../../../packages/shared/src/communications/templates').TemplateDefinition;
  export { templateRegistry } from '../../../packages/shared/src/communications/templates';
  export { validateCaseRef } from '../../../packages/shared/src/caseRef';
  export { generateCaseRef } from '../../../packages/shared/src/caseRef';
}

declare module '@surplus/connectors' {
  export { ConnectorOrchestrator } from '../../../packages/connectors/src/orchestrator';
  export { ConnectorRegistry } from '../../../packages/connectors/src/registry';
  export { ConnectorStateStore, InMemoryConnectorStateStore, defaultConnectorStateStore } from '../../../packages/connectors/src/state';
}

declare module '@surplus/audit' {
  export { AuditEngine } from '../../../packages/audit/src';
  export type VerificationRange = import('../../../packages/audit/src').VerificationRange;
  export type VerificationResult = import('../../../packages/audit/src').VerificationResult;
}
