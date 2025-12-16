import json
from pathlib import Path

from scrapy.http import Request, TextResponse

from surplus_scraper.base import BaseSpider, Cursor
from surplus_scraper.items import NormalizedCaseResult


class DummyWatchSpider(BaseSpider):
    name = "dummy_watch"
    watch_urls = ["https://example.test/watch"]

    def extract_listing_entries(self, response):
        return [text.strip() for text in response.css("li::text").getall() if text.strip()]

    def parse_records(self, response):
        normalized_case = {
            "case_ref": "ABC-123",
            "state": "TX",
            "county_code": "201",
            "source_system": "dummy",
            "filed_at": "2023-12-31",
            "status": "open",
        }
        yield self.wrap_normalized_case(normalized_case, response)


def build_response(body: bytes, url: str, headers: dict | None = None):
    request = Request(url=url)
    return TextResponse(url=url, body=body, encoding="utf-8", request=request, headers=headers or {})


def test_start_requests_adds_header_state(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = DummyWatchSpider()

    requests = list(spider.start_requests())

    assert len(requests) == 1
    assert requests[0].headers == {}


def test_cursor_saved_and_reused(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = DummyWatchSpider()
    url = spider.watch_urls[0]

    html = Path(__file__).parent / "fixtures" / "listing.html"
    body = html.read_bytes()
    response = build_response(body, url)

    items = list(spider.parse_watch(response, Cursor()))

    assert len(items) == 1
    saved_state = json.loads((tmp_path / spider.name / "cursor.json").read_text())
    assert saved_state[url]["list_fingerprint"]

    # repeat with same fingerprint should yield nothing
    cursor = spider._cursor_state[url]
    response2 = build_response(body, url)
    items_again = list(spider.parse_watch(response2, cursor))
    assert items_again == []


def test_etag_short_circuit(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = DummyWatchSpider()
    url = spider.watch_urls[0]

    body = b"<html><body>unchanged</body></html>"
    first = build_response(body, url, headers={b"ETag": b"abc123"})
    _ = list(spider.parse_watch(first, Cursor()))

    cursor = spider._cursor_state[url]
    assert cursor.etag == "abc123"

    second = build_response(body, url, headers={b"ETag": b"abc123"})
    items = list(spider.parse_watch(second, cursor))
    assert items == []


def test_result_includes_sha(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPER_STATE_DIR", str(tmp_path))
    spider = DummyWatchSpider()
    url = spider.watch_urls[0]
    body = b"<html><body>content</body></html>"
    response = build_response(body, url)

    result = list(spider.parse_watch(response, Cursor()))[0]
    validated = NormalizedCaseResult.model_validate(result)

    assert validated.source.raw_sha256
    assert validated.source.url == url
