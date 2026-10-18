from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
source=(root/"King_of_Scalper_BTC.mq5").read_text()
defaults=dict(re.findall(r"^input\s+(?:bool|double|int|ulong)\s+(Inp\w+)\s*=\s*([^;]+);",source,re.M))
preset=dict(line.split("=",1) for line in (root/"King_of_Scalper_BTC_Demo.set").read_text().splitlines() if line and not line.startswith(";"))
assert defaults==preset, "Preset/default input mismatch"
assert defaults["InpRiskPercent"]=="0.25"
assert defaults["InpAllowLiveTrading"]=="false"
assert defaults["InpTickFlow"]=="false"
assert defaults["InpDailyLossMoney"]=="20.0"
assert defaults["InpMaxDrawdownPercent"]=="5.0"
assert source.count("trade.Buy(")==1 and source.count("trade.Sell(")==1
print(f"PASS: {len(defaults)} preset inputs match EA source; demo protection defaults verified")
