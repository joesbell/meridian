#!/usr/bin/env python3
import json
import logging
import re
import sys
import base64
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from urllib.parse import quote, urljoin
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from scrapling.fetchers import DynamicFetcher, DynamicSession, Fetcher

logging.getLogger("scrapling").setLevel(logging.ERROR)

CHROME_OPTIONS = {
    "headless": True,
    "real_chrome": True,
    "disable_resources": True,
    "network_idle": False,
    "timeout": 45_000,
}

ACTIVE_TRANSLATION_PROVIDER = ""
# Qwen-MT 专用翻译通道：阿里云百炼 OpenAI 兼容端点 + 专用翻译模型
QWEN_MT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_MT_MODEL = "qwen-mt-flash"


def compact(value):
    return re.sub(r"\s+", " ", unescape(str(value or ""))).strip()


def numeric(value):
    match = re.search(r"[\d,]+", compact(value))
    return match.group(0).replace(",", "") if match else "—"


def needs_translation(value):
    value = compact(value)
    latin = len(re.findall(r"[A-Za-z]", value))
    han = len(re.findall(r"[\u3400-\u9fff]", value))
    return latin > 3 and han < max(2, latin // 5)


def translation_from_google(payload):
    if not isinstance(payload, list) or not payload:
        return ""
    segments = payload[0] if isinstance(payload[0], list) else []
    return compact("".join(segment[0] for segment in segments if isinstance(segment, list) and segment))


def translation_config():
    """返回 (api_key, endpoint, model)；默认走 Qwen-MT 专用通道，未配置时 api_key 为空字符串。"""
    api_key = os.getenv("TRANSLATION_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or ""
    endpoint = (
        os.getenv("TRANSLATION_API_URL")
        or os.getenv("DASHSCOPE_API_URL")
        or QWEN_MT_ENDPOINT
    )
    model = (
        os.getenv("TRANSLATION_MODEL")
        or os.getenv("DASHSCOPE_TRANSLATION_MODEL")
        or QWEN_MT_MODEL
    )
    return api_key, endpoint, model


def translation_provider():
    if ACTIVE_TRANSLATION_PROVIDER:
        return ACTIVE_TRANSLATION_PROVIDER
    if translation_config()[0]:
        return f"{translation_config()[2]} 中文本地化"
    return "Google Translate 降级模式"


def translate_qwen_mt_one(api_key, endpoint, model, text):
    """调 Qwen-MT 专用翻译模型：通过 translation_options 指定目标语言，直接返回译文文本。"""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": text}],
        "translation_options": {"target_lang": "Chinese"},
    }
    request = Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    value = compact(result.get("choices", [{}])[0].get("message", {}).get("content", ""))
    if not value:
        raise RuntimeError(f"{model} 返回了空翻译")
    return value


def translate_with_llm(texts, pending):
    """全部翻译请求只走 Qwen-MT（默认 qwen-mt-flash），6 并发逐条翻译；
    单条失败时保留原文不影响其他条目，全部失败才返回 None 触发降级。
    返回 (translated, succeeded_indices)。"""
    global ACTIVE_TRANSLATION_PROVIDER
    api_key, endpoint, model = translation_config()
    if not api_key:
        return None
    translated = list(texts)
    succeeded = set()
    with ThreadPoolExecutor(max_workers=min(6, len(pending))) as executor:
        futures = {
            executor.submit(translate_qwen_mt_one, api_key, endpoint, model, texts[index]): index
            for index in pending
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                translated[index] = future.result()
                succeeded.add(index)
            except (HTTPError, URLError, TimeoutError, RuntimeError, KeyError, IndexError, json.JSONDecodeError):
                pass  # 保留原文，其他条目继续
    if not succeeded:
        return None  # 全部失败，降级到 Google Translate
    ACTIVE_TRANSLATION_PROVIDER = f"{model} 中文本地化"
    return translated, succeeded


def _google_translate_batch(translated, indices, normalized):
    """Google Translate 降级：逐条翻译，单条失败保留原文不影响其他。返回成功的下标集合。"""
    succeeded = set()

    def translate_one(index):
        url = (
            "https://translate.googleapis.com/translate_a/single"
            f"?client=gtx&sl=auto&tl=zh-CN&dt=t&q={quote(normalized[index])}"
        )
        request = Request(url, headers={"User-Agent": "Mozilla/5.0 MeridianLiveEdition/1.0"})
        with urlopen(request, timeout=30) as response:
            value = translation_from_google(json.loads(response.read().decode("utf-8")))
        if not value:
            raise RuntimeError("翻译结果为空")
        return index, value

    with ThreadPoolExecutor(max_workers=min(6, len(indices))) as executor:
        futures = {executor.submit(translate_one, index): index for index in indices}
        for future in as_completed(futures):
            index = futures[future]
            try:
                _, value = future.result()
                translated[index] = value
                succeeded.add(index)
            except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError):
                pass  # 保留原文，其他条目继续
    return succeeded


def translate_texts(texts):
    """返回 (translated, providers)：providers[i] 为实际使用的翻译引擎（模型名 / "Google Translate"），
    未翻译或翻译失败的条目为空字符串。"""
    global ACTIVE_TRANSLATION_PROVIDER
    # 保留 \n\n 段落分隔（compact 会把换行折叠成空格，导致无法拆分）
    normalized = [re.sub(r"[^\S\n]+", " ", unescape(str(text or ""))).strip()[:30000] for text in texts]
    pending = [index for index, text in enumerate(normalized) if text and needs_translation(text)]
    translated = list(normalized)
    providers = [""] * len(texts)
    if not pending:
        return translated, providers

    model = translation_config()[2]
    llm_result = translate_with_llm(normalized, pending)
    if llm_result is not None:
        translated, llm_succeeded = llm_result
        for index in llm_succeeded:
            providers[index] = model

    # 收集仍未翻译成中文的条目，降级到 Google Translate
    still_pending = [
        index for index in pending
        if not re.search(r"[\u3400-\u9fff]", translated[index])
    ]
    if still_pending:
        if not ACTIVE_TRANSLATION_PROVIDER:
            ACTIVE_TRANSLATION_PROVIDER = "Google Translate 降级模式"
        for index in _google_translate_batch(translated, still_pending, normalized):
            providers[index] = "Google Translate"

    return translated, providers


def parse_github_article(article, period, rank):
    href = article.css("h2 a::attr(href)").get()
    if not href or href.count("/") < 2:
        return None
    repo = str(href).strip("/")
    if repo.count("/") != 1:
        return None
    description_element = article.css("p").get()
    description = ""
    if description_element:
        first_paragraph = article.css("p")[0]
        description = compact(first_paragraph.get_all_text(separator=" ", strip=True))
    language = compact(article.css('[itemprop="programmingLanguage"]::text').get() or "—")
    star_links = article.css('a[href$="/stargazers"]')
    total_stars = numeric(star_links[0].get_all_text(separator=" ", strip=True) if star_links else "")
    growth_match = re.search(
        r"([\d,]+)\s+stars?\s+(?:today|this week|this month)",
        article.get_all_text(separator=" ", strip=True),
        re.I,
    )
    return {
        "id": f"{period}-{repo.replace('/', '-')}",
        "name": repo,
        "url": f"https://github.com/{repo}",
        "description": description,
        "language": language,
        "totalStars": total_stars,
        "periodGrowth": numeric(growth_match.group(1) if growth_match else ""),
        "rank": rank,
        "period": period,
    }


def scrape_github():
    snapshots = {}
    with DynamicSession(**CHROME_OPTIONS, max_pages=1) as session:
        for period in ("daily", "weekly", "monthly"):
            try:
                page = session.fetch(
                    f"https://github.com/trending?since={period}",
                    wait_selector="article.Box-row",
                    **{key: value for key, value in CHROME_OPTIONS.items() if key in {"disable_resources", "network_idle", "timeout"}},
                )
                rows = []
                for article in page.css("article.Box-row"):
                    parsed = parse_github_article(article, period, len(rows) + 1)
                    if parsed:
                        rows.append(parsed)
                    if len(rows) == 15:
                        break
                snapshots[period] = rows
            except Exception:
                snapshots[period] = []

    unique_descriptions = {}
    for rows in snapshots.values():
        for row in rows:
            if row["description"]:
                unique_descriptions[row["name"]] = row["description"]
    names = list(unique_descriptions)
    translations, _providers = translate_texts([unique_descriptions[name] for name in names])
    translated_by_name = dict(zip(names, translations))
    for rows in snapshots.values():
        for row in rows:
            row["description"] = translated_by_name.get(row["name"], "原仓库未提供项目简介。")

    growth_by_repo = {}
    for period, rows in snapshots.items():
        for row in rows:
            growth_by_repo.setdefault(row["name"], {})[period] = row["periodGrowth"]
    for rows in snapshots.values():
        for row in rows:
            row["growth"] = growth_by_repo.get(row["name"], {})
    if not any(snapshots.values()):
        raise RuntimeError("GitHub Trending 当前没有取得有效数据")
    return {
        "snapshots": snapshots,
        "source": "GitHub Trending 官方页面",
        "language": "zh-CN",
        "translationProvider": translation_provider(),
    }


def parse_billboard_song(text):
    lines = [compact(line) for line in str(text or "").splitlines() if compact(line)]
    if not lines or not lines[0].isdigit():
        return None
    rank = int(lines[0])
    cursor = 1
    while cursor < len(lines) and lines[cursor].upper() in {"NEW", "RE-ENTRY"}:
        cursor += 1
    if cursor + 1 >= len(lines):
        return None
    title = lines[cursor]
    cursor += 1
    artist_parts = []
    while cursor < len(lines) and lines[cursor] != "LW":
        if lines[cursor] not in {"Featuring", "&", "With"}:
            artist_parts.append(lines[cursor])
        cursor += 1
    artist = " & ".join(artist_parts[:3])
    if not title or not artist:
        return None
    return {"rank": rank, "title": title, "artist": artist}


def scrape_music():
    source_url = "https://www.billboard.com/charts/r-b-hip-hop-songs/"
    page = Fetcher.get(
        source_url,
        stealthy_headers=True,
        timeout=30,
    )
    songs = []
    for row in page.css(".o-chart-results-list-row-container"):
        parsed = parse_billboard_song(row.get_all_text(separator="\n", strip=True))
        if parsed:
            songs.append(parsed)
        if len(songs) == 15:
            break
    if len(songs) < 8:
        raise RuntimeError(f"Billboard R&B / Hip-Hop 榜单只取得 {len(songs)} 条")
    return {
        "items": songs,
        "source": "Billboard Hot R&B/Hip-Hop Songs",
        "sourceUrl": source_url,
    }


def first_content(page, selectors):
    for selector in selectors:
        elements = page.css(selector)
        if elements:
            text = compact(elements[0].get_all_text(separator=" ", strip=True))
            if len(text) > 400:
                return elements[0]
    return None


def scrape_article(url):
    page = DynamicFetcher.fetch(
        url,
        wait=800,
        **CHROME_OPTIONS,
    )
    headings = page.css("h1")
    title = compact(
        page.css('meta[property="og:title"]::attr(content)').get()
        or (headings[0].get_all_text(separator=" ", strip=True) if headings else "")
        or page.css("title::text").get()
    )
    image = compact(
        page.css('meta[property="og:image"]::attr(content)').get()
        or page.css('meta[name="twitter:image"]::attr(content)').get()
    )
    container = first_content(
        page,
        (
            '[itemprop="articleBody"]',
            "article",
            ".article-content",
            ".entry-content",
            ".post-content",
            "main",
        ),
    )
    if not container:
        raise RuntimeError("原文页面未识别到可阅读正文")

    paragraphs = []
    seen = set()
    for element in container.css("p"):
        text = compact(element.get_all_text(separator=" ", strip=True))
        if len(text) < 28 or text in seen:
            continue
        if re.search(r"(cookie|sign up|subscribe|advertisement|all rights reserved)", text, re.I):
            continue
        seen.add(text)
        paragraphs.append(text[:1800])
        if len(paragraphs) >= 36:
            break
    if len(paragraphs) < 2:
        raise RuntimeError("原文页面正文过短或受访问限制")

    translated, _providers = translate_texts([title, *paragraphs])
    return {
        "title": translated[0],
        "paragraphs": translated[1:],
        "image": urljoin(url, image) if image else "",
        "url": url,
        "language": "zh-CN",
        "translationProvider": translation_provider(),
    }


def scrape_readme(url):
    page = DynamicFetcher.fetch(
        url,
        wait=1000,
        wait_selector="article.markdown-body",
        **CHROME_OPTIONS,
    )
    containers = page.css("article.markdown-body") or page.css(".markdown-body")
    if not containers:
        raise RuntimeError("仓库没有可读取的 README")
    container = containers[0]
    blocks = []
    translatable = []
    translatable_positions = []
    total_length = 0
    for element in container.css("h1, h2, h3, p, li, pre"):
        tag = str(getattr(element, "tag", "") or "").lower()
        kind = "code" if tag == "pre" else "heading" if tag in {"h1", "h2", "h3"} else "list" if tag == "li" else "paragraph"
        text = compact(element.get_all_text(separator="\n" if kind == "code" else " ", strip=True))
        if not text or (kind != "code" and len(text) < 2):
            continue
        text = text[:5000] if kind == "code" else text[:1800]
        if total_length + len(text) > 60_000:
            break
        block = {"type": kind, "text": text}
        blocks.append(block)
        total_length += len(text)
        if kind != "code":
            translatable_positions.append(len(blocks) - 1)
            translatable.append(text)
        if len(blocks) >= 140:
            break
    if not blocks:
        raise RuntimeError("README 内容为空")

    localized, _providers = translate_texts(translatable)
    for position, text in zip(translatable_positions, localized):
        blocks[position]["text"] = text
    title = next((block["text"] for block in blocks if block["type"] == "heading"), url.rstrip("/").split("/")[-1])
    return {
        "title": title,
        "blocks": blocks,
        "url": url,
        "language": "zh-CN",
        "translationProvider": translation_provider(),
    }


def scrape_image(url, referer=""):
    response = DynamicFetcher.fetch(
        url,
        google_search=not bool(referer),
        extra_headers={"referer": referer} if referer else None,
        headless=True,
        real_chrome=True,
        disable_resources=False,
        network_idle=False,
        load_dom=False,
        timeout=45_000,
    )
    body = bytes(response.body)
    if not body:
        raise RuntimeError("Scrapling 未取得图片字节")
    content_type = str(response.headers.get("content-type") or "application/octet-stream").split(";")[0]
    return {
        "body": base64.b64encode(body).decode("ascii"),
        "contentType": content_type,
    }


def translate_payload(payload):
    records = payload.get("items", [])
    texts = []
    layout = []
    for record in records:
        title = compact(record.get("title"))
        summary = compact(record.get("summary"))
        layout.append((len(texts), len(texts) + 1))
        texts.extend((title, summary))
    translations, _providers = translate_texts(texts)
    output = []
    for record, (title_index, summary_index) in zip(records, layout):
        output.append(
            {
                **record,
                "title": translations[title_index],
                "summary": translations[summary_index],
            }
        )
    return {
        "items": output,
        "language": "zh-CN",
        "translationProvider": translation_provider(),
    }


def batch_translate(texts):
    """批量翻译任意文本数组，返回翻译后的数组及每条实际使用的翻译引擎。"""
    translated, providers = translate_texts(texts)
    return {
        "translations": translated,
        "providers": providers,
        "language": "zh-CN",
        "translationProvider": translation_provider(),
    }


def batch_readme(urls):
    """批量抓取多个仓库的 README，复用同一个 Chrome 会话。"""
    results = []
    with DynamicSession(**CHROME_OPTIONS, max_pages=1) as session:
        for url in urls:
            normalized = url.rstrip("/")
            try:
                page = session.fetch(
                    normalized,
                    wait=800,
                    wait_selector="article.markdown-body",
                    **{key: value for key, value in CHROME_OPTIONS.items() if key in {"disable_resources", "network_idle", "timeout"}},
                )
                containers = page.css("article.markdown-body") or page.css(".markdown-body")
                if not containers:
                    results.append({"url": normalized, "error": "no readme"})
                    continue
                container = containers[0]
                blocks = []
                translatable = []
                translatable_positions = []
                total_length = 0
                for element in container.css("h1, h2, h3, p, li, pre"):
                    tag = str(getattr(element, "tag", "") or "").lower()
                    kind = "code" if tag == "pre" else "heading" if tag in {"h1", "h2", "h3"} else "list" if tag == "li" else "paragraph"
                    text = compact(element.get_all_text(separator="\n" if kind == "code" else " ", strip=True))
                    if not text or (kind != "code" and len(text) < 2):
                        continue
                    text = text[:5000] if kind == "code" else text[:1800]
                    if total_length + len(text) > 60_000:
                        break
                    block = {"type": kind, "text": text}
                    blocks.append(block)
                    total_length += len(text)
                    if kind != "code":
                        translatable_positions.append(len(blocks) - 1)
                        translatable.append(text)
                    if len(blocks) >= 140:
                        break
                if not blocks:
                    results.append({"url": normalized, "error": "empty"})
                    continue
                localized, _providers = translate_texts(translatable)
                for position, text in zip(translatable_positions, localized):
                    blocks[position]["text"] = text
                title = next((block["text"] for block in blocks if block["type"] == "heading"), normalized.rstrip("/").split("/")[-1])
                results.append({
                    "title": title,
                    "blocks": blocks,
                    "url": normalized,
                    "language": "zh-CN",
                    "translationProvider": translation_provider(),
                })
            except Exception as exc:
                results.append({"url": normalized, "error": str(exc)})
    return {"results": results}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = json.loads(sys.stdin.read() or "{}")
    if mode == "github":
        result = scrape_github()
    elif mode == "music":
        result = scrape_music()
    elif mode == "article":
        result = scrape_article(payload["url"])
    elif mode == "readme":
        result = scrape_readme(payload["url"])
    elif mode == "translate":
        result = translate_payload(payload)
    elif mode == "batch_translate":
        result = batch_translate(payload.get("texts", []))
    elif mode == "batch_readme":
        result = batch_readme(payload.get("urls", []))
    elif mode == "image":
        result = scrape_image(payload["url"], payload.get("referer", ""))
    else:
        raise RuntimeError(f"未知 Scrapling 模式：{mode}")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        sys.exit(1)
