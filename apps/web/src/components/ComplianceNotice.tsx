import { UPL_DISCLAIMER, UPL_UI_NOTICE } from '@surplus/shared';

export function ComplianceNotice() {
  return (
    <div className="compliance-banner">
      <div className="compliance-title">Compliance guardrails</div>
      <p className="compliance-body">
        {UPL_UI_NOTICE} Automated outputs remain structured, require a human decision maker, and are monitored for UPL risk.
      </p>
      <p className="compliance-disclaimer">{UPL_DISCLAIMER}</p>
    </div>
  );
}
