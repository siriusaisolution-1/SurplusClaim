from __future__ import annotations

import csv
import io
from typing import Iterable, List

import scrapy

from surplus_scraper.base import BaseSpider
from surplus_scraper.items import NormalizedCaseResult


class CsvFeedSpider(BaseSpider):
    name = "csv_feed_overages"
    watch_urls = ["https://data.example.gov/overages/csv-feed"]
    state = "WA"
    county_code = "KING"
    source_system = "csv_feed_overages"

    def extract_listing_entries(self, response: scrapy.http.Response) -> List[str]:
        reader = csv.DictReader(io.StringIO(response.text))
        return [row.get("property_id", "").strip() for row in reader if row.get("property_id")]

    def parse_records(self, response: scrapy.http.Response) -> Iterable[NormalizedCaseResult]:
        reader = csv.DictReader(io.StringIO(response.text))
        for row in reader:
            property_id = row.get("property_id", "").strip()
            sale_date = row.get("sale_date", "").strip()
            owner = row.get("owner", "").strip()
            address = row.get("address", "").strip()
            amount = float(row.get("amount", 0) or 0)
            status = (row.get("status") or "unknown").strip() or "unknown"

            normalized_case = {
                "case_ref": f"CSV-{property_id}",
                "state": self.state,
                "county_code": self.county_code,
                "source_system": self.source_system,
                "filed_at": sale_date,
                "sale_date": sale_date,
                "status": status,
                "property_address": self._parse_address(address),
                "parties": [{"role": "owner", "name": owner}],
                "amounts": [{"type": "surplus", "amount": amount}],
                "metadata": {"property_id": property_id, "record_format": "csv_feed"},
            }

            yield self.wrap_normalized_case(normalized_case, response)

    def _parse_address(self, raw: str) -> dict[str, str]:
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
