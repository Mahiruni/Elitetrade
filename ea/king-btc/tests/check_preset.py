from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
source=(root/"King_of_Scalper_BTC.mq5").read_text()
defaults=dict(re.findall(r"^input\s+(?:bool|double|int|ulong)\s+(Inp\w+)\s*=\s*([^;]+);",source,re.M))
def read(name):
    return dict(line.split("=",1) for line in (root/name).read_text().splitlines() if line and not line.startswith(";"))
preset=read("King_of_Scalper_BTC_Demo.set")
fast=read("King_of_Scalper_BTC_Fast_Demo.set")
assert defaults==preset, "Baseline preset/default mismatch"
assert set(fast)==set(defaults), "Fast preset input coverage mismatch"
for key in ("InpRiskPercent","InpMaxLot","InpDailyLossMoney","InpMaxDrawdownPercent","InpCloseOnProtection","InpMagic","InpAllowLiveTrading","InpProtectionResetToken"):
    assert fast[key]==defaults[key], f"Fast preset altered protection/identity: {key}"
assert defaults["InpRiskPercent"]=="0.25"
assert defaults["InpAllowLiveTrading"]=="false"
assert defaults["InpTickFlow"]=="false"
assert fast["InpTickFlow"]=="true" and fast["InpTickConfirm"]=="2"
assert fast["InpTickUseM5Trend"]=="false"
assert fast["InpCooldownSeconds"]=="5" and fast["InpMaxTradesPerDay"]=="200"
assert source.count("trade.Buy(")==1 and source.count("trade.Sell(")==1
print(f"PASS: {len(defaults)} baseline and fast preset inputs; shared risk/identity guards preserved")
