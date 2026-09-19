#!/usr/bin/env python3
"""Collect a small public feed catalogue for a static GitHub Pages website.

No API keys, third-party packages, model calls or browser-to-feed requests.
The default project root is the parent of this scripts directory.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html import unescape
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import socket
import sys
import time
from typing import Callable
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET


PROJECT_ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 3 * 1024 * 1024
TIMEOUT_SECONDS = 20
MIN_ITEMS = 40
MAX_ITEMS = 400
HISTORY_DAYS = 7
MAX_WORKERS = 4
SOURCE_FIELDS = ("id", "name", "category", "website", "url", "type", "description", "color", "initials")
USER_AGENT = "ElsewhereFeedReader/1.0 (personal non-commercial RSS reader)"
TRACKING_PARAMS = {"fbclid", "gclid", "dclid", "mc_cid", "mc_eid", "msclkid"}
LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".test", ".invalid")


class FeedError(ValueError):
    """An invalid source or source response that can be reported safely."""


class CollectionError(RuntimeError):
    """No source could be collected; leave the previously published file alone."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_date(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_date(value: object) -> str | None:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            dt = datetime.fromtimestamp(value, timezone.utc)
        elif isinstance(value, str):
            try:
                dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            except ValueError:
                dt = parsedate_to_datetime(value.strip())
        else:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return iso_date(dt)
    except (ValueError, TypeError, OverflowError, OSError, AttributeError):
        return None


def safe_url(value: str, base: str | None = None, *, resolve: bool = False) -> str:
    """Accept public HTTP(S) URLs; DNS checks apply to actual network targets.

    Article URLs are syntax/literal-IP checked without hundreds of DNS lookups.
    Every feed request and redirect is DNS checked before urllib opens it.
    """
    if not isinstance(value, str) or not value.strip():
        raise FeedError("Missing URL")
    if any(ord(c) < 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise FeedError("URL contains invalid characters")
    candidate = urljoin(base, value.strip()) if base else value.strip()
    try:
        parsed = urlsplit(candidate)
        if parsed.scheme.lower() not in {"http", "https"}:
            raise FeedError("Only HTTP and HTTPS URLs are supported")
        if parsed.username is not None or parsed.password is not None:
            raise FeedError("URLs containing credentials are not supported")
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise FeedError("Invalid URL") from exc
    if not host or "%" in host:
        raise FeedError("Invalid hostname")
    host = host.lower().rstrip(".")
    if host == "localhost" or host.endswith(LOCAL_SUFFIXES) or "." not in host and ":" not in host:
        raise FeedError("Private or local hosts are not supported")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise FeedError("Invalid hostname") from exc
        if not re.fullmatch(r"[a-z0-9.-]+", host):
            raise FeedError("Invalid hostname")
    else:
        if not address.is_global or address.is_multicast:
            raise FeedError("Private or local addresses are not supported")
    if port is not None and not 1 <= port <= 65535:
        raise FeedError("Invalid port")
    if resolve:
        try:
            addresses = socket.getaddrinfo(host, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        except OSError as exc:
            raise FeedError("Could not resolve source host") from exc
        if not addresses:
            raise FeedError("Could not resolve source host")
        for info in addresses:
            address = ipaddress.ip_address(info[4][0].split("%", 1)[0])
            if not address.is_global or address.is_multicast:
                raise FeedError("Source resolves to a private or local address")
    authority = f"[{host}]" if ":" in host else host
    default_port = 443 if parsed.scheme.lower() == "https" else 80
    if port is not None and port != default_port:
        authority += f":{port}"
    return urlunsplit((parsed.scheme.lower(), authority, parsed.path or "/", parsed.query, ""))


def canonical_url(value: str, base: str | None = None) -> str:
    parsed = urlsplit(safe_url(value, base))
    query = sorted((key, val) for key, val in parse_qsl(parsed.query, keep_blank_values=True)
                   if not key.lower().startswith("utm_") and key.lower() not in TRACKING_PARAMS)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))


