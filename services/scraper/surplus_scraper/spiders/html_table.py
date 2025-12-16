from __future__ import annotations

import re
from typing import Iterable

import scrapy

from surplus_scraper.base import BaseSpider
from surplus_scraper.items import NormalizedCaseResult


class HtmlTableSpider(BaseSpider):
    name = "html_table_overages"
    watch_urls = ["https://data.example.gov/overages/html-table"]
    state = "TX"
    county_code = "TRAVIS"
    source_system = "html_table_overages"

    def extract_listing_entries(self, response: scrapy.http.Response):
        rows = response.css("table#overages tbody tr")
        return [row.css("td::text").get(default="").strip() for row in rows]

    def parse_records(self, response: scrapy.http.Response) -> Iterable[NormalizedCaseResult]:
        for row in response.css("table#overages tbody tr"):
            cells = [cell.strip() for cell in row.css("td::text").getall()]
            if len(cells) < 5:
                continue

            property_id, owner, address, amount_text, sale_date = cells[:5]

            normalized_case = {
                "case_ref": f"HT-{property_id}",
                "state": self.state,
                "county_code": self.county_code,
                "source_system": self.source_system,
                "filed_at": sale_date,
                "sale_date": sale_date,
                "status": "open",
                "property_address": self.parse_address(address),
                "parties": [{"role": "owner", "name": owner}],
                "amounts": [{"type": "surplus", "amount": self.parse_amount(amount_text)}],
                "metadata": {"property_id": property_id, "record_format": "html_table"},
            }

            yield self.wrap_normalized_case(normalized_case, response)

    @staticmethod
    def parse_amount(amount_text: str) -> float:
        cleaned = re.sub(r"[^0-9.]+", "", amount_text)
        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    def parse_address(self, raw: str) -> dict[str, str]:
        # Expected format: "123 Main St, Austin, TX 78701"
        parts = [part.strip() for part in raw.split(",")]
        line1 = parts[0] if parts else raw
        city = parts[1] if len(parts) > 1 else ""
        state_zip = parts[2] if len(parts) > 2 else ""
        state = state_zip.split()[0] if state_zip else self.state
        postal = state_zip.split()[1] if len(state_zip.split()) > 1 else None

        address: dict[str, str] = {
            "line1": line1,
            "city": city,
            "state": state,
            "county_code": self.county_code,
        }
        if postal:
            address["postal_code"] = postal
        return address
