import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import Request


SPEC = importlib.util.spec_from_file_location("collector", Path(__file__).resolve().parents[1] / "scripts" / "collect.py")
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)

NOW = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)


def source(source_id="one", source_type="rss"):
    return {"id": source_id, "name": "Example " + source_id, "category": "Books", "website": "https://publisher.org/", "url": "https://publisher.org/" + source_id + ".xml", "type": source_type, "description": "Publisher updates.", "color": "#123456", "initials": "EX"}


def rss(items=""):
    return ("<rss version='2.0'><channel><title>Example</title>" + items + "</channel></rss>").encode()


def item(url="https://publisher.org/a", title="A new book", date="", summary="A short introduction."):
    dated = "<pubDate>" + date + "</pubDate>" if date else ""
    return "<item><title>" + title + "</title><link>" + url.replace("&", "&amp;") + "</link>" + dated + "<description><![CDATA[" + summary + "]]></description></item>"


class CollectorTests(unittest.TestCase):
    def test_contract_and_utc_date(self):
        payload = rss(item(date="Fri, 18 Sep 2026 19:00:00 +0200"))
        result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(set(result), {"version", "generatedAt", "sources", "items"})
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["generatedAt"], "2026-09-19T12:00:00Z")
        self.assertEqual(set(result["items"][0]), {"id", "sourceId", "sourceName", "title", "url", "summary", "publishedAt", "firstSeenAt"})
        self.assertEqual(result["items"][0]["publishedAt"], "2026-09-18T17:00:00Z")
        self.assertEqual(set(result["sources"][0]), set(collector.SOURCE_FIELDS) | {"checkedAt", "lastSuccessAt", "error", "itemCount"})

    def test_duplicate_tracking_links_collapse_to_stable_id(self):
        payload = rss(item("https://publisher.org/a?b=2&a=1&utm_source=feed#top") + item("https://publisher.org/a?a=1&b=2"))
        first = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        second = collector.collect([source()], first, fetch=lambda _: rss(item("https://publisher.org/a?b=2&a=1")), now=NOW + timedelta(days=1))
        self.assertEqual(len(first["items"]), 1)
        self.assertEqual(first["items"][0]["id"], second["items"][0]["id"])
        self.assertEqual(first["items"][0]["url"], "https://publisher.org/a?a=1&b=2")

    def test_missing_dates_keep_first_seen_without_inventing_publication(self):
        first = collector.collect([source()], fetch=lambda _: rss(item()), now=NOW)
        second = collector.collect([source()], first, fetch=lambda _: rss(item(summary="An updated introduction.")), now=NOW + timedelta(days=3))
        self.assertIsNone(second["items"][0]["publishedAt"])
        self.assertEqual(second["items"][0]["firstSeenAt"], "2026-09-19T12:00:00Z")
        self.assertEqual(second["items"][0]["summary"], "An updated introduction.")

    def test_source_failure_retains_items_and_last_success(self):
        sources = [source("one"), source("two")]
        previous = collector.collect(sources, fetch=lambda url: rss(item("https://publisher.org/" + url.rsplit("/", 1)[-1])), now=NOW)

        def fetch(url):
            if "one.xml" in url:
                raise collector.FeedError("Source returned HTTP 503")
            return rss(item("https://publisher.org/new"))

        result = collector.collect(sources, previous, fetch=fetch, now=NOW + timedelta(days=1))
        failed = result["sources"][0]
        self.assertEqual(failed["lastSuccessAt"], "2026-09-19T12:00:00Z")
        self.assertEqual(failed["checkedAt"], "2026-09-20T12:00:00Z")
        self.assertEqual(failed["itemCount"], 1)
        self.assertIn("503", failed["error"])
        self.assertTrue(any(entry["sourceId"] == "one" for entry in result["items"]))

    def test_all_failed_raises_even_with_previous_snapshot(self):
        previous = collector.collect([source()], fetch=lambda _: rss(item()), now=NOW)
        with self.assertRaises(collector.CollectionError):
            collector.collect([source()], previous, fetch=lambda _: b"<broken", now=NOW)

    def test_malformed_xml_and_html_error_documents_are_rejected(self):
        for payload in [b"<rss>", b"<html><title>Blocked</title></html>", b"<rss/>"]:
            with self.subTest(payload=payload), self.assertRaises(collector.FeedError):
                collector.parse_xml(payload, source())

    def test_xml_entities_and_oversized_payload_are_rejected(self):
        payload = b'<!DOCTYPE rss [<!ENTITY injected "wrong">]><rss><channel/></rss>'
        with self.assertRaises(collector.FeedError):
            collector.parse_xml(payload, source())
        with self.assertRaises(collector.CollectionError):
            collector.collect([source()], fetch=lambda _: b"x" * (collector.MAX_BYTES + 1), now=NOW)

    def test_atom_prefers_alternate_and_strips_xhtml_scripts(self):
        payload = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <title>News &amp; notes</title><link rel="self" href="https://publisher.org/api/a"/>
        <link rel="alternate" href="/a"/><published>2026-09-18T20:30:00+01:00</published>
        <summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Read <strong>this</strong><script>steal()</script><img src="x" onerror="steal()"/> &amp; enjoy.</div></summary>
        </entry></feed>'''
        result = collector.collect([source(source_type="atom")], fetch=lambda _: payload, now=NOW)
        entry = result["items"][0]
        self.assertEqual(entry["url"], "https://publisher.org/a")
        self.assertEqual(entry["title"], "News & notes")
        self.assertEqual(entry["summary"], "Read this & enjoy.")
        self.assertEqual(entry["publishedAt"], "2026-09-18T19:30:00Z")

    def test_steam_excludes_external_editorial_feeds(self):
        payload = json.dumps({"appnews": {"newsitems": [
            {"title": "Patch notes", "url": "https://store.steampowered.com/news/app/1/view/2", "contents": "[b]Fixed[/b] a bug.", "date": 1789819200, "feedname": "steam_community_announcements"},
            {"title": "External story", "url": "https://publisher.org/news", "contents": "Other news", "feedname": "PC Gamer"}
        ]}}).encode()
        result = collector.collect([source(source_type="steam")], fetch=lambda _: payload, now=NOW)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["title"], "Patch notes")
        self.assertEqual(result["items"][0]["summary"], "Fixed a bug.")

    def test_plaintext_excerpt_is_bounded_and_has_no_active_markup(self):
        text = collector.clean_text("<p>Hello &amp; welcome.</p><script>bad()</script><style>bad{}</style><svg><text>hidden</text></svg>" + " A useful sentence." * 40)
        self.assertLessEqual(len(text), 220)
        self.assertNotIn("<", text)
        self.assertNotIn("bad", text)
        self.assertNotIn("hidden", text)
        self.assertTrue(text.startswith("Hello & welcome."))

    def test_unsafe_article_links_are_skipped(self):
        payload = rss(item("javascript:alert(1)") + item("https://user:pass@publisher.org/private") + item("http://127.0.0.1/private") + item())
        result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(len(result["items"]), 1)

    def test_url_validation_rejects_local_and_credential_targets(self):
        for url in ["file:///etc/passwd", "ftp://publisher.org/a", "https://user:pass@publisher.org/a", "http://localhost/a", "http://127.0.0.1/a", "http://10.1.2.3/a", "http://169.254.169.254/a", "http://[::1]/a", "http://[fe80::1]/a", "https://x.local/a", "https://publisher.org\\@localhost/a", "https://publisher.org/\nnext"]:
            with self.subTest(url=url), self.assertRaises(collector.FeedError):
                collector.safe_url(url)
        self.assertEqual(collector.safe_url("HTTPS://PUBLISHER.ORG:443/a#b"), "https://publisher.org/a")

    def test_dns_resolution_and_redirects_reject_private_addresses(self):
        private_dns = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.9", 443))]
        with patch.object(collector.socket, "getaddrinfo", return_value=private_dns):
            with self.assertRaises(collector.FeedError):
                collector.safe_url("https://publisher.org/feed", resolve=True)
            with self.assertRaises(collector.FeedError):
                collector.SafeRedirectHandler().redirect_request(Request("https://publisher.org/feed"), None, 302, "Found", {}, "https://redirect.org/feed")
        public_dns = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch.object(collector.socket, "getaddrinfo", return_value=public_dns):
            self.assertEqual(collector.safe_url("https://publisher.org/feed", resolve=True), "https://publisher.org/feed")

    def test_history_is_limited_but_keeps_slow_sources(self):
        payload = rss("".join(item("https://publisher.org/" + str(n), date="Mon, 01 Jan 2024 12:00:00 GMT") for n in range(60)))
        previous = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(len(previous["items"]), 40)
        next_result = collector.collect([source()], previous, fetch=lambda _: rss(), now=NOW + timedelta(days=1))
        self.assertEqual(len(next_result["items"]), 40)

    def test_new_catalogue_excludes_removed_source_history(self):
        previous = collector.collect([source("old")], fetch=lambda _: rss(item()), now=NOW)
        result = collector.collect([source("new")], previous, fetch=lambda _: rss(), now=NOW)
        self.assertEqual(result["items"], [])

    def test_shared_link_keeps_membership_in_each_source(self):
        result = collector.collect([source("one"), source("two")], fetch=lambda _: rss(item()), now=NOW)
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual({entry["sourceId"] for entry in result["items"]}, {"one", "two"})
        self.assertEqual(len({entry["id"] for entry in result["items"]}), 2)
        self.assertEqual(len({entry["url"] for entry in result["items"]}), 1)
        self.assertEqual([status["itemCount"] for status in result["sources"]], [1, 1])

    def test_weekly_digest_keeps_more_than_40_recent_items_across_runs(self):
        date = "Fri, 18 Sep 2026 12:00:00 GMT"
        first = collector.collect([source()], fetch=lambda _: rss("".join(item("https://publisher.org/" + str(n), date=date) for n in range(50))), now=NOW)
        second = collector.collect([source()], first, fetch=lambda _: rss("".join(item("https://publisher.org/" + str(n), date=date) for n in range(50, 80))), now=NOW + timedelta(days=1))
        self.assertEqual(len(second["items"]), 80)
        self.assertEqual(second["sources"][0]["itemCount"], 80)
        self.assertEqual({entry["url"] for entry in second["items"]}, {"https://publisher.org/" + str(n) for n in range(80)})

    def test_weekly_history_respects_400_item_safety_cap(self):
        payload = rss("".join(item("https://publisher.org/" + str(n), date="Fri, 18 Sep 2026 12:00:00 GMT") for n in range(450)))
        result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(len(result["items"]), 400)
        self.assertEqual(result["sources"][0]["itemCount"], 400)

    def test_quiet_source_fills_recent_week_with_older_items_to_40(self):
        recent = "".join(item("https://publisher.org/recent-" + str(n), date="Fri, 18 Sep 2026 12:00:00 GMT") for n in range(10))
        old = "".join(item("https://publisher.org/old-" + str(n), date="Mon, 01 Jan 2024 12:00:00 GMT") for n in range(50))
        result = collector.collect([source()], fetch=lambda _: rss(recent + old), now=NOW)
        self.assertEqual(len(result["items"]), 40)
        self.assertEqual(sum("/recent-" in entry["url"] for entry in result["items"]), 10)

    def test_prior_url_only_ids_migrate_without_losing_first_seen(self):
        previous = collector.collect([source()], fetch=lambda _: rss(item()), now=NOW)
        old_first_seen = previous["items"][0]["firstSeenAt"]
        previous["items"][0]["id"] = "legacy-url-only-id"
        migrated = collector.collect([source()], previous, fetch=lambda _: rss(item()), now=NOW + timedelta(days=1))
        self.assertEqual(len(migrated["items"]), 1)
        self.assertNotEqual(migrated["items"][0]["id"], "legacy-url-only-id")
        self.assertEqual(migrated["items"][0]["firstSeenAt"], old_first_seen)

    def test_cli_does_not_replace_previous_file_after_total_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sources.json").write_text(json.dumps([source()]), encoding="utf-8")
            destination = root / "public" / "data" / "updates.json"
            destination.parent.mkdir(parents=True)
            old = '{"sources": [], "items": [], "sentinel": true}'
            destination.write_text(old, encoding="utf-8")
            with patch.object(collector, "collect", side_effect=collector.CollectionError("Every source failed")):
                self.assertEqual(collector.main(["--root", str(root)]), 1)
            self.assertEqual(destination.read_text(encoding="utf-8"), old)

    def test_media_images_prefer_full_image_and_ignore_video(self):
        payload = b'''<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
        <title>New cards</title><link>https://publisher.org/cards</link>
        <media:thumbnail url="https://publisher.org/small.jpg"/>
        <media:content url="https://publisher.org/video.mp4" medium="video"/>
        <media:content url="https://publisher.org/large.jpg" medium="image"/>
        </item></channel></rss>'''
        result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(result["items"][0]["imageUrl"], "https://publisher.org/large.jpg")

    def test_rss_and_atom_image_enclosures(self):
        payloads = [b'''<rss><channel><item><title>Photo</title><link>/photo</link>
            <enclosure url="/photo.jpg" type="image/jpeg"/></item></channel></rss>''',
            b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Photo</title>
            <link href="/photo"/><link rel="enclosure" href="/photo.jpg" type="image/jpeg"/></entry></feed>''']
        for payload in payloads:
            with self.subTest(payload=payload):
                result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
                self.assertEqual(result["items"][0]["imageUrl"], "https://publisher.org/photo.jpg")

    def test_unsafe_images_are_skipped_for_first_usable_content_image(self):
        summary = '<img src="javascript:bad()"><img src="http://127.0.0.1/private"><img src="https://publisher.org/pixel.gif" width="1"><img src="https://1.gravatar.com/avatar/a"><img src="/photo.jpg" width onerror="bad()">'
        result = collector.collect([source()], fetch=lambda _: rss(item(summary=summary)), now=NOW)
        self.assertEqual(result["items"][0]["imageUrl"], "https://publisher.org/photo.jpg")
        self.assertEqual(result["items"][0]["summary"], "")
        for value in ['data:image/svg+xml,bad', 'https://user:pass@publisher.org/x', 'http://publisher.org/photo.jpg', 'https://localhost/x', 'https://10.0.0.1/x']:
            self.assertIsNone(collector.image_url(value, 'https://publisher.org/'))

    def test_atom_xhtml_images_and_encoded_content(self):
        payload = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Photo</title><link href="/photo"/>
        <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><img src="/photo.jpg"/></div></content></entry></feed>'''
        result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(result["items"][0]["imageUrl"], "https://publisher.org/photo.jpg")
        payload = b'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Photo</title><link>/photo</link>
        <description>Short summary.</description><content:encoded><![CDATA[<img src="/encoded.jpg">]]></content:encoded></item></channel></rss>'''
        result = collector.collect([source()], fetch=lambda _: payload, now=NOW)
        self.assertEqual(result["items"][0]["imageUrl"], "https://publisher.org/encoded.jpg")
        self.assertEqual(result["items"][0]["summary"], "Short summary.")

    def test_steam_bbcode_image_without_markup_in_summary(self):
        payload = json.dumps({"appnews": {"newsitems": [{"title": "A patch", "url": "https://store.steampowered.com/news/app/1/view/2", "contents": "[img]{STEAM_CLAN_IMAGE}/123/example.jpg[/img] New features.", "feedname": "steam_community_announcements"}]}}).encode()
        result = collector.collect([source(source_type="steam")], fetch=lambda _: payload, now=NOW)
        self.assertEqual(result["items"][0]["imageUrl"], "https://clan.fastly.steamstatic.com/images/123/example.jpg")
        self.assertEqual(result["items"][0]["summary"], "New features.")

    def test_image_and_first_seen_survive_missing_image_and_source_failure(self):
        sources = [source('one'), source('two')]
        previous = collector.collect(sources, fetch=lambda _: rss(item(summary='<img src="/photo.jpg">Hello')), now=NOW)
        def fetch(url):
            if 'two.xml' in url:
                raise collector.FeedError('Unavailable')
            return rss(item(summary='Updated text'))
        current = collector.collect(sources, previous, fetch=fetch, now=NOW + timedelta(days=1))
        for entry in current['items']:
            self.assertEqual(entry['imageUrl'], 'https://publisher.org/photo.jpg')
            self.assertEqual(entry['firstSeenAt'], '2026-09-19T12:00:00Z')

    def test_catalogue_metadata_is_preserved_and_invalid_extras_rejected(self):
        src = {**source(), 'aliases': ['pokemon', 'cards'], 'publisher': 'Example Blog', 'publisherType': 'Fan site', 'official': False, 'imageUrl': 'https://publisher.org/cover.jpg', 'imagePage': 'https://publisher.org/article'}
        result = collector.collect([src], fetch=lambda _: rss(), now=NOW)
        for field in ('aliases', 'publisher', 'publisherType', 'official', 'imageUrl', 'imagePage'):
            self.assertEqual(result['sources'][0][field], src[field])
        for extra in [{'aliases': 'cards'}, {'aliases': [False]}, {'imageUrl': 'javascript:bad()'}, {'imagePage': 'https://127.0.0.1/private'}, {'official': 'true'}]:
            with self.subTest(extra=extra), self.assertRaises(collector.FeedError):
                collector.validate_sources([{**source(), **extra}])

    def test_official_pokemon_go_adapter_reads_cards_and_millisecond_dates(self):
        src = {**source(source_type='pokemon-go'), 'url': 'https://pokemongo.com/en/news', 'website': 'https://pokemongo.com/en/news'}
        payload = b'''<!doctype html><html><a href="/news/example" class="_newsCard_test_22"><picture>
        <img src="https://lh3.googleusercontent.com/example=s0"/></picture><pg-date-format timestamp="1789491600000"></pg-date-format>
        <div class="_newsCardTitle_test">October 2026 Community Day: Zorua</div></a><a href="/other">Ignore</a></html>'''
        result = collector.collect([src], fetch=lambda _: payload, now=NOW)
        entry = result['items'][0]
        self.assertEqual(entry['url'], 'https://pokemongo.com/news/example')
        self.assertEqual(entry['title'], 'October 2026 Community Day: Zorua')
        self.assertEqual(entry['publishedAt'], collector.parse_date(1789491600))
        self.assertEqual(entry['imageUrl'], 'https://lh3.googleusercontent.com/example=s0')
        self.assertEqual(entry['summary'], '')
        with self.assertRaises(collector.FeedError):
            collector.parse_pokemon_go(b'<html>Unavailable</html>', src)
        with self.assertRaises(collector.FeedError):
            collector.validate_sources([source(source_type='pokemon-go')])


if __name__ == "__main__":
    unittest.main()
