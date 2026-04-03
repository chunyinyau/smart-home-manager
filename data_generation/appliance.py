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

    # Fridge: Cycling dynamically every hour (On for minutes 0-19, Off for 20-59)
    'fridge_w': np.where(minutes < 20, np.random.normal(160, 10, periods), np.random.normal(4, 1, periods)),

    # TV: Evening usage (6 PM - 11 PM)
    'tv_w': np.where((hours >= 18) & (hours <= 23), np.random.normal(130, 15, periods), 0.5),

    # Light: Mostly active after sunset, with a low standby draw during the day
    'light_w': np.where((hours >= 19) | (hours <= 6), np.random.normal(14, 2, periods), np.random.normal(3, 0.5, periods)),

    # Air Conditioning: On at night (22-07) and afternoon (13-16)
    'air_conditioning_w': np.where(
        ((hours >= 22) | (hours <= 7)),
        np.random.normal(1100, 50, periods),
        np.where((hours >= 13) & (hours <= 16), np.random.normal(1300, 70, periods), 0),
    ),

    # Smart Panel: Always on, with a slightly higher daytime draw
    'smart_panel_w': np.where((hours >= 8) & (hours <= 20), np.random.normal(25, 2, periods), np.random.normal(10, 1, periods)),
}

df = pd.DataFrame(data)

# 4. Clean Data: Prevent any impossible negative power values
appliance_cols = ['fridge_w', 'tv_w', 'light_w', 'air_conditioning_w', 'smart_panel_w']
df[appliance_cols] = df[appliance_cols].clip(lower=0)

# 5. Calculate Energy Consumption (Proper usage for that 5 mins)
for col in appliance_cols:
    energy_col_name = col.replace('_w', '_wh')
    df[energy_col_name] = df[col] * conversion_factor

# 6. Total kWh for the 5-minute slice
wh_cols = [c for c in df.columns if '_wh' in c]
df['total_slice_kwh'] = df[wh_cols].sum(axis=1) / 1000

# 7. Save and Preview
output_path = 'appliance_energy_data.csv'
df.to_csv(output_path, index=False)

print(f"Success! Generated {len(df)} rows.")
print("\nSample Output (First 10 rows):")
print(df[['timestamp', 'fridge_w', 'fridge_wh', 'total_slice_kwh']].head(10))
