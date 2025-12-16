import { ConnectorScrapedItem } from './types';

interface ScheduleResponse {
  status: 'ok' | 'error';
  jobid?: string;
  message?: string;
}

export class ScrapydClient {
  constructor(private readonly baseUrl: string, private readonly project = 'default') {}

  async scheduleSpider(spider: string, settings: Record<string, unknown> = {}): Promise<string> {
    const form = new URLSearchParams({ project: this.project, spider });

    Object.entries(settings).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    });

    const response = await fetch(`${this.baseUrl}/schedule.json`, {
      method: 'POST',
      body: form
    });

    const data = (await response.json()) as ScheduleResponse;
    if (data.status !== 'ok' || !data.jobid) {
      throw new Error(`Failed to schedule spider ${spider}: ${data.message ?? 'unknown error'}`);
    }

    return data.jobid;
  }

  async fetchItems(jobId: string): Promise<ConnectorScrapedItem[]> {
    try {
      const response = await fetch(`${this.baseUrl}/items/${this.project}/${jobId}.json`);
      if (!response.ok) return [];
      return ((await response.json()) ?? []) as ConnectorScrapedItem[];
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Unable to fetch items for job ${jobId}: ${error.message}`);
      }
      throw error;
    }
  }
}
