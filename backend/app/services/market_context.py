import httpx
import json
import os
import re
import time
import hashlib
import tempfile
from datetime import date, timedelta
from app.config import settings

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


OIL_FALLBACK = 78.50

# A state holiday counts as a national demand event once this share of the
# country observes it. Deepavali (15 of 16 Malaysian states) clears it; a single
# state's royal birthday does not.
MIN_HOLIDAY_COVERAGE = 0.5


def get_oil_context() -> dict:
    """
    Live WTI crude, plus the context needed to actually read it.

    A price on its own carries almost no demand information. $93 is alarming if
    oil was $78 last month and unremarkable if it has sat at $93 all quarter —
    the *move* is what squeezes consumer spending, not the level.

    The previous implementation returned the bare price and the sentiment layer
    scored it against a fixed $90 threshold. Oil has traded $90-96 on every day
    this system has ever run, so every single prediction took the same "above
    $90" penalty and the multiplier never moved off ~0.92. A constant is not a
    signal. This returns the price next to its own trailing average and recent
    change so the deviation can be scored instead of the level.

    Cached for an hour. On failure it reports a neutral context rather than a
    pessimistic one: not knowing the oil price is not evidence of weak demand.
    """
    cached = _read("oil_ctx", ttl=3600)
    if cached is not None:
        print(f"[Oil] Cached: ${cached['price']:.2f} ({cached['pct_vs_avg']:+.1f}% vs 90d avg)")
        return cached

    for url in [
        "https://query1.finance.yahoo.com/v8/finance/chart/CL=F",
        "https://query2.finance.yahoo.com/v8/finance/chart/CL=F",
    ]:
        try:
            with httpx.Client(timeout=12) as client:
                resp = client.get(
                    url,
                    params={"interval": "1d", "range": "6mo"},
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                )
                result = resp.json()["chart"]["result"][0]
                closes = [c for c in result["indicators"]["quote"][0]["close"] if c is not None]
                if len(closes) < 10:
                    raise ValueError(f"only {len(closes)} closes returned")

                price = float(result["meta"].get("regularMarketPrice") or closes[-1])
                window = closes[-90:]
                avg_90d = sum(window) / len(window)
                pct_vs_avg = ((price / avg_90d) - 1) * 100 if avg_90d else 0.0
                pct_30d = ((price / closes[-31]) - 1) * 100 if len(closes) >= 31 else 0.0

                ctx = {
                    "price": round(price, 2),
                    "avg_90d": round(avg_90d, 2),
                    "pct_vs_avg": round(pct_vs_avg, 2),
                    "pct_30d": round(pct_30d, 2),
                    "trend": "RISING" if pct_30d > 3 else "FALLING" if pct_30d < -3 else "STABLE",
                    "low_6mo": round(min(closes), 2),
                    "high_6mo": round(max(closes), 2),
                    "source": "Yahoo Finance (CL=F)",
                }
                _write("oil_ctx", ctx)
                print(f"[Oil] Live: ${price:.2f} | 90d avg ${avg_90d:.2f} | {pct_vs_avg:+.1f}% vs avg | 30d {pct_30d:+.1f}%")
                return ctx
        except Exception as e:
            print(f"[Oil] {url} failed: {e}")

    print("[Oil] Unreachable — reporting a neutral context")
    return {
        "price": OIL_FALLBACK,
        "avg_90d": OIL_FALLBACK,
        "pct_vs_avg": 0.0,
        "pct_30d": 0.0,
        "trend": "UNKNOWN",
        "low_6mo": OIL_FALLBACK,
        "high_6mo": OIL_FALLBACK,
        "source": "unavailable — neutral fallback",
    }


def get_current_oil_price() -> float:
    """Just the price, for the XGBoost `dcoilwtico` feature."""
    return float(get_oil_context()["price"])


def get_upcoming_holidays(days_ahead: int = 60, countries: list | None = None) -> list:
    """
    Upcoming public holidays in the next N days, for the countries this
    business actually sells in.

    This used to be hardcoded to US + UK, so a retailer operating on Malaysia
    time was having "Columbus Day in 21 days" fed to its demand model as a
    reason to stock up. A holiday in a country you do not trade in is not a
    demand signal, it is noise with a confident label on it.

    Countries come from MARKET_COUNTRIES (comma-separated ISO codes).
    Cached per calendar day.
    """
    if countries is None:
        countries = settings.market_countries()

    today = date.today()
    # v2: the cached shape changed (state-level coverage added), so the key has
    # to change with it or a stale entry outlives the code that wrote it.
    cache_key = f"holidays_v2_{today.strftime('%Y%m%d')}_{'-'.join(countries)}"
    cached = _read(cache_key, ttl=86400)
    if cached is not None:
        return cached

    result = []
    try:
        import holidays as hol_lib
        future = today + timedelta(days=days_ahead)
        years = list({today.year, future.year})

        for country_code in countries:
            try:
                national = hol_lib.country_holidays(country_code, years=years)
                subdivs = list(getattr(national, "subdivisions", ()) or ())

                # Federal list only is not enough. Malaysia's biggest retail
                # events -- Deepavali among them -- are state holidays observed
                # almost everywhere, and a national-only lookup returns nothing
                # for them. So state holidays count too, but only when most of
                # the country observes them: a single state's royal birthday
                # (1 of 16) is not a national demand driver, while Deepavali
                # (15 of 16) plainly is.
                coverage = {}
                for sub in subdivs:
                    try:
                        for h_date, h_name in hol_lib.country_holidays(
                            country_code, subdiv=sub, years=years
                        ).items():
                            if today < h_date <= future:
                                coverage.setdefault((h_date, h_name), set()).add(sub)
                    except Exception:
                        continue

                seen_national = set()
                for h_date, h_name in sorted(national.items()):
                    if today < h_date <= future:
                        seen_national.add((h_date, h_name))
                        result.append({
                            "name": h_name.strip(),
                            "country": country_code,
                            "date": h_date.strftime("%b %d, %Y"),
                            "days_until": (h_date - today).days,
                            "scope": "national",
                        })

                total_subs = len(subdivs)
                for (h_date, h_name), subs in coverage.items():
                    if (h_date, h_name) in seen_national or not total_subs:
                        continue
                    ratio = len(subs) / total_subs
                    if ratio >= MIN_HOLIDAY_COVERAGE:
                        result.append({
                            "name": h_name.strip(),
                            "country": country_code,
                            "date": h_date.strftime("%b %d, %Y"),
                            "days_until": (h_date - today).days,
                            "scope": f"observed in {len(subs)} of {total_subs} states",
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
