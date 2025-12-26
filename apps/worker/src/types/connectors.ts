/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
export default class ConnectorOrchestrator {
  constructor(..._args: any[]) {}

  async runAllConnectors(): Promise<any> {
    return Promise.resolve();
  }

  getStatuses(): any {
    return {};
  }
}

export { ConnectorOrchestrator };
