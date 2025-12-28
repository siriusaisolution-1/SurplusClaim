declare module '@prisma/client' {
  export const CaseStatus: any;
  export const TierLevel: any;
  export const FeeAgreement: any;
  export const CommunicationChannel: any;
  export const CommunicationDirection: any;
  export type CaseStatus = any;
  export type TierLevel = any;
  export type FeeAgreement = any;
  export type CommunicationChannel = any;
  export type CommunicationDirection = any;
  export type AuditLog = any;
  export namespace Prisma {
    export type TransactionClient = any;
  }
  export class PrismaClient {
    constructor(...args: any[]);
    [key: string]: any;
  }
  const prisma: any;
  export default prisma;
}

declare module '@surplus/rules' {
  export interface CaseChecklistContext {
    state: string;
    county_code: string;
    case_ref?: string;
  }
  export class ChecklistGenerator {
    constructor(...args: any[]);
    generate(...args: any[]): any;
  }
  export class RulesRegistry {
    constructor(...args: any[]);
    listJurisdictions(): any;
    getRule(...args: any[]): any;
  }
  export class ConnectorRegistry {
    constructor(...args: any[]);
  }
  export const defaultConnectorStateStore: any;
}

declare module '@surplus/shared' {
  export const UPL_DISCLAIMER: any;
  export const UPL_UI_NOTICE: any;
  export const AI_OUTPUT_RULES: any;
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

declare module '@nestjs/common' {
  export const Module: any;
  export const Controller: any;
  export const Get: any;
  export const Post: any;
  export const Param: any;
  export const Body: any;
  export const Query: any;
  export const Res: any;
  export const StreamableFile: any;
  export const Injectable: any;
  export const NotFoundException: any;
  export const UnauthorizedException: any;
  export const ForbiddenException: any;
  export const BadRequestException: any;
  export const TooManyRequestsException: any;
  export const UseGuards: any;
  export const UseInterceptors: any;
  export const UploadedFile: any;
  export const UploadedFiles: any;
  export const ExecutionContext: any;
  export const CallHandler: any;
  export const NestInterceptor: any;
  export const Logger: any;
  export const LoggerService: any;
  export const HttpStatus: any;
  export const HttpException: any;
  export const SetMetadata: any;
  export const createParamDecorator: any;
  export type CanActivate = any;
  export type ExecutionContext = any;
  export type CallHandler = any;
  export type NestInterceptor = any;
  export type LoggerService = any;
}

declare module '@nestjs/testing' {
  export const Test: any;
  export type TestingModule = any;
}

declare module 'multer' {
  export type FileFilterCallback = (...args: any[]) => any;
  const multer: any;
  export = multer;
}

declare module 'express' {
  export interface Request extends Record<string, any> {}
  export interface Response extends Record<string, any> {}
  export interface NextFunction {
    (...args: any[]): any;
  }
}

declare module '*';
