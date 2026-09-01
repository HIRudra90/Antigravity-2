import os
from dotenv import load_dotenv

# Anchor every path on the package itself rather than on a guessed directory
# name. app/config.py -> app/ -> the backend root, which is the repo's
# `backend/` locally and `/app` inside the container. The old code walked up
# three levels and re-appended a literal "backend" segment, which resolved to
# the nonexistent /backend/models_bin in Docker. Nothing crashed: the model
# loaders treat "file missing" as a soft failure and quietly drop to their
# statistical fallbacks, so production served heuristics while reporting
# XGBoost and PPO.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BACKEND_DIR)

# Load env variables from the repo root first, then the backend dir, then CWD.
for _candidate in (os.path.join(REPO_ROOT, '.env'), os.path.join(BACKEND_DIR, '.env')):
    if os.path.exists(_candidate):
        load_dotenv(dotenv_path=_candidate)
        break
else:
    load_dotenv()

class Settings:
    PROJECT_NAME: str = "Inventiq AI Forecasting System"
    API_V1_STR: str = "/api"
    
    # Supabase credentials
    SUPABASE_URL: str = os.getenv("VITE_SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("VITE_SUPABASE_ANON_KEY", "")
    
    # AI API keys
    ANTHROPIC_API_KEY: str = os.getenv("VITE_ANTHROPIC_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    NEWS_API_KEY: str = os.getenv("NEWS_API_KEY", "")
    
    # Model binary paths
    MODELS_DIR: str = os.path.join(BACKEND_DIR, "models_bin")
    XGB_MODEL_PATH: str = os.path.join(MODELS_DIR, "forecast_model.pkl")
    PPO_AGENT_PATH: str = os.path.join(MODELS_DIR, "ppo_inventory_agent")
    ENCODERS_PATH: str = os.path.join(MODELS_DIR, "label_encoders.pkl")

settings = Settings()
