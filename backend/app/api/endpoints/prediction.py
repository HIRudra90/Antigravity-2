from fastapi import APIRouter, HTTPException, BackgroundTasks
from app.models.schemas import PipelineRequest, PipelineResponse
from app.services.llm_sentiment import analyze_sentiment
from app.services.xgboost_forecast import forecast_demand
from app.services.ppo_optimizer import optimize_restock
from app.services.supabase_service import log_prediction_to_supabase

router = APIRouter()

@router.post("/predict/pipeline", response_model=PipelineResponse)
async def run_prediction_pipeline(request: PipelineRequest, background_tasks: BackgroundTasks):
    """
    Unified AI Inventory Pipeline:
    1. LLM Sentiment Analysis on market text → sentiment multiplier
    2. XGBoost Forecasting (Colab-trained model_xgb) → demand forecast
    3. PPO RL Agent (Colab-trained model_rl) → optimal reorder quantity
    4. Async log to Supabase
    """
    try:
        # Step 1: LLM Sentiment
        sentiment_multiplier, sentiment_analysis = analyze_sentiment(request.market_text)

        # Step 2: XGBoost demand forecast using Colab feature columns
        forecasted_demand = forecast_demand(
            historical_sales=request.historical_sales,
            period=request.forecast_period,
            product_family=request.product_family,
        )

        # Apply sentiment multiplier to scale the forecast
        scaled_demand = [float(round(qty * sentiment_multiplier, 1)) for qty in forecasted_demand]

        # Step 3: PPO RL reorder decision
        optimal_reorder_qty = optimize_restock(
            current_stock=request.current_stock,
            reorder_level=request.reorder_level,
            forecasted_demand=scaled_demand,
            sentiment_multiplier=sentiment_multiplier
        )

        # Step 4: Log to Supabase asynchronously
        background_tasks.add_task(
            log_prediction_to_supabase,
            product_id=request.product_id,
            product_name=request.product_name,
            forecast_period=request.forecast_period,
            current_stock=request.current_stock,
            reorder_level=request.reorder_level,
            market_text=request.market_text,
            sentiment_multiplier=sentiment_multiplier,
            sentiment_analysis=sentiment_analysis,
            historical_sales=request.historical_sales,
            forecasted_demand=scaled_demand,
            optimal_reorder_qty=optimal_reorder_qty
        )

        return PipelineResponse(
            product_id=request.product_id,
            product_name=request.product_name,
            forecast_period=request.forecast_period,
            sentiment_multiplier=sentiment_multiplier,
            sentiment_analysis=sentiment_analysis,
            forecasted_demand=scaled_demand,
            optimal_reorder_qty=optimal_reorder_qty
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"AI Pipeline failed: {str(e)}")
