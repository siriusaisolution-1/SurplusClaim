import { Injectable } from '@nestjs/common';
import { ConnectorRegistry } from '@surplus/connectors';

import { prisma } from '../prisma/prisma.client';

type ConnectorStats = {
  extracted?: number;
  created?: number;
  failures?: number;
  jobId?: string;
  caseRefs?: string[];
};

@Injectable()
export class ConnectorsService {
  private readonly registry = new ConnectorRegistry();

  async getStatus(tenantId: string) {
    const connectors = this.registry.list();

    const statuses = await Promise.all(
      connectors.map(async (connector) => {
        const [latestRun, latestCursor] = await Promise.all([
          prisma.connectorRun.findFirst({
            where: {
              tenantId,
              connectorId: connector.spiderName,
              state: connector.key.state,
              countyCode: connector.key.county_code
            },
            orderBy: { createdAt: 'desc' }
          }),
          prisma.connectorCursor.findFirst({
            where: {
              tenantId,
              connectorId: connector.spiderName,
              state: connector.key.state,
              countyCode: connector.key.county_code
            }
          })
        ]);

        const stats = (latestRun?.stats ?? {}) as ConnectorStats;

        return {
          state: connector.key.state,
          county_code: connector.key.county_code,
          spider: connector.spiderName,
          watch_urls: connector.watchUrls,
          schedule_interval: connector.scheduleInterval,
          parsing_mode: connector.parsingMode,
          last_run: latestRun?.startedAt ?? null,
          last_cursor: latestCursor?.cursor ?? null,
          extracted: stats.extracted ?? 0,
          created: stats.created ?? 0,
          failures: stats.failures ?? 0,
          last_error: latestRun?.errorMessage ?? null
        };
      })
    );

    return statuses;
  }

  async listRuns(
    tenantId: string,
    options?: { connectorId?: string; caseRef?: string; limit?: number }
  ) {
    const runs = await prisma.connectorRun.findMany({
      where: {
        tenantId,
        connectorId: options?.connectorId
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 20
    });

    const filtered = options?.caseRef
      ? runs.filter((run) => {
          const stats = (run.stats ?? {}) as ConnectorStats;
          return Array.isArray(stats.caseRefs) && stats.caseRefs.includes(options.caseRef as string);
        })
      : runs;

    return filtered.map((run) => {
      const stats = (run.stats ?? {}) as ConnectorStats;
      const response: Record<string, unknown> = {
        id: run.id,
        connector_id: run.connectorId,
        jurisdiction: {
          state: run.state,
          county_code: run.countyCode
        },
        status: run.status,
        attempt_count: run.attemptCount,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        error_message: run.errorMessage,
        cursor: run.cursor,
        stats
      };
      if (options?.caseRef) {
        response.case_ref = options.caseRef;
      }
      return response;
    });
  }
}
