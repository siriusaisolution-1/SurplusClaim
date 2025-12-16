from __future__ import annotations

import io
import re
from typing import Iterable, List, Tuple

import pdfplumber
import scrapy

from surplus_scraper.base import BaseSpider
from surplus_scraper.items import NormalizedCaseResult


class PdfListSpider(BaseSpider):
    name = "pdf_list_overages"
    watch_urls = ["https://data.example.gov/overages/pdf-list"]
    state = "FL"
    county_code = "ORANGE"
    source_system = "pdf_list_overages"

    def extract_listing_entries(self, response: scrapy.http.Response) -> List[str]:
        rows, _ = self._parse_pdf_rows(response.body)
        return [row[0] for row in rows]

    def parse_records(self, response: scrapy.http.Response) -> Iterable[NormalizedCaseResult]:
        rows, artifact_key = self._parse_pdf_rows(response.body)
        for property_id, owner, address, sale_date, amount_text in rows:
            normalized_case = {
                "case_ref": f"PDF-{property_id}",
                "state": self.state,
                "county_code": self.county_code,
                "source_system": self.source_system,
                "filed_at": sale_date,
                "sale_date": sale_date,
                "status": "pending",
                "property_address": self._parse_address(address),
                "parties": [{"role": "owner", "name": owner}],
                "amounts": [{"type": "surplus", "amount": self._parse_amount(amount_text)}],
                "metadata": {"property_id": property_id, "record_format": "pdf_list"},
            }
            yield self.wrap_normalized_case(normalized_case, response, artifact_key=artifact_key)

    def _parse_pdf_rows(self, body: bytes) -> Tuple[List[List[str]], str]:
        with pdfplumber.open(io.BytesIO(body)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        content_lines = [line for line in lines if "|" in line and "Property ID" not in line]
        rows: List[List[str]] = []
        for line in content_lines:
            parts = [segment.strip() for segment in line.split("|")]
            if len(parts) < 5:
                continue
            property_id, owner, address, sale_date, amount = parts[:5]
            rows.append([property_id, owner, address, sale_date, amount])
        artifact_key = "pdf_list.pdf"
        return rows, artifact_key

    @staticmethod
    def _parse_amount(amount_text: str) -> float:
        cleaned = re.sub(r"[^0-9.]+", "", amount_text)
        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    def _parse_address(self, raw: str) -> dict[str, str]:
        # "88 Harbor Way, Orlando, FL 32801"
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
