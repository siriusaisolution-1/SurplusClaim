from __future__ import annotations

from pathlib import Path

from scrapy.http import Request, Response, TextResponse

from surplus_scraper.base import Cursor
from surplus_scraper.items import NormalizedCaseResult
from surplus_scraper.spiders.csv_feed import CsvFeedSpider
from surplus_scraper.spiders.html_table import HtmlTableSpider
from surplus_scraper.spiders.pdf_list import PdfListSpider


def build_text_response(path: Path, url: str) -> TextResponse:
    body = path.read_bytes()
    request = Request(url=url)
    return TextResponse(url=url, body=body, encoding="utf-8", request=request)


def build_binary_response(path: Path, url: str) -> Response:
    body = path.read_bytes()
    request = Request(url=url)
    return Response(url=url, body=body, request=request)


def normalize_results(items):
    normalized_cases = []
    for item in items:
        validated = NormalizedCaseResult.model_validate(item)
        normalized_cases.append(validated.normalized_case)
    return normalized_cases


def test_html_table_spider_produces_normalized_output(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = HtmlTableSpider()
    url = spider.watch_urls[0]
    fixture = Path(__file__).parent / "fixtures" / "html_table.html"

    response = build_text_response(fixture, url)
    items = list(spider.parse_watch(response, Cursor()))

    expected = [
        {
            "case_ref": "HT-R1001",
            "state": "TX",
            "county_code": "TRAVIS",
            "source_system": "html_table_overages",
            "filed_at": "2024-03-01",
            "sale_date": "2024-03-01",
            "status": "open",
            "property_address": {
                "line1": "123 Main St",
                "city": "Austin",
                "state": "TX",
                "county_code": "TRAVIS",
                "postal_code": "78701",
            },
            "parties": [{"role": "owner", "name": "Jane Doe"}],
            "amounts": [{"type": "surplus", "amount": 1250.75, "currency": "USD"}],
            "metadata": {"property_id": "R1001", "record_format": "html_table"},
        },
        {
            "case_ref": "HT-R1002",
            "state": "TX",
            "county_code": "TRAVIS",
            "source_system": "html_table_overages",
            "filed_at": "2024-03-05",
            "sale_date": "2024-03-05",
            "status": "open",
            "property_address": {
                "line1": "42 Pine Rd",
                "city": "Austin",
                "state": "TX",
                "county_code": "TRAVIS",
                "postal_code": "78702",
            },
            "parties": [{"role": "owner", "name": "Sam Taylor"}],
            "amounts": [{"type": "surplus", "amount": 3500.0, "currency": "USD"}],
            "metadata": {"property_id": "R1002", "record_format": "html_table"},
        },
    ]

    assert normalize_results(items) == expected

    cursor = spider._cursor_state[url]
    repeat_items = list(spider.parse_watch(build_text_response(fixture, url), cursor))
    assert repeat_items == []


def test_pdf_list_spider_reads_pdf(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = PdfListSpider()
    url = spider.watch_urls[0]
    fixture = Path(__file__).parent / "fixtures" / "pdf_list.pdf"

    response = build_binary_response(fixture, url)
    items = list(spider.parse_watch(response, Cursor()))

    expected = [
        {
            "case_ref": "PDF-P5001",
            "state": "FL",
            "county_code": "ORANGE",
            "source_system": "pdf_list_overages",
            "filed_at": "2024-01-15",
            "sale_date": "2024-01-15",
            "status": "pending",
            "property_address": {
                "line1": "88 Harbor Way",
                "city": "Orlando",
                "state": "FL",
                "county_code": "ORANGE",
                "postal_code": "32801",
            },
            "parties": [{"role": "owner", "name": "Allison Gray"}],
            "amounts": [{"type": "surplus", "amount": 4100.0, "currency": "USD"}],
            "metadata": {"property_id": "P5001", "record_format": "pdf_list"},
        },
        {
            "case_ref": "PDF-P5002",
            "state": "FL",
            "county_code": "ORANGE",
            "source_system": "pdf_list_overages",
            "filed_at": "2024-01-20",
            "sale_date": "2024-01-20",
            "status": "pending",
            "property_address": {
                "line1": "12 Citrus Ave",
                "city": "Orlando",
                "state": "FL",
                "county_code": "ORANGE",
                "postal_code": "32803",
            },
            "parties": [{"role": "owner", "name": "Jordan Miles"}],
            "amounts": [{"type": "surplus", "amount": 2875.5, "currency": "USD"}],
            "metadata": {"property_id": "P5002", "record_format": "pdf_list"},
        },
    ]

    assert normalize_results(items) == expected

    cursor = spider._cursor_state[url]
    repeat_items = list(spider.parse_watch(build_binary_response(fixture, url), cursor))
    assert repeat_items == []


def test_csv_feed_spider_parses_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = CsvFeedSpider()
    url = spider.watch_urls[0]
    fixture = Path(__file__).parent / "fixtures" / "csv_feed.csv"

    response = build_text_response(fixture, url)
    items = list(spider.parse_watch(response, Cursor()))

    expected = [
        {
            "case_ref": "CSV-C9001",
            "state": "WA",
            "county_code": "KING",
            "source_system": "csv_feed_overages",
            "filed_at": "2024-02-10",
            "sale_date": "2024-02-10",
            "status": "open",
            "property_address": {
                "line1": "101 Oak St",
                "city": "Seattle",
                "state": "WA",
                "county_code": "KING",
                "postal_code": "98101",
            },
            "parties": [{"role": "owner", "name": "Amanda West"}],
            "amounts": [{"type": "surplus", "amount": 2200.0, "currency": "USD"}],
            "metadata": {"property_id": "C9001", "record_format": "csv_feed"},
        },
        {
            "case_ref": "CSV-C9002",
            "state": "WA",
            "county_code": "KING",
            "source_system": "csv_feed_overages",
            "filed_at": "2024-02-18",
            "sale_date": "2024-02-18",
            "status": "closed",
            "property_address": {
                "line1": "55 Lake View Dr",
                "city": "Seattle",
                "state": "WA",
                "county_code": "KING",
                "postal_code": "98102",
            },
            "parties": [{"role": "owner", "name": "Michael Green"}],
            "amounts": [{"type": "surplus", "amount": 1575.25, "currency": "USD"}],
            "metadata": {"property_id": "C9002", "record_format": "csv_feed"},
        },
    ]

    assert normalize_results(items) == expected

    cursor = spider._cursor_state[url]
    repeat_items = list(spider.parse_watch(build_text_response(fixture, url), cursor))
    assert repeat_items == []
