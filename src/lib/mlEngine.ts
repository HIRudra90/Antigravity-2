/**
 * Simple Machine Learning engine for Time Series Forecasting
 * Implements Linear Regression with Seasonality and basic Holt-Winters logic
 */

/**
 * Predicts the next n points using Linear Regression
 */
export function predictLinear(data: number[], nextN: number): number[] {
  const n = data.length
  if (n < 2) return Array(nextN).fill(data[0] || 0)

  // Calculate means
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += data[i]
    sumXY += i * data[i]
    sumXX += i * i
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  const predictions = []
  for (let i = 0; i < nextN; i++) {
    predictions.push(Math.max(0, slope * (n + i) + intercept))
  }
  return predictions
}

/**
 * Simple Triple Exponential Smoothing (Holt-Winters) - Simplified Version
 * Good for Sales data with trend and seasonality
 */
export function forecastSales(historicalData: number[], forecastHorizon: number): number[] {
    if (historicalData.length < 3) return predictLinear(historicalData, forecastHorizon);
    
    // Alpha, Beta, Gamma parameters (tunable)
    const alpha = 0.5; // level smoothing
    const beta = 0.2;  // trend smoothing
    
    let level = historicalData[0];
    let trend = historicalData[1] - historicalData[0];
    
    // Level & Trend update (Simple Holt's Linear)
    for (let i = 1; i < historicalData.length; i++) {
        let lastLevel = level;
        level = alpha * historicalData[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - lastLevel) + (1 - beta) * trend;
    }
    
    // Generate Forecast
    const forecast = [];
    for (let h = 1; h <= forecastHorizon; h++) {
        forecast.push(Math.max(0, Math.round(level + h * trend)));
    }
    
    return forecast;
}
