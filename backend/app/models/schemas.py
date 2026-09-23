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

class SentimentComponent(BaseModel):
    """One scored input behind a multiplier, so the total can be audited."""
    label: str
    detail: str
    contribution: float
    score: Optional[float] = None
    engine: Optional[str] = None

class PipelineResponse(BaseModel):
    product_id: str
    product_name: str
    forecast_period: str
    sentiment_multiplier: float
    sentiment_direction: str = "NEUTRAL"
    sentiment_analysis: str
    sentiment_key_factors: List[str] = []
    oil_price_used: float = 78.5
    holidays_count: int = 0
    forecasted_demand: List[float]
    optimal_reorder_qty: int
    market_context_used: str = ""
    sentiment_components: List[SentimentComponent] = []
    oil_context: dict = {}
    status: str = "success"

class Headline(BaseModel):
    title: str
    description: str = ""
    source: str = ""
    published_at: str = ""
    url: str = ""

class MarketInsightResponse(BaseModel):
    """Current market conditions, decomposed into the inputs that produced them."""
    multiplier: float
    direction: str
    analysis: str
    total_adjustment: float
    components: List[SentimentComponent]
    oil: dict
    holidays: List[dict]
    headlines: List[Headline]
    news_status: str
    news_engine: str
    family: str
    generated_at: str

class MonthRevenue(BaseModel):
    """One completed month of actual revenue."""
    month: str = Field(..., description="YYYY-MM")
    revenue: float = Field(..., ge=0)

class RevenueForecastRequest(BaseModel):
    last_actual_revenue: float = Field(0.0, description="Last month's actual revenue (for scaling)")
    product_families: Optional[List[str]] = Field(
        default=["GROCERY I", "BEVERAGES", "DAIRY", "PRODUCE", "FROZEN FOODS"],
        description="Product families to aggregate forecast across"
    )
    revenue_history: Optional[List[MonthRevenue]] = Field(
        default=None,
        description=(
            "Completed months of actual revenue, oldest first. Used to fit the "
            "growth trend. Without it the forecast has no way to see a trend "
            "and can only redistribute last month's figure across the horizon."
        ),
    )

class RevenueForecastResponse(BaseModel):
    xgboost_monthly: List[float]
    ppo_llm_monthly: List[float]
    sentiment_multiplier: float
    sentiment_analysis: str
    oil_price: float
    seasonal_factors: List[float]
    # What the trend fit concluded, so the caller can show its reasoning
    # instead of asserting a number.
    trend_monthly_growth: float = 0.0   # e.g. 0.102 for +10.2%/month
    trend_r2: float = 0.0
    trend_applied: bool = False
    trend_months_used: int = 0

class BacktestRequest(BaseModel):
    """One holdout window whose real outcome the caller already knows."""
    start_date: str = Field(..., description="First day of the holdout window, YYYY-MM-DD")
    days: int = Field(30, ge=1, le=365, description="Length of the holdout window in days")
    families: List[str] = Field(..., description="Product families to predict over")
    oil_price: Optional[float] = Field(
        None, description="Oil price prevailing during the window; live price if omitted"
    )

class FamilyBacktest(BaseModel):
    family: str
    predicted_total: float
    predicted_daily: List[float]

class BacktestResponse(BaseModel):
    start_date: str
    days: int
    oil_price_used: float
    per_family: List[FamilyBacktest]
    predicted_grand_total: float

class FamilyWeight(BaseModel):
    family: str
    weight: float
    raw_daily_mean: float

class DemandShapeResponse(BaseModel):
    """
    Relative demand shape for one day, per product family.

    Weights are normalised to a mean of 1.0 on purpose. The simulator owns the
    VOLUME -- each product's frozen baseline times the month's growth factor --
    and this endpoint owns only the MIX between families. If the weights
    averaged 1.3 the simulation would quietly run 30% hot and the 10% monthly
    growth contract would stop holding.
    """
    shape_date: str
    weights: List[FamilyWeight]
    sentiment_multiplier: float
    oil_price: float
    generated_at: str
