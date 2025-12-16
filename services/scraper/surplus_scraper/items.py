from __future__ import annotations

import datetime as dt
import hashlib
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlparse

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STATUS_VALUES = {"open", "pending", "closed", "unknown"}
ROLE_VALUES = {"plaintiff", "defendant", "owner", "other"}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _validate_date(value: str, field: str) -> None:
    _require(bool(DATE_PATTERN.match(value)), f"{field} must be YYYY-MM-DD")


def _validate_parties(parties: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    validated: List[Dict[str, Any]] = []
    for party in parties:
        _require(isinstance(party, dict), "party entries must be objects")
        role = party.get("role")
        name = party.get("name")
        _require(role in ROLE_VALUES, "party role is invalid")
        _require(isinstance(name, str) and name, "party name is required")
        contact = party.get("contact")
        entry = {"role": role, "name": name}
        if contact is not None:
            entry["contact"] = contact
        validated.append(entry)
    return validated


def _validate_amounts(amounts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    validated: List[Dict[str, Any]] = []
    for amount in amounts:
        _require(isinstance(amount, dict), "amount entries must be objects")
        currency = amount.get("currency", "USD")
        _require(isinstance(currency, str) and len(currency) == 3, "currency must be 3 characters")
        value = amount.get("amount")
        _require(isinstance(value, (int, float)) and value >= 0, "amount must be non-negative number")
        entry = {
            "type": amount.get("type"),
            "amount": float(value),
            "currency": currency,
        }
        _require(isinstance(entry["type"], str) and entry["type"], "amount type is required")
        validated.append(entry)
    return validated


def _validate_address(address: Dict[str, Any]) -> Dict[str, Any]:
    required = ["line1", "city", "state", "county_code"]
    for field in required:
        _require(address.get(field), f"address.{field} is required")
    state = address.get("state")
    _require(isinstance(state, str) and len(state) == 2, "address.state must be 2 characters")
    county_code = address.get("county_code")
    _require(isinstance(county_code, str) and 2 <= len(county_code) <= 12, "address.county_code invalid")
    postal_code = address.get("postal_code")
    if postal_code is not None:
        _require(
            isinstance(postal_code, str) and re.match(r"^\d{5}(?:-\d{4})?$", postal_code),
            "address.postal_code invalid",
        )
    sanitized = {
        "line1": address["line1"],
        "city": address["city"],
        "state": state,
        "county_code": county_code,
    }
    if address.get("line2"):
        sanitized["line2"] = address["line2"]
    if postal_code:
        sanitized["postal_code"] = postal_code
    return sanitized


def validate_normalized_case(payload: Dict[str, Any]) -> Dict[str, Any]:
    _require(isinstance(payload.get("case_ref"), str) and payload["case_ref"].strip(), "case_ref is required")
    _require(isinstance(payload.get("state"), str) and len(payload["state"]) == 2, "state must be 2 characters")
    county_code = payload.get("county_code")
    _require(isinstance(county_code, str) and 2 <= len(county_code) <= 12, "county_code invalid")
    _require(isinstance(payload.get("source_system"), str) and payload["source_system"], "source_system is required")

    filed_at = payload.get("filed_at")
    _require(isinstance(filed_at, str), "filed_at is required")
    _validate_date(filed_at, "filed_at")

    sale_date = payload.get("sale_date")
    if sale_date is not None:
        _require(isinstance(sale_date, str), "sale_date must be a string")
        _validate_date(sale_date, "sale_date")

    status = payload.get("status", "unknown")
    _require(status in STATUS_VALUES, "status invalid")

    parties = payload.get("parties") or []
    amounts = payload.get("amounts") or []
    metadata = payload.get("metadata")
    raw = payload.get("raw")
    property_address = payload.get("property_address")

    result: Dict[str, Any] = {
        "case_ref": payload["case_ref"],
        "state": payload["state"],
        "county_code": county_code,
        "source_system": payload["source_system"],
        "filed_at": filed_at,
        "status": status,
        "parties": _validate_parties(parties),
        "amounts": _validate_amounts(amounts),
    }

    if property_address is not None:
        _require(isinstance(property_address, dict), "property_address must be object")
        result["property_address"] = _validate_address(property_address)

    if sale_date is not None:
        result["sale_date"] = sale_date
    if metadata is not None:
        result["metadata"] = metadata
    if raw is not None:
        result["raw"] = raw

    return result


@dataclass
class SourceMetadata:
    url: str
    fetched_at: str
    raw_sha256: str
    artifact_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "url": self.url,
            "fetched_at": self.fetched_at,
            "raw_sha256": self.raw_sha256,
        }
        if self.artifact_key is not None:
            data["artifact_key"] = self.artifact_key
        return data


def validate_source(payload: Union[Dict[str, Any], SourceMetadata]) -> Dict[str, Any]:
    if isinstance(payload, SourceMetadata):
        payload = payload.to_dict()

    url = payload.get("url")
    _require(isinstance(url, str) and urlparse(url).scheme in {"http", "https"}, "url is invalid")
    fetched_at = payload.get("fetched_at")
    _require(isinstance(fetched_at, str), "fetched_at is required")
    try:
        dt.datetime.fromisoformat(fetched_at)
    except ValueError as exc:
        raise ValueError("fetched_at must be ISO-8601") from exc

    raw_sha256 = payload.get("raw_sha256")
    _require(isinstance(raw_sha256, str) and raw_sha256, "raw_sha256 is required")

    source: Dict[str, Any] = {
        "url": url,
        "fetched_at": fetched_at,
        "raw_sha256": raw_sha256,
    }
    if payload.get("artifact_key") is not None:
        source["artifact_key"] = payload["artifact_key"]
    return source


@dataclass
class NormalizedCaseResult:
    normalized_case: Dict[str, Any]
    source: Dict[str, Any]

    @classmethod
    def model_validate(cls, payload: Dict[str, Any]) -> "NormalizedCaseResult":
        if isinstance(payload, NormalizedCaseResult):
            return payload
        if not isinstance(payload, dict):
            raise ValueError("Item must be a dictionary")

        normalized_case = validate_normalized_case(payload.get("normalized_case") or {})
        source = validate_source(payload.get("source") or {})
        return cls(normalized_case=normalized_case, source=source)

    def model_dump(self) -> Dict[str, Any]:
        return {"normalized_case": self.normalized_case, "source": self.source}

    def with_raw_sha(self, body: bytes) -> "NormalizedCaseResult":
        sha_value = hashlib.sha256(body).hexdigest()
        updated_source = dict(self.source, raw_sha256=sha_value)
        return NormalizedCaseResult(normalized_case=self.normalized_case, source=updated_source)
