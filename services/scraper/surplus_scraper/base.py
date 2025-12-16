from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional

import scrapy
from scrapy.http import Request, Response

from surplus_scraper.items import NormalizedCaseResult, SourceMetadata


@dataclass
class Cursor:
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    list_fingerprint: Optional[str] = None
    artifact_sha256: Optional[str] = None

    def as_headers(self) -> dict:
        headers: dict[str, str] = {}
        if self.etag:
            headers["If-None-Match"] = self.etag
        if self.last_modified:
            headers["If-Modified-Since"] = self.last_modified
        return headers

    def matches(self, other: "Cursor") -> bool:
        comparable_fields = [
            ("etag", self.etag, other.etag),
            ("last_modified", self.last_modified, other.last_modified),
            ("list_fingerprint", self.list_fingerprint, other.list_fingerprint),
            ("artifact_sha256", self.artifact_sha256, other.artifact_sha256),
        ]
        for _, current, previous in comparable_fields:
            if current and previous:
                if current == previous:
                    return True
                return False
        return False


class BaseSpider(scrapy.Spider):
    watch_urls: List[str] = []
    state_dir_env = "SCRAPER_STATE_DIR"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        state_root = Path(os.environ.get(self.state_dir_env, Path(__file__).parent / ".state"))
        self.state_dir = state_root / self.name
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.state_dir / "cursor.json"
        self._cursor_state: dict[str, Cursor] = self._load_state()

    # --- state helpers
    def _load_state(self) -> dict[str, Cursor]:
        if not self.state_path.exists():
            return {}
        try:
            payload = json.loads(self.state_path.read_text())
            return {url: Cursor(**data) for url, data in payload.items()}
        except json.JSONDecodeError:
            return {}

    def _save_state(self) -> None:
        serializable = {url: asdict(cursor) for url, cursor in self._cursor_state.items()}
        self.state_path.write_text(json.dumps(serializable, indent=2))

    # --- request helpers
    def start_requests(self) -> Iterable[Request]:  # type: ignore[override]
        if self.watch_urls:
            for url in self.watch_urls:
                cursor = self._cursor_state.get(url, Cursor())
                headers = cursor.as_headers()
                yield scrapy.Request(url=url, callback=self.parse_watch, headers=headers, cb_kwargs={"cursor": cursor})
        else:
            yield from super().start_requests()

    def parse_watch(self, response: Response, cursor: Cursor) -> Iterable[NormalizedCaseResult]:
        if response.status == 304:
            self.logger.info("No change for %s (304)", response.url)
            return []

        next_cursor = self._build_cursor(response)
        previous_cursor = cursor

        if previous_cursor and next_cursor.matches(previous_cursor):
            self.logger.info("No change detected for %s using cursor", response.url)
            return []

        results = list(self.parse_records(response))
        self._cursor_state[response.url] = next_cursor
        self._save_state()
        return results

    def parse_records(self, response: Response) -> Iterable[NormalizedCaseResult]:
        raise NotImplementedError("parse_records must be implemented by subclasses")

    # --- cursor utilities
    def _build_cursor(self, response: Response) -> Cursor:
        etag = self._decode_header(response, b"ETag")
        last_modified = self._decode_header(response, b"Last-Modified")
        if etag or last_modified:
            return Cursor(etag=etag, last_modified=last_modified)

        listing_fingerprint = self.fingerprint_listing(response)
        if listing_fingerprint:
            return Cursor(list_fingerprint=listing_fingerprint)

        artifact_sha = hashlib.sha256(response.body).hexdigest()
        return Cursor(artifact_sha256=artifact_sha)

    @staticmethod
    def _decode_header(response: Response, header: bytes) -> Optional[str]:
        value = response.headers.get(header)
        if value:
            try:
                return value.decode()
            except Exception:  # pragma: no cover - defensive
                return str(value)
        return None

    def fingerprint_listing(self, response: Response) -> Optional[str]:
        entries = self.extract_listing_entries(response)
        if not entries:
            return None
        payload = json.dumps(entries, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()

    def extract_listing_entries(self, response: Response) -> List[str]:
        return []

    # --- item helpers
    def build_source_metadata(self, response: Response, artifact_key: str | None = None) -> SourceMetadata:
        fetched_at = datetime.now(timezone.utc).isoformat()
        sha_value = hashlib.sha256(response.body).hexdigest()
        return SourceMetadata(url=response.url, fetched_at=fetched_at, raw_sha256=sha_value, artifact_key=artifact_key)

    def wrap_normalized_case(self, normalized_case: dict, response: Response, artifact_key: str | None = None) -> NormalizedCaseResult:
        source = self.build_source_metadata(response, artifact_key)
        return NormalizedCaseResult(normalized_case=normalized_case, source=source)

    def sleep_between_requests(self, seconds: float) -> None:
        time.sleep(seconds)
