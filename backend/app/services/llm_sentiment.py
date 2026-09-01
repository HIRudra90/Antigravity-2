import re
import json
from datetime import date
from openai import OpenAI
from app.config import settings
from app.services.market_context import _read, _write, stable_hash


def _openrouter_client() -> OpenAI:
    return OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL,
    )


def _parse_json(text: str) -> dict:
    """Robustly extract JSON from LLM response."""
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    result = {}
    m = re.search(r'"multiplier"\s*:\s*([0-9.]+)', text)
    if m:
        result["multiplier"] = float(m.group(1))
    m = re.search(r'"direction"\s*:\s*"(UP|DOWN|NEUTRAL)"', text, re.IGNORECASE)
    if m:
        result["direction"] = m.group(1).upper()
    kf = re.search(r'"key_factors"\s*:\s*\[(.*?)\]', text, re.DOTALL)
    if kf:
        result["key_factors"] = re.findall(r'"([^"]{10,})"', kf.group(1))
    m = re.search(r'"analysis"\s*:\s*"([^"]{15,})"', text)
    if m:
        result["analysis"] = m.group(1)
    return result


def analyze_sentiment(
    market_text: str,
    oil_price: float = 78.5,
    holidays: list = None,
) -> tuple:
    """
    Comprehensive market demand analysis using real oil price, upcoming holidays, and news.

    Returns: (multiplier: float, analysis: str, key_factors: list[str])

    Cache key: DATE + oil_price_rounded + news_fingerprint
    → Same product on the same day always returns the same result.
    """
    if holidays is None:
        holidays = []

    # Stable, deterministic cache key
    news_fp = stable_hash(market_text[:300]) if market_text else "nonews"
    oil_rounded = round(oil_price)
    cache_key = f"sentiment_{date.today().strftime('%Y%m%d')}_{oil_rounded}_{news_fp}"

    cached = _read(cache_key, ttl=86400)
    if cached:
        print(f"[Sentiment] Cached: multiplier={cached['multiplier']}")
        return cached["multiplier"], cached["analysis"], cached["key_factors"]

    # ── Build rich context ──────────────────────────────────────────
    context_parts = []

    if oil_price > 90:
        oil_signal = f"HIGH — above $90/bbl signals elevated transport and production costs, which typically suppresses consumer purchasing power"
    elif oil_price < 65:
        oil_signal = f"LOW — below $65/bbl reduces logistics costs and supports consumer demand"
    else:
        oil_signal = f"MODERATE — in the normal $65–$90 range, minimal impact on baseline demand"
    context_parts.append(f"OIL PRICE (WTI Crude, live): ${oil_price:.2f}/barrel\nSignal: {oil_signal}")

    if holidays:
        near = [h for h in holidays if h["days_until"] <= 30]
        far = [h for h in holidays if h["days_until"] > 30]
        hol_lines = []
        for h in near:
            hol_lines.append(f"• {h['name']} ({h['date']}, in {h['days_until']} days) ← NEAR TERM")
        for h in far:
            hol_lines.append(f"• {h['name']} ({h['date']}, in {h['days_until']} days)")
        context_parts.append("UPCOMING PUBLIC HOLIDAYS (next 60 days):\n" + "\n".join(hol_lines))
    else:
        context_parts.append("UPCOMING PUBLIC HOLIDAYS: None detected in the next 60 days.")

    if market_text and market_text.strip():
        context_parts.append(f"MARKET NEWS:\n{market_text.strip()}")
    else:
        context_parts.append("MARKET NEWS: No specific news available for this product family.")

    full_context = "\n\n".join(context_parts)

    # ── LLM Call ───────────────────────────────────────────────────
    has_key = (
        settings.OPENROUTER_API_KEY
        and not settings.OPENROUTER_API_KEY.startswith("your_")
        and len(settings.OPENROUTER_API_KEY) > 10
    )

    if has_key:
        try:
            client = _openrouter_client()
            response = client.chat.completions.create(
                model="openai/gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """You are a senior inventory demand analyst. Study the REAL market data below and output a demand multiplier with evidence-based reasoning.

Return ONLY valid JSON — no extra text, no markdown, just the JSON object:
{
  "multiplier": <float between 0.70 and 1.30>,
  "direction": "<UP|DOWN|NEUTRAL>",
  "key_factors": [
    "<specific finding from the data — quote actual numbers>",
    "<specific finding from the data — reference oil price or holiday or news>",
    "<specific finding from the data>"
  ],
  "analysis": "<2-3 sentences of concrete reasoning citing the actual oil price, the specific holidays, and the specific news provided. Do NOT be vague.>"
}

Multiplier guidelines (apply cumulatively):
- Baseline: 1.00
- Oil above $90/bbl: −0.04 to −0.08 (cost pressure reduces demand)
- Oil below $65/bbl: +0.03 to +0.06 (cost relief boosts demand)
- Major holiday within 14 days: +0.08 to +0.15 for consumer goods
- Major holiday 15–30 days away: +0.04 to +0.09
- Holiday 31–60 days away: +0.01 to +0.04
- Strong positive news (shortage, surge, high demand): +0.05 to +0.12
- Strong negative news (recession, oversupply, slump): −0.05 to −0.12
- Moderate/mixed signals: ±0.02 to 0.05
- ALWAYS reference actual values from the data in your key_factors and analysis""",
                    },
                    {"role": "user", "content": full_context},
                ],
                max_tokens=450,
                temperature=0.0,
            )

            raw = response.choices[0].message.content.strip()
            print(f"[Sentiment] LLM raw: {raw[:300]}")
            parsed = _parse_json(raw)

            multiplier = max(0.70, min(1.30, float(parsed.get("multiplier", 1.00))))
            direction = parsed.get("direction", "NEUTRAL").upper()
            key_factors = parsed.get("key_factors", [])
            analysis = parsed.get("analysis", "")

            if not key_factors:
                key_factors = [
                    f"Oil price: ${oil_price:.2f}/barrel ({oil_signal.split('—')[0].strip()})",
                    f"{len(holidays)} upcoming holidays detected in next 60 days",
                    "Market news analyzed for demand signals",
                ]
            if not analysis:
                analysis = f"Based on oil at ${oil_price:.2f}/bbl, {len(holidays)} upcoming holidays, and available market news."

            result = {
                "multiplier": multiplier,
                "direction": direction,
                "key_factors": key_factors,
                "analysis": analysis,
            }
            _write(cache_key, result)
            print(f"[Sentiment] LLM result: x{multiplier} ({direction})")
            return multiplier, analysis, key_factors

        except Exception as e:
            print(f"[Sentiment] OpenRouter failed: {e} — falling back to rules")

    # ── Rule-based fallback ────────────────────────────────────────
    return _rule_fallback(market_text, oil_price, holidays)


def _rule_fallback(market_text: str, oil_price: float, holidays: list) -> tuple:
    score = 0.0
    factors = []

    if oil_price > 90:
        score -= 0.06
        factors.append(f"Oil at ${oil_price:.2f}/bbl — above $90 signals elevated costs")
    elif oil_price < 65:
        score += 0.05
        factors.append(f"Oil at ${oil_price:.2f}/bbl — below $65 reduces transport costs")
    else:
        factors.append(f"Oil at ${oil_price:.2f}/bbl — moderate, normal demand impact")

    near = [h for h in holidays if h["days_until"] <= 30]
    if near:
        score += min(0.15, len(near) * 0.07)
        factors.append(f"{near[0]['name']} in {near[0]['days_until']} days — holiday demand spike expected")
    elif holidays:
        score += 0.03
        factors.append(f"{holidays[0]['name']} in {holidays[0]['days_until']} days — early pre-holiday build")

    if market_text:
        lower = market_text.lower()
        pos = sum(1 for w in ["growth", "surge", "increase", "shortage", "high demand", "boom"] if w in lower)
        neg = sum(1 for w in ["recession", "decline", "decrease", "low demand", "surplus", "slump"] if w in lower)
        if pos > neg:
            score += min(0.10, (pos - neg) * 0.04)
            factors.append(f"News shows positive demand signals ({pos} positive keywords)")
        elif neg > pos:
            score -= min(0.10, (neg - pos) * 0.04)
            factors.append(f"News shows negative demand signals ({neg} negative keywords)")
        else:
            factors.append("Market news shows mixed/neutral signals")

    multiplier = round(max(0.70, min(1.30, 1.0 + score)), 2)
    analysis = (
        f"Rule-based analysis (LLM unavailable). "
        f"Oil at ${oil_price:.2f}/bbl, {len(holidays)} upcoming holidays detected, "
        f"combined score: {score:+.2f} → demand multiplier x{multiplier}."
    )
    return multiplier, analysis, factors
