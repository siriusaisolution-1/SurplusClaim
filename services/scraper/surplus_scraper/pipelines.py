from __future__ import annotations

from surplus_scraper.items import NormalizedCaseResult


class NormalizedCaseValidationPipeline:
    def process_item(self, item, spider):  # type: ignore[override]
        result = NormalizedCaseResult.model_validate(item)
        return result.model_dump()
