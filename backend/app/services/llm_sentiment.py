"""
Market demand sentiment.

Design note — why this is not one big LLM call any more
------------------------------------------------------
The previous version handed the oil price, the holiday list and the news to
gpt-4o-mini and asked it to return a single multiplier. Two things went wrong:

1. The prompt scored oil against a fixed $90 threshold. WTI has traded $90-96
   on every day this system has run, so every prediction took the same "oil is
   high" penalty and the multiplier sat at ~0.92 forever. 76 stored forecasts
   held just five distinct values. A constant is not a signal.

2. The arithmetic was unauditable. The model returned a number and a paragraph,
   and nothing could be traced back to an input.

So the scoring is now deterministic and decomposed — oil and holidays are
arithmetic over real measurements — and the LLM is used for the one part that
genuinely needs language understanding: reading headlines. Each component
reports its own contribution, so the multiplier can be explained line by line.
"""

import re
import json
from datetime import date
from openai import OpenAI
from app.config import settings
from app.services.market_context import _read, _write, stable_hash

# Per-component caps. Oil and news are comparable in size; a holiday inside a
# fortnight is the single strongest short-term driver in retail.
OIL_CAP = 0.08
NEWS_CAP = 0.08
HOLIDAY_CAP = 0.12

MULTIPLIER_FLOOR = 0.70
MULTIPLIER_CEIL = 1.30


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _oil_component(oil: dict) -> dict:
    """
    Score oil by how far it has moved, not by where it sits.

    Blends two horizons: where the price sits against its own 90-day average
    (the persistent squeeze) and how far it has moved in 30 days (the shock).
    Oil parked at a high-but-steady level scores ~0, which is the entire point
    — that is a cost base the market has already absorbed, not news.
    """
    pct_vs_avg = float(oil.get("pct_vs_avg") or 0.0)
    pct_30d = float(oil.get("pct_30d") or 0.0)
    signal = 0.6 * pct_vs_avg + 0.4 * pct_30d

    # Rising oil squeezes discretionary spend, so the contribution is inverted.
    contribution = _clamp(-signal * 0.005, -OIL_CAP, OIL_CAP)

    price = float(oil.get("price") or 0.0)
    avg = float(oil.get("avg_90d") or 0.0)
    if abs(signal) < 2:
        detail = (f"${price:.2f}/bbl, in line with its 90-day average of ${avg:.2f} "
                  f"({pct_vs_avg:+.1f}%). A steady cost base, already priced in.")
    elif signal > 0:
        detail = (f"${price:.2f}/bbl — {pct_vs_avg:+.1f}% above its 90-day average of "
                  f"${avg:.2f} and {pct_30d:+.1f}% in 30 days. Rising fuel costs squeeze "
                  f"transport and discretionary spend.")
    else:
        detail = (f"${price:.2f}/bbl — {pct_vs_avg:+.1f}% below its 90-day average of "
                  f"${avg:.2f} and {pct_30d:+.1f}% in 30 days. Cheaper logistics support "
                  f"margins and consumer demand.")

    return {
        "label": "Oil price (WTI)",
        "detail": detail,
        "contribution": round(contribution, 4),
    }


def _holiday_component(holidays: list) -> dict:
    """
    Nearest relevant holiday only.

    Summing every holiday in a 60-day window let a dense calendar stack up an
    arbitrarily large boost. Retail demand pulls forward toward the next event;
    it does not add one lift per entry in the list.
    """
    if not holidays:
        return {
            "label": "Public holidays",
            "detail": f"No public holidays in the next 60 days for {', '.join(settings.market_countries())}.",
            "contribution": 0.0,
        }

    nearest = min(holidays, key=lambda h: h["days_until"])
    days = nearest["days_until"]

    if days <= 7:
        contribution, band = 0.10, "this week"
    elif days <= 14:
        contribution, band = 0.07, "within a fortnight"
    elif days <= 30:
        contribution, band = 0.04, "within the month"
    else:
        contribution, band = 0.015, "still over a month out"

    contribution = min(contribution, HOLIDAY_CAP)
    others = len(holidays) - 1
    detail = (f"{nearest['name']} ({nearest['country']}) in {days} days — {band}. "
              f"Pre-holiday buying lifts consumer goods.")
    if others > 0:
        detail += f" {others} more in the next 60 days."

    return {
        "label": "Public holidays",
        "detail": detail,
        "contribution": round(contribution, 4),
    }


def _openrouter_client() -> OpenAI:
    return OpenAI(api_key=settings.OPENROUTER_API_KEY, base_url=settings.OPENROUTER_BASE_URL)


def _has_llm_key() -> bool:
    key = settings.OPENROUTER_API_KEY
    return bool(key) and not key.startswith("your_") and len(key) > 10


def _parse_json(text: str) -> dict:
    """LLMs wrap JSON in prose and fences often enough that this must be robust."""
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    out = {}
    m = re.search(r'"news_score"\s*:\s*(-?[0-9.]+)', text)
    if m:
        out["news_score"] = float(m.group(1))
    m = re.search(r'"summary"\s*:\s*"([^"]{10,})"', text)
    if m:
        out["summary"] = m.group(1)
    return out


