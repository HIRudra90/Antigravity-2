import re
from openai import OpenAI
from app.config import settings


def _openrouter_client() -> OpenAI:
    """Returns an OpenAI client pointed at OpenRouter — same library, different base URL."""
    return OpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=settings.OPENROUTER_BASE_URL,
    )


def get_business_insight_llm(market_text: str) -> str:
    """
    Mirrors get_business_insight_llm from Colab (cell 15f2ca5e).
    Model: openai/gpt-4o-mini via OpenRouter.
    Returns a business insight summary string.
    """
    client = _openrouter_client()
    response = client.chat.completions.create(
        model="openai/gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a business analyst specializing in inventory and retail. "
                    "Analyze the provided market text and give a concise business insight "
                    "about how it affects inventory demand."
                ),
            },
            {
                "role": "user",
                "content": f"Market information:\n{market_text}\n\nProvide a business insight.",
            },
        ],
        max_tokens=300,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


def get_sentiment_from_text_insights(insight_text: str) -> tuple[float, str]:
    """
    Mirrors get_sentiment_from_text_insights from Colab (cell f0888e81).
    Model: openai/gpt-3.5-turbo via OpenRouter.
    Returns (sentiment_multiplier, explanation).
    """
    client = _openrouter_client()
    response = client.chat.completions.create(
        model="openai/gpt-3.5-turbo",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a sentiment analyst for inventory management. "
                    "Analyze the text and output exactly:\n"
                    "MULTIPLIER: <float between 0.70 and 1.30>\n"
                    "ANALYSIS: <2-3 sentence explanation>\n"
                    "Where 1.00 is neutral, above 1.00 means increased demand, below means decreased demand."
                ),
            },
            {
                "role": "user",
                "content": insight_text,
            },
        ],
        max_tokens=200,
        temperature=0.0,
    )

    response_text = response.choices[0].message.content.strip()

    mult_match = re.search(r"MULTIPLIER:\s*([0-9.]+)", response_text, re.IGNORECASE)
    analysis_match = re.search(r"ANALYSIS:\s*(.*)", response_text, re.IGNORECASE | re.DOTALL)

    multiplier = 1.00
    if mult_match:
        multiplier = float(mult_match.group(1))
        multiplier = max(0.70, min(1.30, multiplier))

    analysis = response_text
    if analysis_match:
        analysis = analysis_match.group(1).strip()

    return multiplier, analysis


def analyze_sentiment(market_text: str) -> tuple[float, str]:
    """
    Full pipeline matching Colab:
      1. get_business_insight_llm (gpt-4o-mini)  → structured business insight
      2. get_sentiment_from_text_insights (gpt-3.5-turbo) → multiplier + analysis
    Falls back to keyword heuristic if OpenRouter key is missing or call fails.
    """
    if not market_text or not market_text.strip():
        return 1.00, "No market text provided. Using baseline demand parameters."

    has_openrouter = (
        settings.OPENROUTER_API_KEY
        and not settings.OPENROUTER_API_KEY.startswith("your_")
        and len(settings.OPENROUTER_API_KEY) > 10
    )

    if has_openrouter:
        try:
            # Step 1: generate structured business insight (gpt-4o-mini)
            business_insight = get_business_insight_llm(market_text)

            # Step 2: score that insight for sentiment (gpt-3.5-turbo)
            multiplier, analysis = get_sentiment_from_text_insights(business_insight)

            return multiplier, analysis

        except Exception as e:
            print(f"OpenRouter call failed: {e}. Falling back to keyword heuristic.")

    # Keyword heuristic fallback (no API key needed)
    text_lower = market_text.lower()
    positives = ["growth", "boom", "surge", "increase", "shortage", "high demand",
                 "expansion", "popular", "success", "soaring", "bullish"]
    negatives = ["recession", "decline", "decrease", "low demand", "surplus",
                 "slowing", "drop", "slump", "bearish", "oversupply"]

    pos_count = sum(1 for w in positives if w in text_lower)
    neg_count = sum(1 for w in negatives if w in text_lower)
    score = pos_count - neg_count

    if score > 0:
        multiplier = round(1.0 + min(0.30, score * 0.08), 2)
        analysis = (
            f"Heuristic agent detected {pos_count} positive signal(s): "
            f"{[w for w in positives if w in text_lower]}. "
            f"Demand increase expected."
        )
    elif score < 0:
        multiplier = round(1.0 - min(0.30, abs(score) * 0.08), 2)
        analysis = (
            f"Heuristic agent detected {neg_count} negative signal(s): "
            f"{[w for w in negatives if w in text_lower]}. "
            f"Conservative inventory levels advised."
        )
    else:
        multiplier = 1.00
        analysis = "Heuristic agent found neutral signals. No demand deviation expected."

    return multiplier, analysis