class SafeRedirectHandler(HTTPRedirectHandler):
    max_repeats = 2
    max_redirections = 5

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_target = safe_url(newurl, req.full_url, resolve=True)
        return super().redirect_request(req, fp, code, msg, headers, safe_target)


def fetch_bytes(url: str) -> bytes:
    target = safe_url(url, resolve=True)
    request = Request(target, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/json, application/xml, text/xml;q=0.9", "Accept-Encoding": "identity"})
    start = time.monotonic()
    try:
        with build_opener(SafeRedirectHandler()).open(request, timeout=TIMEOUT_SECONDS) as response:
            safe_url(response.url, resolve=True)
            length = response.headers.get("Content-Length", "")
            if length.isdigit() and int(length) > MAX_BYTES:
                raise FeedError("Source response exceeds the size limit")
            if response.headers.get("Content-Encoding", "identity").lower() not in {"", "identity"}:
                raise FeedError("Source ignored the uncompressed response request")
            chunks: list[bytes] = []
            total = 0
            while True:
                if time.monotonic() - start > TIMEOUT_SECONDS:
                    raise FeedError("Source request timed out")
                chunk = response.read(min(65536, MAX_BYTES + 1 - total))
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise FeedError("Source response exceeds the size limit")
                chunks.append(chunk)
            return b"".join(chunks)
    except HTTPError as exc:
        raise FeedError(f"Source returned HTTP {exc.code}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise FeedError("Source request timed out") from exc
    except URLError as exc:
        raise FeedError("Could not reach source") from exc


class TextOnlyParser(HTMLParser):
    BLOCKED = {"script", "style", "iframe", "object", "embed", "svg", "math", "noscript", "template"}
    BREAKS = {"p", "br", "div", "li", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "tr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.blocked: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.rsplit(":", 1)[-1]
        if tag in self.BLOCKED:
            self.blocked.append(tag)
        elif tag in self.BREAKS and not self.blocked:
            self.parts.append(" ")

    def handle_startendtag(self, tag, attrs):
        tag = tag.rsplit(":", 1)[-1]
        if tag in self.BREAKS and not self.blocked:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        tag = tag.rsplit(":", 1)[-1]
        if tag in self.blocked:
            index = len(self.blocked) - 1 - self.blocked[::-1].index(tag)
            self.blocked = self.blocked[:index]
        elif tag in self.BREAKS and not self.blocked:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.blocked:
            self.parts.append(data)


def clean_text(value: object, limit: int = 220) -> str:
    if not isinstance(value, str):
        return ""
    # Steam posts sometimes use BBCode as well as HTML. Keep linked words.
    value = re.sub(r"\[img\].*?\[/img\]", " ", value, flags=re.I | re.S)
    value = re.sub(r"\[/?(?:url|b|i|u|h[1-6]|list|\*|quote|code|previewyoutube|table|tr|td)(?:=[^\]]*)?\]", " ", value, flags=re.I)
    parser = TextOnlyParser()
    parser.feed(value)
    parser.close()
    text = unescape("".join(parser.parts))
    text = "".join(c for c in text if not unicodedata.category(c).startswith("C") or c.isspace())
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(" ", 1)[0]
    if len(cut) < limit // 2:
        cut = text[:limit - 1]
    return cut.rstrip(" ,;:-") + "…"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child(node: ET.Element, *names: str) -> ET.Element | None:
    for name in names:
        for element in node:
            if local_name(element.tag) == name:
                return element
    return None


def element_text(node: ET.Element, *names: str) -> str:
    found = child(node, *names)
    if found is None:
        return ""
    if len(found):
        # Preserve XHTML structure until the text-only parser removes markup.
        return (found.text or "") + "".join(ET.tostring(part, encoding="unicode") for part in found)
    return found.text or ""


def parse_xml(body: bytes, source: dict) -> list[dict]:
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", body, flags=re.I):
        raise FeedError("XML document types and entities are not supported")
    try:
        root = ET.fromstring(body)
    except (ET.ParseError, ValueError) as exc:
        raise FeedError("Source returned malformed XML") from exc
    root_name = local_name(root.tag)
    if root_name == "feed":
        entries = [node for node in root if local_name(node.tag) == "entry"]
        atom = True
    elif root_name == "rss":
        channel = child(root, "channel")
        if channel is None:
            raise FeedError("RSS response is missing its channel")
        entries = [node for node in channel if local_name(node.tag) == "item"]
        atom = False
    elif root_name == "rdf":
        entries = [node for node in root if local_name(node.tag) == "item"]
        atom = False
    else:
        raise FeedError("Response is not an RSS or Atom feed")
    items = []
    for entry in entries:
        base = entry.attrib.get("{http://www.w3.org/XML/1998/namespace}base", source["website"])
        if atom:
            links = [link for link in entry if local_name(link.tag) == "link" and link.attrib.get("rel", "alternate") == "alternate"]
            links.sort(key=lambda link: link.attrib.get("type", "text/html") != "text/html")
            link = links[0].attrib.get("href", "") if links else ""
            date = element_text(entry, "published", "updated")
            summary = element_text(entry, "summary", "content")
        else:
            link = element_text(entry, "link")
            if not link:
                guid = child(entry, "guid")
                if guid is not None and guid.attrib.get("isPermaLink", "true").lower() == "true":
                    link = guid.text or ""
            date = element_text(entry, "pubdate", "date", "published", "updated")
            summary = element_text(entry, "description", "summary", "encoded", "content")
        if not link:
            continue
        items.append({"title": element_text(entry, "title"), "url": link, "base": base, "summary": summary, "publishedAt": date})
    return items


def parse_steam(body: bytes, source: dict) -> list[dict]:
    try:
        data = json.loads(body)
        entries = data["appnews"]["newsitems"]
        if not isinstance(entries, list):
            raise ValueError
    except (ValueError, KeyError, TypeError) as exc:
        raise FeedError("Source returned invalid Steam news JSON") from exc
    return [{"title": entry.get("title", ""), "url": entry.get("url", ""), "summary": entry.get("contents", ""), "publishedAt": entry.get("date"), "base": source["website"]}
            for entry in entries if isinstance(entry, dict) and entry.get("feedname") == "steam_community_announcements"]


def normalise_item(raw: dict, source: dict, now: str, previous: dict | None = None) -> dict | None:
    try:
        url = canonical_url(raw.get("url", ""), raw.get("base", source["website"]))
    except FeedError:
        return None
    title = clean_text(raw.get("title"), 300)
    if not title:
        return None
    item_id = hashlib.sha256((source["id"] + "\n" + url).encode("utf-8")).hexdigest()[:24]
    old = (previous or {}).get(item_id, {})
    first_seen = parse_date(old.get("firstSeenAt")) or parse_date(raw.get("firstSeenAt")) or now
    published = parse_date(raw.get("publishedAt")) or parse_date(old.get("publishedAt"))
    return {"id": item_id, "sourceId": source["id"], "sourceName": source["name"], "title": title, "url": url, "summary": clean_text(raw.get("summary")), "publishedAt": published, "firstSeenAt": first_seen}


def bounded_history(items: list[dict], now: datetime) -> list[dict]:
    ordered = sorted(items, key=lambda item: (item["publishedAt"] or item["firstSeenAt"], item["id"]), reverse=True)
    cutoff = iso_date(now - timedelta(days=HISTORY_DAYS))
    recent = [item for item in ordered if (item["publishedAt"] or item["firstSeenAt"]) >= cutoff]
    older = [item for item in ordered if (item["publishedAt"] or item["firstSeenAt"]) < cutoff]
    # Keep the full weekly window for digests, with a safety cap for busy feeds.
    # Fill quiet sources to 40 entries using their most recent older items.
    return (recent + older[:max(0, MIN_ITEMS - len(recent))])[:MAX_ITEMS]


def validate_sources(sources: object) -> list[dict]:
    if not isinstance(sources, list) or not sources:
        raise FeedError("sources.json must contain a nonempty source list")
    validated = []
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or any(not isinstance(source.get(field), str) or not source[field].strip() for field in SOURCE_FIELDS):
            raise FeedError("Every source must contain the required text fields")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", source["id"]) or source["id"] in seen:
            raise FeedError("Source IDs must be unique lowercase slugs")
        if source["type"] not in {"rss", "atom", "steam"}:
            raise FeedError("Unsupported source type")
        item = {field: source[field] for field in SOURCE_FIELDS}
        item["url"] = safe_url(item["url"])
        item["website"] = safe_url(item["website"])
        seen.add(item["id"])
        validated.append(item)
    return validated


def collect(sources: list[dict], previous: dict | None = None, *, fetch: Callable[[str], bytes] = fetch_bytes, now: datetime | None = None) -> dict:
    sources = validate_sources(sources)
    previous = previous if isinstance(previous, dict) else {}
    now = now or utc_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    stamp = iso_date(now)
    previous_sources = {source.get("id"): source for source in previous.get("sources", []) if isinstance(source, dict)}
    previous_items = [item for item in previous.get("items", []) if isinstance(item, dict)]

    def one(source: dict) -> tuple[dict, list[dict], bool]:
        retained = {}
        for raw in previous_items:
            if raw.get("sourceId") == source["id"]:
                item = normalise_item(raw, source, stamp)
                if item:
                    retained[item["id"]] = item
        prior_source = previous_sources.get(source["id"], {})
        error = None
        last_success = parse_date(prior_source.get("lastSuccessAt"))
        try:
            body = fetch(source["url"])
            if len(body) > MAX_BYTES:
                raise FeedError("Source response exceeds the size limit")
            parsed = parse_steam(body, source) if source["type"] == "steam" else parse_xml(body, source)
            for raw in parsed:
                item = normalise_item(raw, source, stamp, retained)
                if item:
                    retained[item["id"]] = item
            last_success = stamp
        except (FeedError, OSError, ValueError) as exc:
            error = clean_text(str(exc), 180) or "Could not read source"
        items = bounded_history(list(retained.values()), now)
        status = {**source, "checkedAt": stamp, "lastSuccessAt": last_success, "error": error, "itemCount": len(items)}
        return status, items, error is None

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(sources))) as pool:
        results = list(pool.map(one, sources))
    if not any(success for _, _, success in results):
        errors = "; ".join(f"{source['name']}: {source['error']}" for source, _, _ in results)
        raise CollectionError("Every source failed; the existing data file was left unchanged. " + errors)
    statuses = []
    items = []
    for source, source_items, _ in results:
        statuses.append(source)
        items.extend(source_items)
    items.sort(key=lambda item: (item["publishedAt"] or item["firstSeenAt"], item["id"]), reverse=True)
    return {"version": 1, "generatedAt": stamp, "sources": statuses, "items": items}


def load_previous(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CollectionError("Existing updates.json is unreadable; refusing to discard its history") from exc
    if not isinstance(data, dict) or not isinstance(data.get("sources"), list) or not isinstance(data.get("items"), list):
        raise CollectionError("Existing updates.json has an invalid shape")
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=PROJECT_ROOT, help="Project directory containing sources.json")
    args = parser.parse_args(argv)
    destination = args.root / "public" / "data" / "updates.json"
    try:
        sources = json.loads((args.root / "sources.json").read_text(encoding="utf-8"))
        snapshot = collect(sources, load_previous(destination))
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
    except (CollectionError, FeedError, OSError, ValueError) as exc:
        print(f"Collection failed: {exc}", file=sys.stderr)
        return 1
    failed = [source for source in snapshot["sources"] if source["error"]]
    print(f"Collected {len(snapshot['items'])} items from {len(snapshot['sources']) - len(failed)}/{len(snapshot['sources'])} sources.")
    for source in failed:
        print(f"Kept earlier items for {source['name']}: {source['error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
