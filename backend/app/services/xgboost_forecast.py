import os
import pickle
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from app.config import settings

_xgb_model = None
_encoders = None

def load_forecast_model():
    global _xgb_model
    if _xgb_model is not None:
        return _xgb_model
    if os.path.exists(settings.XGB_MODEL_PATH):
        try:
            with open(settings.XGB_MODEL_PATH, 'rb') as f:
                _xgb_model = pickle.load(f)
            print(f"XGBoost model loaded from {settings.XGB_MODEL_PATH}")
        except Exception as e:
            print(f"Failed to load XGBoost model: {e}")
    else:
        print(f"XGBoost model not found at {settings.XGB_MODEL_PATH}")
    return _xgb_model

def load_encoders():
    global _encoders
    if _encoders is not None:
        return _encoders
    if os.path.exists(settings.ENCODERS_PATH):
        try:
            with open(settings.ENCODERS_PATH, 'rb') as f:
                _encoders = pickle.load(f)
            print(f"Label encoders loaded from {settings.ENCODERS_PATH}")
        except Exception as e:
            print(f"Failed to load label encoders: {e}")
    else:
        print(f"Label encoders not found at {settings.ENCODERS_PATH}. Using default numeric values.")
    return _encoders

def encode_category(encoders: dict | None, key: str, value: str) -> int:
    """Encode a categorical value using the saved LabelEncoder. Returns 0 if not found."""
    if encoders and key in encoders:
        le = encoders[key]
        try:
            return int(le.transform([value])[0])
        except ValueError:
            return int(le.transform([le.classes_[0]])[0])
    return 0

def forecast_demand(
    historical_sales: list[float],
    period: str,
    product_family: str = "GROCERY I",
    store_nbr: int = 1,
    city: str = "Quito",
    state: str = "Pichincha",
    store_type: str = "A",
    cluster: int = 1,
    onpromotion: int = 0,
    oil_price: float = 78.5,
) -> list[float]:
    """
    Forecasts demand using the Colab-trained XGBoost model (model_xgb).

    Feature columns match X_train from Colab exactly:
      store_nbr, family, onpromotion, city, state, type_x,
      cluster, dcoilwtico, day_of_week, month, year, is_weekend
    """
    days_map = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}
    days = days_map.get(period.lower(), 30)

    model = load_forecast_model()
    encoders = load_encoders()

    family_enc = encode_category(encoders, "family",  product_family)
    city_enc   = encode_category(encoders, "city",    city)
    state_enc  = encode_category(encoders, "state",   state)
    type_enc   = encode_category(encoders, "type_x",  store_type)

    if model is not None:
        try:
            base_date = datetime.now()
            forecast = []

            for step in range(days):
                future_date = base_date + timedelta(days=step)
                is_weekend = 1 if future_date.weekday() in [5, 6] else 0

                X = pd.DataFrame([{
                    "store_nbr":   store_nbr,
                    "family":      family_enc,
                    "onpromotion": onpromotion,
                    "city":        city_enc,
                    "state":       state_enc,
                    "type_x":      type_enc,
                    "cluster":     cluster,
                    "dcoilwtico":  oil_price,
                    "day_of_week": future_date.weekday(),
                    "month":       future_date.month,
                    "year":        future_date.year,
                    "is_weekend":  is_weekend,
                }])

                pred = model.predict(X)[0]
                forecast.append(max(0.0, float(round(pred, 1))))

            return forecast

        except Exception as e:
            print(f"XGBoost inference failed: {e}. Falling back to statistical forecast.")

    # Statistical fallback (Holt's double exponential smoothing)
    n = len(historical_sales)
    if n == 0:
        return [0.0] * days

    alpha, beta = 0.4, 0.25
    level = historical_sales[0]
    trend = (historical_sales[-1] - historical_sales[0]) / n if n > 1 else 0.0

    for val in historical_sales:
        last_level = level
        level = alpha * val + (1 - alpha) * (level + trend)
        trend = beta * (level - last_level) + (1 - beta) * trend

    forecast = []
    for h in range(1, days + 1):
        seasonality = 1.15 if (h % 7 in [5, 6]) else 0.95
        val = max(0.0, (level + h * trend) * seasonality)
        noise = np.random.normal(0, val * 0.03) if val > 0 else 0
        forecast.append(float(round(val + noise, 1)))

    return forecast
