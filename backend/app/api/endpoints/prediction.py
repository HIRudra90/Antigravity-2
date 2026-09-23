import math
from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks
from app.models.schemas import (
    PipelineRequest, PipelineResponse, RevenueForecastRequest, RevenueForecastResponse,
    BacktestRequest, BacktestResponse, FamilyBacktest, MarketInsightResponse,
    DemandShapeResponse, FamilyWeight,
)
from app.services.xgboost_forecast import forecast_demand
from app.services.llm_sentiment import analyze_market
from app.services.ppo_optimizer import optimize_restock
from app.services.news_fetcher import fetch_market_news_detailed
from app.services.market_context import get_oil_context, get_current_oil_price, get_upcoming_holidays
from app.services.supabase_service import log_prediction_to_supabase

router = APIRouter()

@router.post("/predict/pipeline", response_model=PipelineResponse)
async def run_prediction_pipeline(request: PipelineRequest, background_tasks: BackgroundTasks):
    """
    Unified AI Inventory Pipeline:
    1. Fetch live oil price (Yahoo Finance) + upcoming holidays
    2. Auto-fetch market news from NewsAPI if no market text provided
    3. LLM analysis â€” single gpt-4o-mini call with oil + holidays + news context
    4. XGBoost demand forecasting with real oil price
    5. PPO RL reorder decision
    6. Async log to Supabase
    """
    try:
        # Step 1: Gather real market context (cached daily/hourly)
        oil = get_oil_context()
        oil_price = oil["price"]
        holidays = get_upcoming_holidays(60)
        print(f"[Pipeline] Oil: ${oil_price:.2f} ({oil['pct_vs_avg']:+.1f}% vs 90d) | Holidays: {len(holidays)}")

        # Step 2: Auto-fetch news if user didn't provide market text
        market_context = request.market_text.strip() if request.market_text else ""
        if not market_context:
            print(f"[Pipeline] Auto-fetching news for '{request.product_name}'")
            market_context = fetch_market_news_detailed(
                request.product_name, request.product_family
            )["text"]
            if market_context:
                print(f"[Pipeline] Got {len(market_context)} chars of market news")
            else:
                print("[Pipeline] No news found â€” scoring oil + holidays only")

        # Step 3: Decomposed market reading â€” deterministic oil/holiday scoring
        # plus an LLM read of the headlines.
        market = analyze_market(market_context, oil, holidays)
        sentiment_multiplier = market["multiplier"]
        sentiment_analysis = market["analysis"]
        sentiment_key_factors = market["key_factors"]
        sentiment_direction = market["direction"]

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
            sentiment_components=market["components"],
            oil_context=oil,
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"AI Pipeline failed: {str(e)}")


