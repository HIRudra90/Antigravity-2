from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.endpoints import prediction

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend ML Forecasting service for Inventiq Inventory System",
    version="1.0.0"
)

# Set up CORS middleware to allow React frontend to connect seamlessly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register endpoints under /api prefix
app.include_router(prediction.router, prefix=settings.API_V1_STR, tags=["predictions"])

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "engine": "FastAPI + XGBoost + PPO RL + LLM Sentiment",
        "endpoints": {
            "prediction_pipeline": f"{settings.API_V1_STR}/predict/pipeline"
        }
    }
