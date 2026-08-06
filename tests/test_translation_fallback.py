import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "scrape_live",
    ROOT / "scripts" / "scrape_live.py",
)
SCRAPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCRAPER)


class FakeResponse:
    def __init__(self, payload):
        self.body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.body


class TranslationFallbackTests(unittest.TestCase):
    def setUp(self):
        SCRAPER.ACTIVE_TRANSLATION_PROVIDER = ""

    def test_qwen_mt_success_reports_model_provider(self):
        def fake_urlopen(request, timeout=0):
            return FakeResponse(
                {"choices": [{"message": {"content": "自然的中文翻译"}}]}
            )

        with (
            patch.object(
                SCRAPER,
                "translation_config",
                return_value=("key", "https://example.test/chat/completions", "qwen-mt-flash"),
            ),
            patch.object(SCRAPER, "urlopen", side_effect=fake_urlopen),
        ):
            translated, providers = SCRAPER.translate_texts(["Natural Chinese translation"])

        self.assertEqual(translated, ["自然的中文翻译"])
        self.assertEqual(providers, ["qwen-mt-flash"])
        self.assertEqual(SCRAPER.translation_provider(), "qwen-mt-flash 中文本地化")

    def test_uses_google_after_qwen_mt_is_unavailable(self):
        def fake_urlopen(request, timeout=0):
            if "translate.googleapis.com" in request.full_url:
                return FakeResponse([[["重大科技新闻", "Breaking technology news"]]])
            raise HTTPError(
                request.full_url,
                403,
                "Forbidden",
                None,
                io.BytesIO(b'{"error":{"code":"insufficient_quota"}}'),
            )

        with (
            patch.object(
                SCRAPER,
                "translation_config",
                return_value=("key", "https://example.test/chat/completions", "qwen-mt-flash"),
            ),
            patch.object(SCRAPER, "urlopen", side_effect=fake_urlopen),
        ):
            translated, providers = SCRAPER.translate_texts(["Breaking technology news"])

        self.assertEqual(translated, ["重大科技新闻"])
        self.assertEqual(providers, ["Google Translate"])
        self.assertEqual(SCRAPER.translation_provider(), "Google Translate 降级模式")


if __name__ == "__main__":
    unittest.main()