def _news_component(market_text: str) -> dict:
    """
    Read the headlines and score them from -1 (demand-destroying) to +1.

    This is the only part an LLM is actually better at than arithmetic, so it is
    the only part it does. The score is bounded and scaled here rather than in
    the prompt, which keeps a hallucinated number from moving the multiplier
    more than its share.

    Cached on the headline fingerprint alone. The old cache key mixed in the
    rounded oil price, so a $1 oil move threw away a still-valid reading of the
    news while a stale reading survived into the next day.
    """
    if not market_text or not market_text.strip():
        return {
            "label": "Market news",
            "detail": "No relevant headlines retrieved for this product family.",
            "contribution": 0.0,
            "score": None,
            "engine": "none",
        }

    fingerprint = stable_hash(market_text[:1200])
    cache_key = f"newsscore_{date.today().strftime('%Y%m%d')}_{fingerprint}"
    cached = _read(cache_key, ttl=86400)
    if cached is not None:
        return cached

    score, summary, engine = 0.0, "", "rules"

    if _has_llm_key():
        try:
            client = _openrouter_client()
            response = client.chat.completions.create(
                model="openai/gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a retail demand analyst. Read the headlines and judge their net "
                            "effect on near-term CONSUMER DEMAND for the product family described.\n\n"
                            "Return ONLY this JSON:\n"
                            '{"news_score": <float -1.0 to 1.0>, "summary": "<one or two sentences '
                            'citing the specific headlines that drove the score>"}\n\n'
                            "Scale: -1.0 demand collapse (recession, mass layoffs, collapsing consumer "
                            "confidence); -0.5 clearly negative; 0.0 routine or mixed coverage with no "
                            "demand implication; +0.5 clearly positive; +1.0 demand surge (shortages, "
                            "panic buying, stimulus).\n\n"
                            "Most business news is routine and deserves a score near 0.0. Reserve "
                            "scores beyond ±0.5 for headlines that plainly describe a demand shock. "
                            "Judge demand only — a company's share price is not consumer demand."
                        ),
                    },
                    {"role": "user", "content": market_text[:4000]},
                ],
                max_tokens=300,
                temperature=0.0,
            )
            parsed = _parse_json(response.choices[0].message.content.strip())
            score = _clamp(float(parsed.get("news_score", 0.0)), -1.0, 1.0)
            summary = parsed.get("summary", "") or ""
            engine = "gpt-4o-mini"
            print(f"[News] LLM score {score:+.2f}: {summary[:120]}")
        except Exception as e:
            print(f"[News] OpenRouter failed: {e} — falling back to keyword scoring")
            score, summary, engine = _keyword_score(market_text)
    else:
        score, summary, engine = _keyword_score(market_text)

    component = {
        "label": "Market news",
        "detail": summary or "Headlines retrieved but no clear demand signal.",
        "contribution": round(score * NEWS_CAP, 4),
        "score": round(score, 3),
        "engine": engine,
    }
    _write(cache_key, component)
    return component


def _keyword_score(market_text: str) -> tuple:
    """Fallback when the LLM is unavailable. Crude, and labelled as such."""
    lower = market_text.lower()
    positive = ["shortage", "surge", "high demand", "boom", "growth", "stimulus", "rebound"]
    negative = ["recession", "slump", "layoff", "downturn", "oversupply", "weak demand", "inflation"]
    pos = sum(1 for w in positive if w in lower)
    neg = sum(1 for w in negative if w in lower)
    if pos == neg:
        return 0.0, f"Keyword scan: {pos} positive and {neg} negative signals — no net direction.", "keywords"
    score = _clamp((pos - neg) * 0.25, -1.0, 1.0)
    return score, f"Keyword scan: {pos} positive vs {neg} negative demand signals.", "keywords"


def analyze_market(market_text: str, oil: dict, holidays: list) -> dict:
    """
    The full market reading: every component, its contribution, and the total.

    multiplier = 1.00 + oil + holidays + news, clamped to [0.70, 1.30].
    """
    components = [
        _oil_component(oil),
        _holiday_component(holidays),
        _news_component(market_text),
    ]

    total = sum(c["contribution"] for c in components)
    multiplier = round(_clamp(1.0 + total, MULTIPLIER_FLOOR, MULTIPLIER_CEIL), 4)
    direction = "UP" if multiplier > 1.02 else "DOWN" if multiplier < 0.98 else "NEUTRAL"

    movers = sorted(components, key=lambda c: abs(c["contribution"]), reverse=True)
    lead = movers[0]
    if abs(lead["contribution"]) < 0.005:
        analysis = (
            f"No component is currently pushing demand off its baseline, so the multiplier "
            f"sits at x{multiplier:.3f}. Oil is steady against its own 90-day average, and "
            f"neither the holiday calendar nor the news carries a demand signal."
        )
    else:
        analysis = (
            f"Demand multiplier x{multiplier:.3f} ({direction}). The largest mover is "
            f"{lead['label'].lower()} at {lead['contribution']:+.3f}: {lead['detail']} "
            f"Combined across all three inputs: {total:+.3f} against a 1.000 baseline."
        )

    return {
        "multiplier": multiplier,
        "direction": direction,
        "analysis": analysis,
        "key_factors": [f"{c['label']}: {c['detail']}" for c in components],
        "components": components,
        "total_adjustment": round(total, 4),
        "news_engine": components[2].get("engine", "none"),
    }


def analyze_sentiment(market_text: str, oil_price: float = 78.5, holidays: list = None) -> tuple:
    """
    Backwards-compatible tuple wrapper: (multiplier, analysis, key_factors).

    Accepts either the full oil context dict or a bare price. A bare price has
    no trailing average to compare against, so it scores as neutral on oil —
    deliberately, since a level alone is not evidence either way.
    """
    oil = oil_price if isinstance(oil_price, dict) else {
        "price": float(oil_price), "avg_90d": float(oil_price),
        "pct_vs_avg": 0.0, "pct_30d": 0.0, "trend": "UNKNOWN",
    }
    result = analyze_market(market_text, oil, holidays or [])
    return result["multiplier"], result["analysis"], result["key_factors"]