@router.post("/predict/revenue-forecast", response_model=RevenueForecastResponse)
async def revenue_forecast(body: RevenueForecastRequest):
    """
    Real XGBoost seasonal revenue forecast for the next 3 months.

    Two separate components, which is the point:

      LEVEL  a log-linear growth trend fitted to `revenue_history`, damped over
             the horizon and scaled by how well it fits. This is where the
             forecast's direction comes from.

      SHAPE  XGBoost run 90 days forward across the product families, reduced
             to how each month compares to the 90-day average. These factors
             average to 1.0 by construction, so they redistribute the level
             across the horizon without changing its total.

    Sending no `revenue_history` leaves only the shape, and the forecast then
    averages back to last month's revenue no matter what the business did --
    which is what it used to do unconditionally.
    """
    try:
        oil = get_oil_context()
        oil_price = oil["price"]
        holidays = get_upcoming_holidays(60)

        # The same market reading the pipeline uses, so the revenue chart and
        # the per-product forecasts cannot disagree about market conditions.
        market = analyze_market(
            fetch_market_news_detailed("retail", (body.product_families or ["GROCERY I"])[0])["text"],
            oil, holidays,
        )
        sentiment_mult = market["multiplier"]
        sentiment_analysis = market["analysis"]

        # Run XGBoost 90 days across all requested product families
        families = (body.product_families or ["GROCERY I"])[:5]
        total_90d: list[float] = []
        for family in families:
            daily = forecast_demand(
                historical_sales=[20.0] * 12,   # dummy â€” real model ignores this
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

        # ------------------------------------------------------------------
        # Trend.
        #
        # This is what the forecast was missing entirely. f1/f2/f3 are each
        # divided by their own mean, so they average to exactly 1.0 -- which
        # means `last_rev * f` always averages back to last month's revenue no
        # matter what the history did. The three-month forecast could only
        # redistribute one month's figure across the horizon; it had no term
        # capable of expressing growth at all. On a business compounding 10% a
        # month it drew a September BELOW August, because September's seasonal
        # factor happens to be 0.94, and that read as the AI predicting a
        # downturn when it was predicting nothing.
        #
        # So the LEVEL now comes from the trend and XGBoost keeps supplying the
        # SHAPE, which is the part it was always good for.
        # ------------------------------------------------------------------
        last_rev = body.last_actual_revenue
        hist = [h.revenue for h in (body.revenue_history or []) if h.revenue > 0]

        growth, r2, trend_applied = 0.0, 0.0, False

        # Four points is the minimum from which a slope means anything; below
        # that a single odd month sets the direction.
        if last_rev > 0 and len(hist) >= 4:
            n = len(hist)
            # Regress on ln(revenue), not revenue. The series compounds, so a
            # straight-line fit systematically understates a growing business
            # and overstates a shrinking one.
            ys = [math.log(v) for v in hist]
            xs = list(range(n))
            mx = sum(xs) / n
            my = sum(ys) / n
            denom = sum((x - mx) ** 2 for x in xs)
            if denom > 0:
                slope = sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / denom
                ss_tot = sum((y - my) ** 2 for y in ys)
                ss_res = sum((ys[i] - (my + slope * (xs[i] - mx))) ** 2 for i in range(n))
                r2 = (1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0
                r2 = max(0.0, min(1.0, r2))

                # Trust the trend in proportion to how well it actually fits.
                # A clean series uses its slope almost in full; a noisy one
                # collapses toward flat rather than extrapolating its own noise.
                eff_slope = slope * r2
                # And bound it, so one broken month in the data cannot produce
                # a forecast nobody would believe.
                eff_slope = max(math.log(0.85), min(math.log(1.25), eff_slope))

                growth = math.exp(eff_slope) - 1.0
                trend_applied = abs(eff_slope) > 1e-9

                # Damped horizon (Gardner-McKenzie): month three gets phi + phi^2
                # + phi^3 worth of growth rather than a full three months of it,
                # so a three-month projection cannot run away.
                phi = 0.9
                levels = []
                for i in range(3):
                    damp = sum(phi ** k for k in range(i + 1))
                    levels.append(last_rev * math.exp(eff_slope * damp))
            else:
                levels = [last_rev] * 3
        else:
            # No usable history: fall back to the original behaviour rather
            # than refuse, so an older client still gets a forecast.
            levels = [last_rev] * 3 if last_rev > 0 else [0.0, 0.0, 0.0]

        xgboost = [
            round(levels[0] * f1),
            round(levels[1] * f2),
            round(levels[2] * f3),
        ]

        # PPO + LLM adjusted: apply real sentiment multiplier
        ppo_llm = [round(v * sentiment_mult) for v in xgboost]

        return RevenueForecastResponse(
            xgboost_monthly=xgboost,
            ppo_llm_monthly=ppo_llm,
            sentiment_multiplier=round(sentiment_mult, 4),
            sentiment_analysis=sentiment_analysis,
            oil_price=round(oil_price, 2),
            seasonal_factors=[f1, f2, f3],
            trend_monthly_growth=round(growth, 5),
            trend_r2=round(r2, 4),
            trend_applied=trend_applied,
            trend_months_used=len(hist),
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Revenue forecast failed: {str(e)}")


@router.get("/market-insight", response_model=MarketInsightResponse)
async def market_insight(family: str = "GROCERY I", product: str = "retail"):
    """
    The current market reading, with every input that produced it.

    This exists because the dashboard was showing the mean `sentiment_multiplier`
    across all stored forecasts and calling it "Avg Market Sentiment". That is an
    average over how often someone pressed the button, not over market
    conditions â€” 66 of 76 stored rows came from a single batch run on one day,
    so the figure was frozen at that day's reading and could never move.

    This returns what the market looks like RIGHT NOW, decomposed, so the number
    can be checked against its own evidence.
    """
    try:
        oil = get_oil_context()
        holidays = get_upcoming_holidays(60)
        news = fetch_market_news_detailed(product, family)
        market = analyze_market(news["text"], oil, holidays)

        return MarketInsightResponse(
            multiplier=market["multiplier"],
            direction=market["direction"],
            analysis=market["analysis"],
            total_adjustment=market["total_adjustment"],
            components=market["components"],
            oil=oil,
            holidays=holidays,
            headlines=news["headlines"],
            news_status=news["status"],
            news_engine=market["news_engine"],
            family=family,
            generated_at=datetime.utcnow().isoformat() + "Z",
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Market insight failed: {str(e)}")


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


@router.get("/simulate/demand-shape", response_model=DemandShapeResponse)
async def demand_shape(families: str = "GROCERY I,BEVERAGES,DAIRY,PRODUCE,FROZEN FOODS"):
    """
    Today's relative demand shape per product family, for the sales simulator.

    The simulator in Postgres owns how MUCH sells: each product's frozen
    baseline times the month's growth factor. This endpoint owns only the MIX
    -- which families are running hot or cold today, according to XGBoost's
    seasonal signal and the live market reading.

    That split is why the weights are normalised to a mean of exactly 1.0. If
    they averaged 1.3, total volume would silently run 30% above baseline and
    the 10%-per-month growth contract would stop holding. Normalising lets the
    mix move freely while leaving the volume exactly where the simulator set
    it.

    The caller treats this as a cache, never a dependency: this Space sleeps on
    free cpu-basic, and a tick that cannot reach it falls back to a flat 1.0
    weight and carries on.
    """
    try:
        # Pipe-separated, because family names are not comma-safe: this
        # catalogue contains "LIQUOR,WINE,BEER", which a comma split tears into
        # three families that do not exist, so its products never received a
        # weight. Comma is still accepted when no pipe is present, so an older
        # caller keeps working.
        #
        # The catalogue carries 33 families. Capping at 8, as this first did,
        # meant 25 of them silently fell back to a flat 1.0 -- and which 8 got
        # a real weight depended on nothing but string order. A family costs
        # ~0.32s to forecast, so covering all of them takes ~10s, well inside
        # the caller's 55s deadline for a once-a-day job.
        sep = "|" if "|" in families else ","
        fam_list = [f.strip() for f in families.split(sep) if f.strip()][:40]
        if not fam_list:
            fam_list = ["GROCERY I"]

        oil = get_oil_context()
        oil_price = oil["price"]
        holidays = get_upcoming_holidays(30)
        market = analyze_market(
            fetch_market_news_detailed("retail", fam_list[0])["text"], oil, holidays,
        )
        sentiment_mult = market["multiplier"]

        # One 30-day run per family; the mean daily rate is that family's level.
        means: dict[str, float] = {}
        for family in fam_list:
            daily = forecast_demand(
                historical_sales=[20.0] * 12,   # dummy -- the real model ignores this
                period="30d",
                product_family=family,
                oil_price=oil_price,
            )[:30]
            means[family] = (sum(daily) / len(daily)) if daily else 1.0

        overall = sum(means.values()) / len(means) if means else 1.0
        if overall <= 0:
            overall = 1.0

        # Normalise to mean 1.0 and clamp, so a family the model is wild about
        # tilts the mix rather than emptying its shelves in an afternoon.
        #
        # These two goals fight each other, and the order matters. Clamping
        # last breaks the mean; rescaling last breaks the clamp -- which is
        # what happened first time round and produced a 1.59 weight against a
        # stated 1.40 ceiling. Alternating converges on both: rescaling pulls
        # the mean back to 1.0, clamping pulls outliers back in, and each pass
        # leaves less for the next to do. Four is well past convergence for a
        # realistic spread.
        LO, HI = 0.70, 1.40
        vals = {f: m / overall for f, m in means.items()}
        for _ in range(4):
            mean_v = sum(vals.values()) / len(vals)
            if mean_v <= 0:
                break
            vals = {f: max(LO, min(HI, v / mean_v)) for f, v in vals.items()}

        weights = [
            FamilyWeight(family=f, weight=round(v, 4), raw_daily_mean=round(means[f], 3))
            for f, v in vals.items()
        ]

        return DemandShapeResponse(
            shape_date=datetime.utcnow().date().isoformat(),
            weights=weights,
            sentiment_multiplier=round(sentiment_mult, 4),
            oil_price=round(oil_price, 2),
            generated_at=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Demand shape failed: {str(e)}")
