// apps/api/types/shims.d.ts
// Purpose: temporary *minimal* type shims ONLY for internal workspace packages
// to avoid blocking API compilation while we harden types incrementally.
//
// IMPORTANT:
// - Do NOT shim external libraries (nestjs/prisma/express/etc).
// - This file must NOT declare module '@nestjs/common' or anything NestJS-related.

declare module '@surplus/rules' {
  export type CaseChecklistContext = unknown;
  export class ChecklistGenerator {
    constructor(...args: any[]);
    generate(...args: any[]): any;
  }
  export class RulesRegistry {
    constructor(...args: any[]);
    listJurisdictions(): any;
    getRule(...args: any[]): any;
  }
}

declare module '@surplus/shared' {
  export const UPL_DISCLAIMER: string;
  export const UPL_UI_NOTICE: string;
  export const AI_OUTPUT_RULES: string;
  export const templateRegistry: any;

  export const NormalizedCaseSchema: any;
  export type NormalizedCase = any;

  export function generateCaseRef(...args: any[]): any;

  export type TemplateDefinition = any;
}

declare module '@surplus/connectors' {
  export class ConnectorOrchestrator {
    constructor(...args: any[]);
    runAllConnectors(...args: any[]): any;
    getStatuses(...args: any[]): any;
  }
  export class ConnectorRegistry {
    constructor(...args: any[]);
  }
  export const defaultConnectorStateStore: any;
}

declare module '@surplus/audit' {
  export class AuditEngine {
    constructor(...args: any[]);
    append(...args: any[]): any;
    verifyChain(...args: any[]): any;
  }
  export interface VerificationRange {
    [key: string]: any;
  }
  export interface VerificationResult {
    [key: string]: any;
  }
}


