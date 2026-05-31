import os
import pickle
import numpy as np
import pandas as pd


class PPOInventoryAgentPolicy:
    """
    Simulated PPO Inventory Management agent.
    Learned mapping: State -> RESTOCK ACTION
    State vector: [current_stock, reorder_level, lead_time_demand, sentiment_multiplier, mean_demand]
    
    Replace this with your actual trained PPO agent from Google Colab!
    """
    def __init__(self):
        # Simulated weight matrices representing trained policy network weights
        self.weights = np.array([-1.2, 0.4, 1.1, 25.0, 1.5])
        self.bias = 12.0
        
    def predict(self, state: np.ndarray, deterministic: bool = True) -> tuple:
        # Simple policy network forward pass: Dot product + activation
        linear_output = np.dot(state, self.weights) + self.bias
        stock = state[0, 0]
        reorder = state[0, 1]
        
        if stock > reorder * 1.5:
            action = 0.0
        else:
            action = max(0.0, float(linear_output[0]))
            
        return np.array([action]), None


def train_and_dump_mock_models():
    import xgboost as xgb
    
    print("=" * 60)
    print("  Inventiq AI — Mock Model Training Pipeline")
    print("=" * 60)
    print()
    print("Generating synthetic inventory demand data...")
    
    # Generate mock training dataset for XGBoost forecasting
    # Features: [current_stock, reorder_level, mean, std, sum, lag_1, lag_2, lag_3, holiday, oil_price]
    np.random.seed(42)
    n_samples = 1000
    
    current_stock = np.random.randint(0, 150, n_samples)
    reorder_level = np.random.randint(15, 30, n_samples)
    sales_mean = np.random.uniform(5, 50, n_samples)
    sales_std = sales_mean * np.random.uniform(0.05, 0.25, n_samples)
    sales_sum = sales_mean * 30
    lag_1 = sales_mean + np.random.normal(0, sales_std)
    lag_2 = sales_mean + np.random.normal(0, sales_std)
    lag_3 = sales_mean + np.random.normal(0, sales_std)
    holiday = np.random.choice([0.0, 1.0], n_samples, p=[0.8, 0.2])
    oil_price = np.random.uniform(70, 85, n_samples)
    
    target_demand = sales_mean * (1.0 + 0.3 * holiday) * (80.0 / oil_price) + np.random.normal(0, sales_std * 0.5)
    target_demand = np.maximum(0, np.round(target_demand))
    
    X = pd.DataFrame({
        "current_stock": current_stock,
        "reorder_level": reorder_level,
        "sales_mean": sales_mean,
        "sales_std": sales_std,
        "sales_sum": sales_sum,
        "lag_1": lag_1,
        "lag_2": lag_2,
        "lag_3": lag_3,
        "holiday": holiday,
        "oil_price": oil_price
    })
    
    print("Training XGBoost Regressor for Sales Demand Forecasting...")
    xgb_model = xgb.XGBRegressor(
        n_estimators=50,
        max_depth=4,
        learning_rate=0.1,
        random_state=42
    )
    xgb_model.fit(X, target_demand)
    
    models_dir = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(models_dir, exist_ok=True)
    
    xgb_path = os.path.join(models_dir, "forecast_model.pkl")
    with open(xgb_path, 'wb') as f:
        pickle.dump(xgb_model, f)
    print(f"  -> XGBoost model saved: {xgb_path}")
    
    # Serialize PPO Agent (class is now at module level so pickle works)
    print("Serializing PPO Reinforcement Learning policy agent...")
    ppo_agent = PPOInventoryAgentPolicy()
    ppo_path = os.path.join(models_dir, "ppo_inventory_agent.pkl")
    with open(ppo_path, 'wb') as f:
        pickle.dump(ppo_agent, f)
    print(f"  -> PPO Agent saved: {ppo_path}")
    
    print()
    print("All ML binaries successfully prepared!")
    print()
    print("NEXT STEP: Replace these .pkl files with your real")
    print("           Google Colab-trained models for production use.")
    print("=" * 60)


if __name__ == "__main__":
    train_and_dump_mock_models()
