import os
import numpy as np
from app.config import settings

_ppo_agent = None

def load_ppo_agent():
    global _ppo_agent
    if _ppo_agent is not None:
        return _ppo_agent
    if os.path.exists(settings.PPO_AGENT_PATH):
        try:
            from stable_baselines3 import PPO
            _ppo_agent = PPO.load(settings.PPO_AGENT_PATH)
            print(f"PPO agent loaded from {settings.PPO_AGENT_PATH}")
        except Exception as e:
            print(f"Failed to load PPO agent: {e}. Using analytical policy fallback.")
    else:
        print(f"PPO agent not found at {settings.PPO_AGENT_PATH}. Using analytical policy fallback.")
    return _ppo_agent

def optimize_restock(
    current_stock: int,
    reorder_level: int,
    forecasted_demand: list[float],
    sentiment_multiplier: float
) -> int:
    """
    Computes optimal restock quantity using the Colab-trained PPO agent (model_rl).
    Falls back to an analytical (s, S) base-stock policy if the model is unavailable.

    Observation vector sent to the PPO policy:
      [current_stock, reorder_level, lead_time_demand, sentiment_multiplier, mean_daily_demand]
    """
    agent = load_ppo_agent()

    total_demand = sum(forecasted_demand)
    mean_daily_demand = total_demand / len(forecasted_demand) if forecasted_demand else 0.0
    lead_time_days = 3
    lead_time_demand = mean_daily_demand * lead_time_days

    if agent is not None:
        try:
            # Observation vector matches InventoryRL_Env exactly (shape=(3,), low=0, high=1):
            #   [0] xgboost_prediction  normalized by 5000.0
            #   [1] market_sentiment    normalized: (value - 0.8) / 0.7
            #   [2] current_inventory   normalized by 5000.0
            xgb_pred = mean_daily_demand  # daily forecast mean is the XGBoost output
            obs = np.array([
                xgb_pred / 5000.0,
                (sentiment_multiplier - 0.8) / 0.7,
                current_stock / 5000.0,
            ], dtype=np.float32).reshape(1, -1)

            action, _ = agent.predict(obs, deterministic=True)
            opt_qty = int(action[0]) if isinstance(action, (list, np.ndarray)) else int(action)
            return max(0, opt_qty)

        except Exception as e:
            print(f"PPO inference failed: {e}. Switching to analytical policy.")

    # Analytical fallback — Order-Up-To (s, S) base-stock policy
    daily_std = np.std(forecasted_demand) if len(forecasted_demand) > 1 else mean_daily_demand * 0.15
    adjusted_safety_factor = 1.65 * sentiment_multiplier
    safety_stock = adjusted_safety_factor * daily_std * np.sqrt(lead_time_days)
    target_stock = lead_time_demand + safety_stock
    min_order = max(10, int(mean_daily_demand * 2))

    if current_stock <= reorder_level:
        opt_qty = int(max(0.0, target_stock - current_stock))
        return opt_qty if opt_qty >= min_order else min_order

    projected = current_stock - lead_time_demand
    if projected <= reorder_level:
        return int(max(0.0, target_stock - current_stock))

    return 0
