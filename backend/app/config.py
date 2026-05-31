import os
from dotenv import load_dotenv

# Load env variables from root directory first, then fallback
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
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
    
    # Model binary paths
    MODELS_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "backend", "models_bin")
    XGB_MODEL_PATH: str = os.path.join(MODELS_DIR, "forecast_model.pkl")
    PPO_AGENT_PATH: str = os.path.join(MODELS_DIR, "ppo_inventory_agent.zip")
    ENCODERS_PATH: str = os.path.join(MODELS_DIR, "label_encoders.pkl")

settings = Settings()
