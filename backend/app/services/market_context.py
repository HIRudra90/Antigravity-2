import httpx
import json
import os
import re
import time
import hashlib
import tempfile
from datetime import date, timedelta

_CACHE_DIR = os.path.join(tempfile.gettempdir(), "inventiq_cache")


def _ensure():
    os.makedirs(_CACHE_DIR, exist_ok=True)


def _safe_key(key: str) -> str:
    """
    Cache keys are built from product family names, which are free text and
    contain characters that are not legal in a filename -- 'BREAD/BAKERY'
    turned into a nested path whose parent directory does not exist, so the
    write raised FileNotFoundError and took the whole prediction down with it.
    Anything outside [A-Za-z0-9._-] becomes an underscore.
    """
    return re.sub(r"[^A-Za-z0-9._-]", "_", key)


def _path_for(key: str) -> str:
    return os.path.join(_CACHE_DIR, f"{_safe_key(key)}.json")


def _read(key: str, ttl: int):
    _ensure()
    try:
        with open(_path_for(key)) as f:
            data = json.load(f)
        if time.time() - data["ts"] < ttl:
            return data["value"]
    except Exception:
        pass
    return None


def _write(key: str, value):
    # The cache is an optimisation, never a correctness requirement, so a
    # failure here must not propagate into the caller's prediction.
    try:
        _ensure()
        with open(_path_for(key), "w") as f:
            json.dump({"ts": time.time(), "value": value}, f)
    except Exception as e:
        print(f"[Cache] Write failed for key {key!r}: {e}")


def get_current_oil_price() -> float:
    """
    Fetch live WTI crude oil price from Yahoo Finance.
    Cached for 1 hour. Returns $78.50 as fallback if unreachable.
    """
    cached = _read("oil_wti", ttl=3600)
    if cached is not None:
        print(f"[OilPrice] Cached: ${cached:.2f}/bbl")
        return float(cached)

    for url in [
        "https://query1.finance.yahoo.com/v8/finance/chart/CL=F",
        "https://query2.finance.yahoo.com/v8/finance/chart/CL=F",
    ]:
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    url,
                    params={"interval": "1d", "range": "5d"},
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                )
                price = float(resp.json()["chart"]["result"][0]["meta"]["regularMarketPrice"])
                _write("oil_wti", price)
                print(f"[OilPrice] Live: ${price:.2f}/bbl")
                return price
        except Exception as e:
            print(f"[OilPrice] {url} failed: {e}")

    print("[OilPrice] Using fallback $78.50/bbl")
    return 78.50


def get_upcoming_holidays(days_ahead: int = 60) -> list:
    """
    Return upcoming public holidays in the next N days (US + UK).
    Cached per calendar day.
    """
    today = date.today()
    cache_key = f"holidays_{today.strftime('%Y%m%d')}"
    cached = _read(cache_key, ttl=86400)
    if cached is not None:
        return cached

    result = []
    try:
        import holidays as hol_lib
        future = today + timedelta(days=days_ahead)
        years = list({today.year, future.year})

        for country_code, country_label in [("US", "US"), ("GB", "UK")]:
            try:
                country_hols = hol_lib.country_holidays(country_code, years=years)
                for h_date, h_name in sorted(country_hols.items()):
                    if today < h_date <= future:
                        result.append({
                            "name": h_name,
                            "country": country_label,
                            "date": h_date.strftime("%b %d, %Y"),
                            "days_until": (h_date - today).days,
                        })
            except Exception as e:
                print(f"[Holidays] {country_code} failed: {e}")

        seen, deduped = set(), []
        for h in sorted(result, key=lambda x: x["days_until"]):
            if h["name"] not in seen:
                seen.add(h["name"])
                deduped.append(h)

        result = deduped[:8]
        _write(cache_key, result)

    except ImportError:
        print("[Holidays] 'holidays' package not installed")
    except Exception as e:
        print(f"[Holidays] Fetch failed: {e}")

    return result


def stable_hash(text: str) -> str:
    """Deterministic hash of a string (stable across Python restarts)."""
    return hashlib.md5(text.encode("utf-8", errors="replace")).hexdigest()[:10]
