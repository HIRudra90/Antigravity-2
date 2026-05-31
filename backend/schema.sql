-- SQL DDL Script for creating the demand forecasting history table in Supabase
-- Run this in your Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS demand_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    forecast_period TEXT NOT NULL,          -- '7d', '30d', '90d', '365d'
    current_stock INT NOT NULL,
    reorder_level INT NOT NULL,
    market_text TEXT,                       -- Text input for LLM sentiment analysis
    sentiment_multiplier NUMERIC(3,2),      -- Multiplier from LLM (e.g. 1.15)
    sentiment_analysis TEXT,                -- Detailed text insights from LLM
    historical_sales JSONB NOT NULL,        -- Array of numbers representing history
    forecasted_demand JSONB NOT NULL,       -- Array of numbers representing forecast
    optimal_reorder_qty INT NOT NULL,       -- PPO RL decision output
    predicted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (optional, for security)
ALTER TABLE demand_forecasts ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all reads and inserts for anonymous users
CREATE POLICY "Allow public read access" ON demand_forecasts FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert access" ON demand_forecasts FOR INSERT TO anon WITH CHECK (true);
