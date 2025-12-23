import { createHash } from 'node:crypto';

import { NormalizedCase, NormalizedCaseSchema, generateCaseRef } from '@surplus/shared';

import { CaseBuilderInput, ConnectorStateStore, IngestionResult } from './state';
import { ConnectorConfig, ConnectorScrapedItem } from './types';

export class SchemaValidationError extends Error {
  constructor(public readonly issues: unknown) {
    super('Normalized case validation failed');
    this.name = 'SchemaValidationError';
  }
}

function asDateString(value?: string): string {
  if (!value) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${`${now.getUTCMonth() + 1}`.padStart(2, '0')}-${`${now.getUTCDate()}`.padStart(2, '0')}`;
  }
  return value;
}

export class CaseIngestionService {
  constructor(private readonly store: ConnectorStateStore) {}

  private computeSha(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex');
  }

  private dedupeKey(item: ConnectorScrapedItem, rawSha: string): string {
    return `${item.state.toUpperCase()}-${item.county_code.toUpperCase()}-${item.property_id}-${
      item.sale_date ?? 'UNKNOWN'
    }-${rawSha}`;
  }

  private buildNormalizedCase(connector: ConnectorConfig, item: ConnectorScrapedItem): NormalizedCase {
    const normalizedInput = item.normalized ?? {};
    const caseRef =
      normalizedInput.case_ref ??
      generateCaseRef({
        state: item.state,
        countycode: item.county_code,
        date: item.sale_date ?? new Date()
      });

    const filedAt = normalizedInput.filed_at ?? asDateString(item.sale_date);

    const base = {
      case_ref: caseRef,
      state: item.state,
      county_code: item.county_code,
      source_system: normalizedInput.source_system ?? connector.spiderName,
      filed_at: filedAt,
      sale_date: normalizedInput.sale_date ?? item.sale_date,
      property_address: normalizedInput.property_address,
      parties: normalizedInput.parties,
      amounts: normalizedInput.amounts,
      status: normalizedInput.status,
      metadata: {
        ...(normalizedInput.metadata ?? {}),
        property_id: item.property_id
      },
      raw: item.raw
    };

    const validated = NormalizedCaseSchema.safeParse(base);
    if (!validated.success) {
      throw new SchemaValidationError(validated.error.issues);
    }

    return validated.data;
  }

  private buildCaseRecord(input: CaseBuilderInput) {
    return {
      caseRef: input.caseRef,
      normalized: input.normalized,
      dedupeKey: `${input.connector.state}-${input.connector.county_code}-${input.propertyId}-${
        input.saleDate ?? 'UNKNOWN'
      }-${input.rawSha256}`,
      connector: input.connector,
      propertyId: input.propertyId,
      saleDate: input.saleDate,
      rawSha256: input.rawSha256
    };
  }

  ingestBatch(connector: ConnectorConfig, items: ConnectorScrapedItem[]): IngestionResult {
    const result: IngestionResult = { created: [], skipped: [], failures: [] };

    for (const item of items) {
      const rawSha = item.raw_sha256 ?? this.computeSha(item.raw);
      const dedupeKey = this.dedupeKey(item, rawSha);
      const existing = this.store.findCase(dedupeKey);

      if (existing) {
        result.skipped.push(existing);
        result.cursor = item.cursor ?? result.cursor ?? null;
        continue;
      }

      const normalized = this.buildNormalizedCase(connector, item);
      const record = this.buildCaseRecord({
        caseRef: normalized.case_ref,
        normalized,
        rawSha256: rawSha,
        propertyId: item.property_id,
        saleDate: normalized.sale_date,
        connector: connector.key
      });

      this.store.rememberCase(record);
      result.created.push(record);
      result.cursor = item.cursor ?? result.cursor ?? null;
    }

    return result;
  }
}
