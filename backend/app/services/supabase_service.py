import httpx
from app.config import settings

def log_prediction_to_supabase(
    product_id: str,
    product_name: str,
    forecast_period: str,
    current_stock: int,
    reorder_level: int,
    market_text: str,
    sentiment_multiplier: float,
    sentiment_analysis: str,
    historical_sales: list[float],
    forecasted_demand: list[float],
    optimal_reorder_qty: int
) -> dict:
    """
    Logs prediction pipeline inputs and results into the Supabase 'demand_forecasts' table
    using standard HTTP REST protocol (httpx) to bypass dependency compilation issues.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        print("Supabase credentials not configured. Skipping Python database logging.")
        return {"status": "skipped", "reason": "not_configured"}
        
    url = f"{settings.SUPABASE_URL}/rest/v1/demand_forecasts"
    headers = {
        "apikey": settings.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    
    data = {
        "product_id": product_id,
        "product_name": product_name,
        "forecast_period": forecast_period,
        "current_stock": current_stock,
        "reorder_level": reorder_level,
        "market_text": market_text,
        "sentiment_multiplier": float(sentiment_multiplier),
        "sentiment_analysis": sentiment_analysis,
        "historical_sales": historical_sales,
        "forecasted_demand": forecasted_demand,
        "optimal_reorder_qty": int(optimal_reorder_qty)
    }
    
    try:
        with httpx.Client() as client:
            response = client.post(url, json=data, headers=headers)
            if response.status_code in [200, 201]:
                return {"status": "success", "data": response.json()}
            else:
                print(f"Supabase REST logging failed: Status {response.status_code}, {response.text}")
                return {"status": "failed", "reason": f"REST error: {response.text}"}
    except Exception as e:
        print(f"Error logging prediction to Supabase via REST: {e}")
        return {"status": "failed", "reason": str(e)}
