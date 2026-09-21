import httpx
import json
import os
import time
from datetime import date
from app.config import settings
from app.services.market_context import _ensure, _read, _write

FAMILY_SEARCH_TERMS = {
    "AUTOMOTIVE":        "automotive parts accessories market demand supply",
    "GROCERY I":         "grocery retail food supply demand market",
    "GROCERY II":        "specialty grocery food products market",
    "BEVERAGES":         "beverages drinks market demand consumer",
    "ELECTRONICS":       "electronics technology consumer demand market",
    "CLEANING":          "cleaning products household supply market",
    "PERSONAL CARE":     "personal care beauty products retail demand",
    "HOME APPLIANCES":   "home appliances market demand consumer",
    "CLOTHING":          "clothing fashion retail market demand",
    "HARDWARE":          "hardware tools market supply demand",
    "SCHOOL AND OFFICE SUPPLIES": "office school supplies market demand",
    "FROZEN FOODS":      "frozen food retail demand market supply",
    "DAIRY":             "dairy products market supply demand",
    "PRODUCE":           "fresh produce supply chain demand market",
    "MEATS":             "meat protein market supply demand",
    "SEAFOOD":           "seafood market supply demand",
    "BREAD/BAKERY":      "bakery bread retail market demand",
    "POULTRY":           "poultry market supply demand",
    "EGGS":              "eggs poultry market supply demand",
    "BOOKS":             "books publishing retail market demand",
    "BABY CARE":         "baby care products market demand supply",
    "PET SUPPLIES":      "pet supplies market demand consumer",
    "SPORTS AND TRAVEL": "sports travel equipment market demand",
    "TOYS AND GAMES":    "toys games retail market demand consumer",
    "CELEBRATION":       "celebration party supplies retail demand",
    "HOME AND KITCHEN":  "home kitchen products market demand",
    "LADIESWEAR":        "women fashion retail market demand",
    "LINGERIE":          "lingerie intimate apparel market demand",
    "PLAYERS AND ELECTRONICS": "consumer electronics players market demand",
    "MAGAZINES":         "media publishing magazines market demand",
    "STATIONERY":        "stationery office supplies market demand",
    "HOME CARE":         "home care products retail market demand",
    "LIQUOR,WINE,BEER":  "alcohol beverages wine beer market demand",
    "DELI":              "deli prepared foods retail market",
    "LAWN AND GARDEN":   "lawn garden outdoor market demand",
    "BEAUTY":            "beauty cosmetics skincare market demand",
    "PREPARED FOODS":    "prepared meals food retail market demand",
}


def fetch_market_news_detailed(product_name: str, product_family: str) -> dict:
    """
    Recent market news from NewsAPI, as both the LLM prompt blob and the
    structured headlines behind it.

    The structured form is what lets the UI show which articles actually drove
    a reading, instead of asking the user to trust a number.

    Cache key is DATE + FAMILY so the same family on the same day always gets
    the same headlines — a stable input all day.
    """
    empty = {"text": "", "headlines": [], "query_used": "", "status": "no_key"}

    if not settings.NEWS_API_KEY:
        print("[News] NEWS_API_KEY not set — skipping")
        return empty

    today_str = date.today().strftime("%Y%m%d")
    cache_key = f"newsdet_{today_str}_{product_family.upper().replace(' ', '_')}"
    cached = _read(cache_key, ttl=86400)
    if cached is not None:
        print(f"[News] Cached news for {product_family} ({today_str})")
        return cached

    url = "https://newsapi.org/v2/everything"
    headers = {"X-Api-Key": settings.NEWS_API_KEY}
    family_terms = FAMILY_SEARCH_TERMS.get(product_family.upper(), f"{product_family} market demand")

    queries = [
        f"{product_name} market demand supply",
        family_terms,
        f"{product_family} retail market trend",
        "global supply chain demand inventory market",
    ]

    articles, query_used, status = [], "", "no_results"
    with httpx.Client(timeout=10) as client:
        for query in queries:
            try:
                resp = client.get(url, headers=headers, params={
                    "q": query,
                    "sortBy": "publishedAt",
                    "pageSize": 5,
                    "language": "en",
                })
                data = resp.json()
                if data.get("status") == "ok" and data.get("articles"):
                    articles = data["articles"]
                    query_used = query
                    status = "ok"
                    print(f"[News] Got {len(articles)} articles for query: {query!r}")
                    break
                if data.get("status") == "error":
                    print(f"[News] API error: {data.get('code')} {data.get('message')}")
                    status = f"error: {data.get('code')}"
            except Exception as e:
                print(f"[News] Query '{query}' failed: {e}")
                status = "request_failed"

    if not articles:
        print(f"[News] No news found for '{product_name}' ({product_family})")
        return {"text": "", "headlines": [], "query_used": query_used, "status": status}

    headlines, lines = [], [f"Latest market news for {product_name} ({product_family}):\n"]
    for article in articles[:5]:
        title = article.get("title") or ""
        desc = article.get("description") or ""
        if not title or "[Removed]" in title:
            continue
        headlines.append({
            "title": title,
            "description": "" if "[Removed]" in desc else desc,
            "source": (article.get("source") or {}).get("name", ""),
            "published_at": article.get("publishedAt", ""),
            "url": article.get("url", ""),
        })
        lines.append(f"• {title}")
        if desc and "[Removed]" not in desc:
            lines.append(f"  {desc}")

    result = {
        "text": "\n".join(lines),
        "headlines": headlines,
        "query_used": query_used,
        "status": "ok" if headlines else "no_usable_articles",
    }
    _write(cache_key, result)
    return result


def fetch_market_news(product_name: str, product_family: str) -> str:
    """Prompt-blob form, for callers that only need the text."""
    return fetch_market_news_detailed(product_name, product_family)["text"]
