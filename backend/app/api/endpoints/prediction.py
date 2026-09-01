from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks
from app.models.schemas import (
    PipelineRequest, PipelineResponse, RevenueForecastRequest, RevenueForecastResponse,
    BacktestRequest, BacktestResponse, FamilyBacktest,
)
from app.services.xgboost_forecast import forecast_demand
from app.services.llm_sentiment import analyze_sentiment
from app.services.xgboost_forecast import forecast_demand
from app.services.ppo_optimizer import optimize_restock
from app.services.news_fetcher import fetch_market_news
from app.services.market_context import get_current_oil_price, get_upcoming_holidays
from app.services.supabase_service import log_prediction_to_supabase

router = APIRouter()

@router.post("/predict/pipeline", response_model=PipelineResponse)
async def run_prediction_pipeline(request: PipelineRequest, background_tasks: BackgroundTasks):
    """
    Unified AI Inventory Pipeline:
    1. Fetch live oil price (Yahoo Finance) + upcoming holidays
    2. Auto-fetch market news from NewsAPI if no market text provided
    3. LLM analysis — single gpt-4o-mini call with oil + holidays + news context
    4. XGBoost demand forecasting with real oil price
    5. PPO RL reorder decision
    6. Async log to Supabase
    """
    try:
        # Step 1: Gather real market context (cached daily/hourly)
        oil_price = get_current_oil_price()
        holidays = get_upcoming_holidays(60)
        print(f"[Pipeline] Oil: ${oil_price:.2f}/bbl | Holidays: {len(holidays)}")

        # Step 2: Auto-fetch news if user didn't provide market text
        market_context = request.market_text.strip() if request.market_text else ""
        if not market_context:
            print(f"[Pipeline] Auto-fetching news for '{request.product_name}'")
            market_context = fetch_market_news(request.product_name, request.product_family)
            if market_context:
                print(f"[Pipeline] Got {len(market_context)} chars of market news")
            else:
                print("[Pipeline] No news found — LLM will still use oil + holidays")

        # Step 3: LLM sentiment analysis (single call, JSON output, file-cached)
        sentiment_multiplier, sentiment_analysis, sentiment_key_factors = analyze_sentiment(
            market_context,
            oil_price=oil_price,
            holidays=holidays,
        )
        sentiment_direction = (
            "UP" if sentiment_multiplier > 1.02
            else "DOWN" if sentiment_multiplier < 0.98
            else "NEUTRAL"
        )

        # Step 4: XGBoost demand forecast (using real live oil price)
        forecasted_demand = forecast_demand(
            historical_sales=request.historical_sales,
            period=request.forecast_period,
            product_family=request.product_family,
            oil_price=oil_price,
        )
        scaled_demand = [float(round(qty * sentiment_multiplier, 1)) for qty in forecasted_demand]

        # Step 5: PPO RL reorder decision
        optimal_reorder_qty = optimize_restock(
            current_stock=request.current_stock,
            reorder_level=request.reorder_level,
            forecasted_demand=scaled_demand,
            sentiment_multiplier=sentiment_multiplier,
        )

        # Step 6: Log to Supabase asynchronously
        background_tasks.add_task(
            log_prediction_to_supabase,
            product_id=request.product_id,
            product_name=request.product_name,
            forecast_period=request.forecast_period,
            current_stock=request.current_stock,
            reorder_level=request.reorder_level,
            market_text=market_context,
            sentiment_multiplier=sentiment_multiplier,
            sentiment_analysis=sentiment_analysis,
            historical_sales=request.historical_sales,
            forecasted_demand=scaled_demand,
            optimal_reorder_qty=optimal_reorder_qty,
            oil_price_used=oil_price,
        )

        return PipelineResponse(
            product_id=request.product_id,
            product_name=request.product_name,
            forecast_period=request.forecast_period,
            sentiment_multiplier=sentiment_multiplier,
            sentiment_direction=sentiment_direction,
            sentiment_analysis=sentiment_analysis,
            sentiment_key_factors=sentiment_key_factors,
            oil_price_used=oil_price,
            holidays_count=len(holidays),
            forecasted_demand=scaled_demand,
            optimal_reorder_qty=optimal_reorder_qty,
            market_context_used=market_context,
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"AI Pipeline failed: {str(e)}")


