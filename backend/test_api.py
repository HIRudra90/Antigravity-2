import httpx
import json

def test_prediction_pipeline():
    url = "http://localhost:8000/api/predict/pipeline"
    payload = {
        "product_id": "test-prod-123",
        "product_name": "Wireless Mechanical Keyboard",
        "forecast_period": "30d",
        "current_stock": 45,
        "reorder_level": 20,
        "market_text": "Tech market is booming! High consumer spending expected for hardware and office devices.",
        "historical_sales": [12.0, 15.0, 14.0, 18.0, 22.0, 20.0, 25.5, 23.0, 28.0, 32.0, 30.0, 35.0]
    }
    
    print("Sending prediction request to FastAPI server...")
    try:
        response = httpx.post(url, json=payload, timeout=30.0)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            result = response.json()
            print("\nPipeline Result Successful:")
            print(f"Product: {result['product_name']}")
            print(f"Sentiment Multiplier: {result['sentiment_multiplier']}")
            print(f"Sentiment Analysis: {result['sentiment_analysis']}")
            print(f"Optimal Restock Quantity: {result['optimal_reorder_qty']} units")
            print(f"Forecasted demand length: {len(result['forecasted_demand'])} days")
            print(f"First 5 days forecast: {result['forecasted_demand'][:5]}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Failed to connect to FastAPI: {e}")

if __name__ == "__main__":
    test_prediction_pipeline()
