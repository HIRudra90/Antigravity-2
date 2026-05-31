from pydantic import BaseModel, Field
from typing import List, Optional

class PipelineRequest(BaseModel):
    product_id: str = Field(..., description="Unique identifier of the product")
    product_name: str = Field(..., description="Name of the product")
    product_family: str = Field("GROCERY I", description="Product family — must match a family label from Colab training data")
    forecast_period: str = Field("30d", description="Forecast period: '7d', '30d', '90d', or '365d'")
    current_stock: int = Field(..., ge=0, description="Current stock level in inventory")
    reorder_level: int = Field(..., ge=0, description="Reorder threshold for the product")
    market_text: Optional[str] = Field("", description="Raw market text / newsletter insights for LLM sentiment analysis")
    historical_sales: List[float] = Field(..., min_items=1, description="Historical sales values (e.g. daily or weekly sales)")

class PipelineResponse(BaseModel):
    product_id: str
    product_name: str
    forecast_period: str
    sentiment_multiplier: float
    sentiment_analysis: str
    forecasted_demand: List[float]
    optimal_reorder_qty: int
    status: str = "success"
