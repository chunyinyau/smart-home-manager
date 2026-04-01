import pandas as pd
import numpy as np
from datetime import datetime

# 1. Configuration
start_date = datetime(2026, 4, 1)
days = 61
periods = days * 24 * 12  # 12 intervals of 5-mins per hour
conversion_factor = 5 / 60  # To convert Watts to Watt-hours (Wh)

# 2. Create Timestamp range
timestamps = pd.date_range(start=start_date, periods=periods, freq='5min')

# 3. Generate Power Data (Watts)
hours = timestamps.hour
minutes = timestamps.minute

data = {
    'timestamp': timestamps,
    
    # Aircon: On at night (22-07) and afternoon (13-16)
    'aircon_w': np.where(((hours >= 22) | (hours <= 7)), np.random.normal(1100, 50, periods), 
                np.where((hours >= 13) & (hours <= 16), np.random.normal(1300, 70, periods), 0)),
    
    # Air Purifier: Always on, higher during the day
    'purifier_w': np.where((hours >= 8) & (hours <= 20), np.random.normal(25, 2, periods), np.random.normal(10, 1, periods)),
    
    # Fan: On during the day when Aircon is mostly off
    'fan_w': np.where((hours >= 8) & (hours <= 21), np.random.normal(55, 5, periods), 0),
    
    # TV: Evening usage (6 PM - 11 PM)
    'tv_w': np.where((hours >= 18) & (hours <= 23), np.random.normal(130, 15, periods), 0.5),
    
    # Charger Hub: High at night for phones, moderate day for laptops
    'charger_w': np.where((hours >= 23) | (hours <= 6), np.random.normal(50, 5, periods), np.random.normal(15, 3, periods)),
    
    # Fridge: Cycling dynamically every hour (On for minutes 0-19, Off for 20-59)
    'fridge_w': np.where(minutes < 20, np.random.normal(160, 10, periods), np.random.normal(4, 1, periods))
}

df = pd.DataFrame(data)

# 4. Clean Data: Prevent any impossible negative power values
appliance_cols = ['aircon_w', 'purifier_w', 'fan_w', 'tv_w', 'charger_w', 'fridge_w']
df[appliance_cols] = df[appliance_cols].clip(lower=0)

# 5. Calculate Energy Consumption (Proper usage for that 5 mins)
for col in appliance_cols:
    energy_col_name = col.replace('_w', '_wh')
    df[energy_col_name] = df[col] * conversion_factor

# 6. Total kWh for the 5-minute slice
wh_cols = [c for c in df.columns if '_wh' in c]
df['total_slice_kwh'] = df[wh_cols].sum(axis=1) / 1000

# 7. Save and Preview
df.to_csv('appliance_energy_data.csv', index=False)

print(f"Success! Generated {len(df)} rows.")
print("\nSample Output (First 10 rows):")
print(df[['timestamp', 'fridge_w', 'fridge_wh', 'total_slice_kwh']].head(10))