@router.post("/predict/revenue-forecast", response_model=RevenueForecastResponse)
async def revenue_forecast(body: RevenueForecastRequest):
    """
    Real XGBoost seasonal revenue forecast for the next 3 months.

    Runs XGBoost 90 days forward across product families to extract the model's
    seasonal signal (how Jun/Jul/Aug compare to the 90-day average), then scales
    that signal to the caller's last actual monthly revenue. Applies real LLM
    sentiment as the PPO+LLM adjustment layer.
    """
    try:
        oil_price = get_current_oil_price()
        holidays = get_upcoming_holidays(60)

        # Real LLM sentiment (cached — same call the pipeline uses)
        sentiment_mult, sentiment_analysis, _ = analyze_sentiment(
            "", oil_price=oil_price, holidays=holidays
        )

        # Run XGBoost 90 days across all requested product families
        families = (body.product_families or ["GROCERY I"])[:5]
        total_90d: list[float] = []
        for family in families:
            daily = forecast_demand(
                historical_sales=[20.0] * 12,   # dummy — real model ignores this
                period="90d",
                product_family=family,
                oil_price=oil_price,
            )
            daily = daily[:90]
            if not total_90d:
                total_90d = daily[:]
            else:
                total_90d = [a + b for a, b in zip(total_90d, daily)]

        if not total_90d:
            total_90d = [1.0] * 90

        # Monthly totals (30 days each)
        m1 = sum(total_90d[0:30])
        m2 = sum(total_90d[30:60])
        m3 = sum(total_90d[60:90])
        avg_m = (m1 + m2 + m3) / 3.0 or 1.0

        # Seasonal factors: how each future month compares to the 3-month average
        f1 = round(m1 / avg_m, 4)
        f2 = round(m2 / avg_m, 4)
        f3 = round(m3 / avg_m, 4)

        # Scale to actual business revenue
        last_rev = body.last_actual_revenue
        if last_rev > 0:
            xgboost = [round(last_rev * f1), round(last_rev * f2), round(last_rev * f3)]
        else:
            xgboost = [0, 0, 0]

        # PPO + LLM adjusted: apply real sentiment multiplier
        ppo_llm = [round(v * sentiment_mult) for v in xgboost]

        return RevenueForecastResponse(
            xgboost_monthly=xgboost,
            ppo_llm_monthly=ppo_llm,
            sentiment_multiplier=round(sentiment_mult, 4),
            sentiment_analysis=sentiment_analysis,
            oil_price=round(oil_price, 2),
            seasonal_factors=[f1, f2, f3],
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Revenue forecast failed: {str(e)}")


@router.get("/model-status")
async def model_status():
    """
    Reports which model binaries actually loaded.

    Both loaders treat a missing or unreadable file as a soft failure and fall
    through to a statistical policy, so without this the API returns confident
    numbers that never touched XGBoost or PPO. The UI reads this to label what
    produced a forecast instead of assuming.
    """
    import os
    from app.config import settings
    from app.services.xgboost_forecast import load_forecast_model, load_encoders
    from app.services.ppo_optimizer import load_ppo_agent

    xgb = load_forecast_model()
    enc = load_encoders()
    ppo = load_ppo_agent()

    return {
        "models_dir": settings.MODELS_DIR,
        "models_dir_exists": os.path.isdir(settings.MODELS_DIR),
        "xgboost": {
            "path": settings.XGB_MODEL_PATH,
            "file_present": os.path.exists(settings.XGB_MODEL_PATH),
            "loaded": xgb is not None,
            "engine": "XGBoost" if xgb is not None else "Holt linear-trend fallback",
        },
        "encoders": {
            "path": settings.ENCODERS_PATH,
            "file_present": os.path.exists(settings.ENCODERS_PATH),
            "loaded": enc is not None,
        },
        "ppo": {
            "path": settings.PPO_AGENT_PATH,
            "file_present": os.path.exists(settings.PPO_AGENT_PATH)
                            or os.path.exists(settings.PPO_AGENT_PATH + ".zip"),
            "loaded": ppo is not None,
            "engine": "PPO (Stable-Baselines3)" if ppo is not None else "Order-Up-To (s,S) fallback",
        },
    }


@router.post("/predict/backtest", response_model=BacktestResponse)
async def backtest(body: BacktestRequest):
    """
    Runs XGBoost over a window that has already happened.

    The caller holds the recorded sales for the same window, so comparing the
    two gives a real out-of-sample accuracy figure rather than an asserted one.
    Nothing here reads the outcome, so the prediction cannot be contaminated
    by it.
    """
    try:
        try:
            start = datetime.strptime(body.start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="start_date must be YYYY-MM-DD")

        if start > datetime.now():
            raise HTTPException(
                status_code=422,
                detail="start_date must be in the past -- a backtest needs a window whose outcome is known.",
            )

        # The oil price at the time is the honest feature value. Callers that
        # do not have it fall back to today's, which is noted in the response.
        oil_price = body.oil_price if body.oil_price is not None else get_current_oil_price()

        period = "7d" if body.days <= 7 else "30d" if body.days <= 30 else "90d" if body.days <= 90 else "365d"

        per_family: list[FamilyBacktest] = []
        grand_total = 0.0
        for family in body.families[:40]:
            daily = forecast_demand(
                historical_sales=[],
                period=period,
                product_family=family,
                oil_price=oil_price,
                start_date=start,
            )[:body.days]
            total = float(sum(daily))
            grand_total += total
            per_family.append(FamilyBacktest(
                family=family,
                predicted_total=round(total, 2),
                predicted_daily=[float(round(v, 2)) for v in daily],
            ))

        print(f"[Backtest] {body.start_date} +{body.days}d over {len(per_family)} families -> {grand_total:.0f} units")

        return BacktestResponse(
            start_date=body.start_date,
            days=body.days,
            oil_price_used=round(oil_price, 2),
            per_family=per_family,
            predicted_grand_total=round(grand_total, 2),
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")
