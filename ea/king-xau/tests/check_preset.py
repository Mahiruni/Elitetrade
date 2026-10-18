from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
source=(root/"King_of_Scalper_XAU.mq5").read_text()
defaults=dict(re.findall(r"^input\s+(?:bool|double|int|ulong)\s+(Inp\w+)\s*=\s*([^;]+);",source,re.M))
def read(name):
    return dict(line.split("=",1) for line in (root/name).read_text().splitlines() if line and not line.startswith(";"))
preset=read("King_of_Scalper_XAU_Demo.set")
fast=read("King_of_Scalper_XAU_Fast_Demo.set")
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

assert defaults["InpMagic"]=="77101802", "Gold requires a separate magic number"
btc=root.parent/"king-btc"
assert (root/"King_XAU_Risk.mqh").read_text().replace("KING_XAU_RISK","KING_BTC_RISK") == (btc/"King_BTC_Risk.mqh").read_text(), "Gold sizing logic diverged"
assert (root/"King_XAU_Ticks.mqh").read_text().replace("KING_XAU_TICKS","KING_BTC_TICKS") == (btc/"King_BTC_Ticks.mqh").read_text(), "Gold rolling-window logic diverged"
assert 'KGoldCurrencyPair(base_currency,profit_currency)' in source
assert 'SYMBOL_CURRENCY_BASE' in source and 'SYMBOL_CURRENCY_PROFIT' in source
print("PASS: distinct gold identity, currency metadata guard, shared risk/tick parity")
