from __future__ import annotations

import scrapy

from surplus_scraper.base import BaseSpider


class WatchExampleSpider(BaseSpider):
    name = "watch_example"
    watch_urls = ["https://example.org/watch"]

    def extract_listing_entries(self, response: scrapy.http.Response):
        entries = [text.strip() for text in response.css("li::text").getall() if text.strip()]
        return entries

    def parse_records(self, response):
        normalized_case = {
            "case_ref": "EXAMPLE-001",
            "state": "CA",
            "county_code": "001",
            "source_system": "example_watch",
            "filed_at": "2024-01-01",
            "parties": [
                {"role": "plaintiff", "name": "City"},
                {"role": "defendant", "name": "Resident"},
            ],
            "amounts": [
                {"type": "judgment", "amount": 1250.50},
            ],
            "status": "open",
        }
        yield self.wrap_normalized_case(normalized_case, response)
