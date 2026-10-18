#property strict
#property version "1.00"
#property description "King of Scalper BTC: experimental M1 EA with equity-risk sizing."
#property description "Defaults to demo/testing. No performance guarantee."
#include <Trade/Trade.mqh>
#include "King_BTC_Risk.mqh"

input group "1. ORDER SETTINGS"
input bool   InpAutoRisk=true;
input double InpRiskPercent=0.25;
input double InpFixedLot=0.01;
input double InpMaxLot=0.10;
input double InpStopATR=1.50;
input double InpRewardR=1.50;
input double InpCommissionRoundTripPerLot=0.0; // Account currency; set actual broker costs.
input double InpSlippageAllowanceTicks=3.0;

input group "2. BREAKEVEN"
input bool   InpBreakeven=true;
input double InpBETriggerR=1.0;

input group "3. DYNAMIC TRAILING"
input bool   InpTrailing=true;
input double InpTrailStartR=1.25;
input double InpTrailATR=1.0;

input group "4. TP HUNT"
input bool   InpTPHunt=false;
input double InpHuntStartR=1.40;
input double InpHuntATR=0.75;

input group "5. ENTRY AND ORDER MANAGEMENT"
input int    InpSetupExpirySeconds=20;
input bool   InpDeleteOpposite=true;
input int    InpStalePendingSeconds=60;

input group "6. MARKET STRUCTURE"
input int    InpSwingBars=5;
input int    InpMomentumBars=3;
input int    InpATRPeriod=14;
input int    InpTrendFastEMA=20;
input int    InpTrendSlowEMA=50;
input int    InpPullbackEMA=20;
input double InpPullbackToleranceATR=0.20;
input double InpMinMomentumATR=0.15;
input double InpMinATRPrice=0.0; // 0 disables absolute ATR floor.
input double InpMaxATRPrice=0.0; // 0 disables absolute ATR ceiling.

input group "7. ACCOUNT PROTECTION"
input double InpDailyLossMoney=20.0; // USD only when account currency is USD.
input double InpMaxDrawdownPercent=5.0;
input double InpDailyTargetMoney=0.0;
input bool   InpCloseOnProtection=true;
input int    InpResetHourServer=0;
input int    InpResetMinuteServer=0;
input int    InpProtectionResetToken=0; // Change explicitly while flat to clear persistent locks.

input group "8. GENERAL SETTINGS"
input ulong  InpMagic=77101801;
input bool   InpAllowLiveTrading=false;
input int    InpCooldownSeconds=60;
input int    InpMaxTradesPerDay=20; // Maximum submitted entry attempts, not partial-fill deals.
input int    InpDeviationPoints=50;
input double InpMaxSpreadATR=0.15;
input double InpMaxCostToTarget=0.20;
input double InpMaxMarginPercent=10.0;
input int    InpMaxQuoteAgeSeconds=5;
input int    InpModifyIntervalSeconds=3;
input bool   InpUseSession=false;
input int    InpSessionStartMinute=0;
input int    InpSessionEndMinute=0; // Equal start/end means all day.
input bool   InpShowPanel=true;

input group "9. TICK FLOW SCALP"
input bool   InpTickFlow=false; // Alternative entry mode; replaces pullback breakout.
input int    InpTickConfirm=3;

CTrade trade;
int hATR=INVALID_HANDLE,hFast=INVALID_HANDLE,hSlow=INVALID_HANDLE,hPull=INVALID_HANDLE;
string ns="",reason="Initializing";
double tickSize=0.0,pointSize=0.0,atrNow=0.0,lastVolume=0.0,lastRisk=0.0;
int digits=0,setupDirection=0,tickDirection=0,tickCount=0;
datetime lastBar=0,setupBar=0,lastMaintenance=0,lastModify=0;
double previousBid=0.0,leaseValue=0.0;
bool historyReady=false,stateReady=false,stateWriteFailed=false;
string GK(string suffix) { return ns+"."+suffix; }
double G(string suffix) { return GlobalVariableGet(GK(suffix)); }
void S(string suffix,double value)
{
   if(GlobalVariableSet(GK(suffix),value)==0)
   {
      stateWriteFailed=true;
      Print("KingBTC: state write failed; entries locked. Error=",GetLastError());
   }
}
void Flush() { GlobalVariablesFlush(); }
void Note(string text)
{
   if(reason!=text) Print("KingBTC: ",text);
   reason=text;
}
uint HashText(string value)
{
   uint hash=2166136261;
   for(int i=0;i<StringLen(value);i++) { hash^=(uint)StringGetCharacter(value,i); hash*=16777619; }
   return hash;
}
bool Acquire()
{
   double old=G("lease");
   if(old>(double)TimeLocal()) return false;
   leaseValue=(double)TimeLocal()+120.0;
   return GlobalVariableSetOnCondition(GK("lease"),leaseValue,old);
}
void Release()
{
   GlobalVariableSetOnCondition(GK("lease"),0.0,leaseValue);
}
bool OwnPosition()
{
   return PositionGetString(POSITION_SYMBOL)==_Symbol &&
          (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagic;
}
bool OwnOrder()
{
   return OrderGetString(ORDER_SYMBOL)==_Symbol &&
          (ulong)OrderGetInteger(ORDER_MAGIC)==InpMagic;
}
bool HasOwnPosition()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(PositionGetTicket(i)>0 && OwnPosition()) return true;
   return false;
}
bool HasOwnExposure()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(PositionGetTicket(i)>0 && OwnPosition()) return true;
   for(int i=OrdersTotal()-1;i>=0;i--)
      if(OrderGetTicket(i)>0 && OwnOrder()) return true;
   return false;
}
bool AnySymbolExposure()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(PositionGetTicket(i)>0 && PositionGetString(POSITION_SYMBOL)==_Symbol) return true;
   for(int i=OrdersTotal()-1;i>=0;i--)
      if(OrderGetTicket(i)>0 && OrderGetString(ORDER_SYMBOL)==_Symbol) return true;
   return false;
}
bool PositionIsExclusivelyOurs(ulong ticket)
{
   if(!PositionSelectByTicket(ticket) || !OwnPosition()) return false;
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE)==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      return true;
   ulong identifier=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
   if(!HistorySelectByPosition(identifier)) return false;
   bool sawEntry=false;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong deal=HistoryDealGetTicket(i);
      ENUM_DEAL_TYPE type=(ENUM_DEAL_TYPE)HistoryDealGetInteger(deal,DEAL_TYPE);
      if(type!=DEAL_TYPE_BUY && type!=DEAL_TYPE_SELL) continue;
      if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagic) return false;
      sawEntry=true;
   }
   return sawEntry && PositionSelectByTicket(ticket) && OwnPosition();
}
datetime DayStart(datetime now)
{
   MqlDateTime dt;
   TimeToStruct(now,dt);
   dt.hour=InpResetHourServer; dt.min=InpResetMinuteServer; dt.sec=0;
   datetime start=StructToTime(dt);
   if(now<start) start-=86400;
   return start;
}
bool ReadFlows(double &flows,bool &correction)
{
   flows=0.0; correction=false;
   if(!HistorySelect((datetime)G("anchor"),TimeCurrent())) return false;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0) return false;
      ENUM_DEAL_TYPE type=(ENUM_DEAL_TYPE)HistoryDealGetInteger(deal,DEAL_TYPE);
      if(type==DEAL_TYPE_BALANCE || type==DEAL_TYPE_CREDIT || type==DEAL_TYPE_BONUS)
         flows+=HistoryDealGetDouble(deal,DEAL_PROFIT);
      if(type==DEAL_TYPE_CORRECTION) correction=true;
   }
   return true;
}
bool InitializeState()
{
   string marker=GK("version");
   bool exposure=HasOwnExposure();
   if(!GlobalVariableCheck(marker))
   {
      if(exposure)
      {
         Note("State missing while positions/orders exist: restore state before attaching.");
         return false;
      }
      S("anchor",(double)TimeCurrent());
      double flows=0.0; bool correction=false;
      if(!ReadFlows(flows,correction)) return false;
      S("cash",flows);
      S("base",AccountInfoDouble(ACCOUNT_EQUITY));
      S("peak",AccountInfoDouble(ACCOUNT_EQUITY));
      S("day",(double)DayStart(TimeCurrent()));
      S("daylock",0); S("ddlock",0); S("fault",0); S("exit",0);
      S("budget",0); S("plannedSL",0);
      S("attempt",0); S("entry",0); S("trades",0);
      S("reset",(double)InpProtectionResetToken);
      S("version",1); Flush();
   }
   string required[]={"anchor","cash","base","peak","day","daylock","ddlock","fault","attempt","entry","trades","reset","exit","budget","plannedSL"};
   for(int i=0;i<ArraySize(required);i++)
      if(!GlobalVariableCheck(GK(required[i]))) return false;
   if(G("version")!=1.0) return false;
   if((int)G("reset")!=InpProtectionResetToken)
   {
      if(exposure) { Note("Protection reset refused while this EA has exposure."); return false; }
      double flows=0.0; bool correction=false;
      S("anchor",(double)TimeCurrent());
      if(!ReadFlows(flows,correction)) return false;
      S("cash",flows); S("base",AccountInfoDouble(ACCOUNT_EQUITY));
      S("peak",AccountInfoDouble(ACCOUNT_EQUITY)); S("day",(double)DayStart(TimeCurrent()));
      S("daylock",0); S("ddlock",0); S("fault",0); S("exit",0); S("trades",0);
      S("reset",(double)InpProtectionResetToken); Flush();
      Print("KingBTC: explicit protection reset applied.");
   }
   return true;
}
void SetFault(string text)
{
   S("fault",1); S("exit",1); Flush(); Note(text);
}
bool UpdateProtection()
{
   double flows=0.0; bool correction=false;
   historyReady=ReadFlows(flows,correction);
   if(!historyReady) { Note("History unavailable: entries paused."); return false; }
   double cashDelta=flows-G("cash");
   if(MathAbs(cashDelta)>1e-8)
   {
      S("base",G("base")+cashDelta);
      S("peak",G("peak")+cashDelta);
      S("cash",flows); Flush();
   }
   if(correction && G("fault")==0.0) SetFault("Broker correction detected: review history and reset while flat.");
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity<=0.0 || !MathIsValidNumber(equity)) { SetFault("Invalid/nonpositive equity: protection exit requested."); return false; }
   datetime day=DayStart(TimeCurrent());
   if((datetime)G("day")!=day)
   {
      // First observed sample after rollover; never invent historical midnight equity.
      S("day",(double)day); S("base",equity); S("daylock",0); S("trades",0); Flush();
   }
   if(equity>G("peak")) { S("peak",equity); Flush(); }
   double daily=equity-G("base");
   if(InpDailyLossMoney>0.0 && daily<=-InpDailyLossMoney && G("daylock")==0.0)
      { S("daylock",1); S("exit",1); Flush(); Print("KingBTC: daily equity loss lock."); }
   if(InpDailyTargetMoney>0.0 && daily>=InpDailyTargetMoney && G("daylock")==0.0)
      { S("daylock",2); S("exit",1); Flush(); Print("KingBTC: daily target lock."); }
   double peak=G("peak");
   if(peak<=0.0) { SetFault("Cash-adjusted high-water equity is invalid."); return false; }
   if(InpMaxDrawdownPercent>0.0 && (peak-equity)/peak*100.0>=InpMaxDrawdownPercent && G("ddlock")==0.0)
      { S("ddlock",1); S("exit",1); Flush(); Print("KingBTC: persistent drawdown lock."); }
   return true;
}
bool Locked() { return stateWriteFailed || G("exit")!=0.0 || G("daylock")!=0.0 || G("ddlock")!=0.0 || G("fault")!=0.0; }
bool CanSend()
{
   return (bool)TerminalInfoInteger(TERMINAL_CONNECTED) &&
          (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) &&
          (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) &&
          (bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
}
bool CheckResult(bool requestOK,string action,bool entry=false)
{
   uint code=trade.ResultRetcode();
   PrintFormat("KingBTC %s: ok=%s retcode=%u %s order=%I64u deal=%I64u",
      action,requestOK?"true":"false",code,trade.ResultRetcodeDescription(),trade.ResultOrder(),trade.ResultDeal());
   bool accepted=code==TRADE_RETCODE_DONE || code==TRADE_RETCODE_DONE_PARTIAL || code==TRADE_RETCODE_PLACED;
   if(!entry && code==TRADE_RETCODE_NO_CHANGES) return requestOK;
   if(entry && (!accepted && (code==TRADE_RETCODE_TIMEOUT || code==TRADE_RETCODE_CONNECTION ||
                             code==TRADE_RETCODE_ERROR || code==0)))
      SetFault("Entry outcome uncertain: reconcile broker history, then reset while flat.");
   // Any asynchronous acceptance consumes the setup; never retry the remaining volume.
   if(entry && accepted && !HasOwnExposure() && !ConfirmedClosedDeal(trade.ResultDeal()))
      SetFault("Entry accepted but exposure not yet reconciled: review broker state.");
   return requestOK && accepted;
}
bool ConfirmedClosedDeal(ulong deal)
{
   if(deal==0 || !HistoryDealSelect(deal)) return false;
   ulong identifier=(ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID);
   if(identifier==0 || !HistorySelectByPosition(identifier)) return false;
   double net=0.0; bool exitSeen=false;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong d=HistoryDealGetTicket(i);
      ENUM_DEAL_TYPE type=(ENUM_DEAL_TYPE)HistoryDealGetInteger(d,DEAL_TYPE);
      if(type!=DEAL_TYPE_BUY && type!=DEAL_TYPE_SELL) continue;
      if((ulong)HistoryDealGetInteger(d,DEAL_MAGIC)!=InpMagic) return false;
      net+=(type==DEAL_TYPE_BUY?1.0:-1.0)*HistoryDealGetDouble(d,DEAL_VOLUME);
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(d,DEAL_ENTRY);
      if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) exitSeen=true;
   }
   return exitSeen && MathAbs(net)<1e-8;
}
void Cleanup(bool protection)
{
   if(!HasOwnExposure())
   {
      if(G("exit")!=0.0) { S("exit",0); Flush(); }
      return;
   }
   if(!CanSend()) return;
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong ticket=OrderGetTicket(i);
      if(ticket==0 || !OwnOrder()) continue;
      bool stale=TimeCurrent()-(datetime)OrderGetInteger(ORDER_TIME_SETUP)>=InpStalePendingSeconds;
      if(protection || stale || (InpDeleteOpposite && HasOwnPosition()))
         CheckResult(trade.OrderDelete(ticket),"delete pending");
   }
   if(!protection || !InpCloseOnProtection) return;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !OwnPosition()) continue;
      if(!PositionIsExclusivelyOurs(ticket))
         { Note("Netting position contains foreign deals: manual review required."); continue; }
      CheckResult(trade.PositionClose(ticket,(ulong)InpDeviationPoints),"protection close");
   }
}
bool IndicatorValue(int handle,int shift,double &value)
{
   double buffer[1];
   if(CopyBuffer(handle,0,shift,1,buffer)!=1) return false;
   value=buffer[0];
   return MathIsValidNumber(value) && value!=EMPTY_VALUE;
}
double MinimumStopDistance()
{
   long stops=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long freeze=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   return (double)MathMax(stops,freeze)*pointSize+tickSize;
}
// Reconcile delayed and partial fills using the immutable pre-submission stop/budget.
void ReconcilePositions()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !OwnPosition()) continue;
      if(!PositionIsExclusivelyOurs(ticket))
         { SetFault("Mixed netting ownership: manual reconciliation required."); continue; }
      string id=(string)PositionGetInteger(POSITION_IDENTIFIER);
      bool buy=(ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
      double fill=PositionGetDouble(POSITION_PRICE_OPEN);
      double volume=PositionGetDouble(POSITION_VOLUME);
      double currentSL=PositionGetDouble(POSITION_SL);
      if(currentSL<=0.0) { SetFault("Position has no protective SL."); continue; }
      if(!GlobalVariableCheck(GK("I"+id)) || !GlobalVariableCheck(GK("B"+id)))
      {
         datetime opened=(datetime)PositionGetInteger(POSITION_TIME);
         if(G("plannedSL")<=0.0 || G("budget")<=0.0 || (double)opened+5.0<G("entry"))
            { SetFault("Original entry risk records missing; no trailing-SL reconstruction."); continue; }
         S("I"+id,G("plannedSL")); S("B"+id,G("budget")); Flush();
      }
      double initialSL=G("I"+id);
      double initialR=buy?fill-initialSL:initialSL-fill;
      if(initialR<=0.0) { SetFault("Unexpected fill beyond original protective stop."); continue; }
      S("R"+id,initialR);
      double loss=0.0;
      if(!OrderCalcProfit(buy?ORDER_TYPE_BUY:ORDER_TYPE_SELL,_Symbol,volume,fill,initialSL,loss))
         { SetFault("Unable to verify filled-position risk."); continue; }
      double risk=MathAbs(loss)+volume*InpCommissionRoundTripPerLot;
      if(risk>G("B"+id)+1e-8)
         SetFault("Delayed/partial fill exceeds original budget; protective exit requested.");
      // Manual widening/removal must not bypass the budget.
      if((buy && currentSL<initialSL-tickSize*0.1) || (!buy && currentSL>initialSL+tickSize*0.1))
         SetFault("Protective stop was widened beyond original stop.");
   }
   Flush();
}

void ManagePositions()
{
   if(!CanSend() || TimeCurrent()-lastModify<InpModifyIntervalSeconds) return;
   if(!IndicatorValue(hATR,1,atrNow) || atrNow<=0.0) return;
   MqlTick quote;
   if(!SymbolInfoTick(_Symbol,quote)) return;
   lastModify=TimeCurrent();
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !OwnPosition()) continue;
      if(!PositionIsExclusivelyOurs(ticket))
         { Note("Foreign netting activity: EA will not modify this position."); continue; }
      bool buy=(ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
      double entry=PositionGetDouble(POSITION_PRICE_OPEN);
      double sl=PositionGetDouble(POSITION_SL),tp=PositionGetDouble(POSITION_TP);
      if(sl<=0.0) { SetFault("Owned position has no stop: protection exit requested."); continue; }
      string riskKey="R"+(string)PositionGetInteger(POSITION_IDENTIFIER);
      if(!GlobalVariableCheck(GK(riskKey)))
         { SetFault("Original R unavailable: protective exit requested."); continue; }
      double initialR=G(riskKey);
      if(initialR<=0.0) { SetFault("Invalid original R."); continue; }
      double market=buy?quote.bid:quote.ask;
      double profitDistance=buy?market-entry:entry-market;
      double candidate=sl;
      double minDist=MinimumStopDistance();
      double ref=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),unit=0.0;
      if(ref<=0.0 || !OrderCalcProfit(buy?ORDER_TYPE_BUY:ORDER_TYPE_SELL,_Symbol,ref,
                                    entry,entry+(buy?tickSize:-tickSize),unit)) continue;
      double perPrice=MathAbs(unit)/(ref*tickSize);
      if(perPrice<=0.0) continue;
      double costDistance=InpCommissionRoundTripPerLot/perPrice+InpSlippageAllowanceTicks*tickSize;
      if(InpBreakeven && profitDistance>=InpBETriggerR*initialR)
      {
         double be=entry+(buy?costDistance:-costDistance);
         candidate=buy?MathMax(candidate,be):MathMin(candidate,be);
      }
      if(InpTrailing && profitDistance>=InpTrailStartR*initialR)
      {
         double trail=market+(buy?-InpTrailATR*atrNow:InpTrailATR*atrNow);
         candidate=buy?MathMax(candidate,trail):MathMin(candidate,trail);
      }
      if(InpTPHunt && profitDistance>=InpHuntStartR*initialR)
      {
         double hunt=market+(buy?-InpHuntATR*atrNow:InpHuntATR*atrNow);
         candidate=buy?MathMax(candidate,hunt):MathMin(candidate,hunt);
      }
      candidate=buy?KPriceFloor(MathMin(candidate,quote.bid-minDist),tickSize):
                    KPriceCeil(MathMax(candidate,quote.ask+minDist),tickSize);
      candidate=NormalizeDouble(candidate,digits);
      bool improve=buy?candidate>=sl+tickSize*0.99:candidate<=sl-tickSize*0.99;
      if(improve && candidate>0.0)
         CheckResult(trade.PositionModify(ticket,candidate,tp),"tighten stop");
   }
}
bool SessionAllowed()
{
   if(!InpUseSession || InpSessionStartMinute==InpSessionEndMinute) return true;
   MqlDateTime dt; TimeToStruct(TimeCurrent(),dt);
   int minute=dt.hour*60+dt.min;
   if(InpSessionStartMinute<InpSessionEndMinute)
      return minute>=InpSessionStartMinute && minute<InpSessionEndMinute;
   return minute>=InpSessionStartMinute || minute<InpSessionEndMinute;
}
void BuildSetup()
{
   setupDirection=0;
   int count=MathMax(InpSwingBars+3,InpMomentumBars+3);
   MqlRates bars[]; ArraySetAsSeries(bars,true);
   if(CopyRates(_Symbol,PERIOD_M1,0,count,bars)!=count)
      { Note("Waiting for M1 history."); return; }
   double fast=0.0,slow=0.0,pull=0.0;
   if(!IndicatorValue(hATR,1,atrNow) || !IndicatorValue(hFast,1,fast) ||
      !IndicatorValue(hSlow,1,slow) || !IndicatorValue(hPull,2,pull) || atrNow<=0.0)
      { Note("Waiting for indicators."); return; }
   if((InpMinATRPrice>0.0 && atrNow<InpMinATRPrice) ||
      (InpMaxATRPrice>0.0 && atrNow>InpMaxATRPrice))
      { Note("ATR outside allowed range."); return; }
   int trend=fast>slow?1:fast<slow?-1:0;
   double momentum=bars[1].close-bars[1+InpMomentumBars].close;
   bool momentumOK=trend>0?momentum>=InpMinMomentumATR*atrNow:
                          trend<0 && -momentum>=InpMinMomentumATR*atrNow;
   if(!momentumOK) { Note("No trend-aligned closed-candle momentum."); return; }
   if(InpTickFlow) setupDirection=trend;
   else
   {
      double swingHigh=bars[2].high,swingLow=bars[2].low;
      for(int i=3;i<2+InpSwingBars;i++)
         { swingHigh=MathMax(swingHigh,bars[i].high); swingLow=MathMin(swingLow,bars[i].low); }
      bool pullBuy=bars[2].low<=pull+InpPullbackToleranceATR*atrNow && bars[2].close>=pull;
      bool pullSell=bars[2].high>=pull-InpPullbackToleranceATR*atrNow && bars[2].close<=pull;
      if(trend>0 && pullBuy && bars[1].close>swingHigh && bars[1].close>bars[1].open)
         setupDirection=1;
      if(trend<0 && pullSell && bars[1].close<swingLow && bars[1].close<bars[1].open)
         setupDirection=-1;
   }
   setupBar=bars[0].time;
   Note(setupDirection==0?"No closed-candle pullback breakout.":"Entry setup detected.");
}
void TryEntry(MqlTick &quote)
{
   if(setupDirection==0 || !stateReady || !historyReady) return;
   if(TimeCurrent()-setupBar>InpSetupExpirySeconds)
      { setupDirection=0; Note("Setup expired."); return; }
   if((datetime)G("attempt")>=setupBar) { setupDirection=0; return; }
   if(Locked()) { Note("Protection lock active."); return; }
   if(!CanSend()) { Note("Connection or Algo Trading permission unavailable."); return; }
   if(!InpAllowLiveTrading && (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL)
      { Note("Live trading disabled in Inputs."); return; }
   if(!SessionAllowed()) { Note("Outside configured server-time session."); return; }
   if(AnySymbolExposure()) { Note("Existing symbol position or pending order: entry blocked."); return; }
   if(TimeCurrent()-(datetime)G("entry")<InpCooldownSeconds)
      { Note("Entry cooldown."); return; }
   if(InpMaxTradesPerDay>0 && G("trades")>=InpMaxTradesPerDay)
      { Note("Daily submitted-entry limit reached."); return; }
   if(InpTickFlow && (tickDirection!=setupDirection || tickCount<InpTickConfirm)) return;
   double spread=quote.ask-quote.bid;
   if(quote.bid<=0.0 || quote.ask<=quote.bid || quote.time<=0 ||
      (long)TimeCurrent()-(long)quote.time>InpMaxQuoteAgeSeconds)
      { Note("Invalid or stale quote."); return; }
   if(atrNow<=0.0 || spread>InpMaxSpreadATR*atrNow)
      { Note("Spread exceeds ATR limit."); return; }
   bool buy=setupDirection>0;
   ENUM_ORDER_TYPE type=buy?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   ENUM_SYMBOL_TRADE_MODE mode=(ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE);
   if(mode==SYMBOL_TRADE_MODE_DISABLED || mode==SYMBOL_TRADE_MODE_CLOSEONLY ||
      (buy && mode==SYMBOL_TRADE_MODE_SHORTONLY) || (!buy && mode==SYMBOL_TRADE_MODE_LONGONLY))
      { Note("Symbol direction unavailable."); return; }
   long orderMode=SymbolInfoInteger(_Symbol,SYMBOL_ORDER_MODE);
   if((orderMode&SYMBOL_ORDER_SL)==0 || (orderMode&SYMBOL_ORDER_TP)==0)
      { Note("Broker does not permit attached SL/TP."); return; }
   double entry=buy?quote.ask:quote.bid,minDist=MinimumStopDistance();
   double rawSL=entry+(buy?-InpStopATR*atrNow:InpStopATR*atrNow);
   double sl=buy?KPriceFloor(MathMin(rawSL,quote.bid-minDist),tickSize):
                 KPriceCeil(MathMax(rawSL,quote.ask+minDist),tickSize);
   sl=NormalizeDouble(sl,digits);
   double stopDistance=MathAbs(entry-sl);
   double tp=buy?KPriceCeil(entry+InpRewardR*stopDistance,tickSize):
                 KPriceFloor(entry-InpRewardR*stopDistance,tickSize);
   tp=NormalizeDouble(tp,digits);
   if(sl<=0.0 || tp<=0.0 || stopDistance<=0.0) { Note("Invalid protective prices."); return; }
   double minimum=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maximum=MathMin(SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),InpMaxLot);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double refLoss=0.0,refReward=0.0;
   double adverseEntry=entry+(buy?InpSlippageAllowanceTicks*tickSize:-InpSlippageAllowanceTicks*tickSize);
   if(minimum<=0.0 || step<=0.0 || maximum<minimum ||
      !OrderCalcProfit(type,_Symbol,minimum,adverseEntry,sl,refLoss) || refLoss>=0.0 ||
      !OrderCalcProfit(type,_Symbol,minimum,entry,tp,refReward) || refReward<=0.0)
      { Note("Broker risk calculation unavailable."); return; }
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double budget=equity*InpRiskPercent/100.0;
   if(InpDailyLossMoney>0.0) budget=MathMin(budget,InpDailyLossMoney+(equity-G("base")));
   if(InpMaxDrawdownPercent>0.0)
      budget=MathMin(budget,equity-G("peak")*(1.0-InpMaxDrawdownPercent/100.0));
   double unitLoss=MathAbs(refLoss)/minimum;
   double volume=KRiskVolume(budget,unitLoss,InpCommissionRoundTripPerLot,minimum,maximum,step);
   if(!InpAutoRisk)
   {
      double fixed=KFloorVolume(InpFixedLot,step);
      if(fixed<minimum-1e-10 || fixed>maximum+1e-10 ||
         fixed*(unitLoss+InpCommissionRoundTripPerLot)>budget+1e-8) volume=0.0;
      else volume=fixed;
   }
   volume=NormalizeDouble(volume,8);
   if(volume<minimum-1e-10 || volume<=0.0)
      { Note("Minimum/fixed lot exceeds risk budget or volume limits."); return; }
   double exactLoss=0.0,margin=0.0;
   if(!OrderCalcProfit(type,_Symbol,volume,adverseEntry,sl,exactLoss) ||
      !OrderCalcMargin(type,_Symbol,volume,adverseEntry,margin))
      { Note("Exact broker risk/margin calculation failed."); return; }
   lastRisk=MathAbs(exactLoss)+volume*InpCommissionRoundTripPerLot; lastVolume=volume;
   if(lastRisk>budget+1e-8) { Note("Rounded volume exceeds budget."); return; }
   double spreadCost=0.0,slipCost=0.0;
   if(!OrderCalcProfit(type,_Symbol,minimum,entry,buy?quote.bid:quote.ask,spreadCost) ||
      !OrderCalcProfit(type,_Symbol,minimum,entry,adverseEntry,slipCost))
      { Note("Cost calculation failed."); return; }
   double estimatedCost=MathAbs(spreadCost)/minimum+MathAbs(slipCost)/minimum+InpCommissionRoundTripPerLot;
   if(estimatedCost/(refReward/minimum)>InpMaxCostToTarget)
      { Note("Estimated costs exceed allowed target share."); return; }
   if(margin<0.0 || margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE) ||
      AccountInfoDouble(ACCOUNT_MARGIN)+margin>equity*InpMaxMarginPercent/100.0)
      { Note("Margin budget exceeded."); return; }
   // Persist before submission: no restart or timeout can reuse this setup.
   S("attempt",(double)setupBar); S("entry",(double)TimeCurrent()); S("trades",G("trades")+1.0);
   S("budget",budget); S("plannedSL",sl); Flush();
   if(stateWriteFailed) { Note("State persistence failed: order submission canceled."); return; }
   setupDirection=0;
   bool sent=buy?trade.Buy(volume,_Symbol,0.0,sl,tp,"KingBTC v1"):
                 trade.Sell(volume,_Symbol,0.0,sl,tp,"KingBTC v1");
   bool accepted=CheckResult(sent,"entry",true);
   if(accepted)
   {
      ReconcilePositions();
      if(!Locked()) Note(HasOwnExposure()?"Entry accepted; monitoring broker position.":"Entry confirmed completed; no open exposure.");
   }
   else if(!Locked()) Note("Entry rejected; setup consumed. See Experts log.");
}
void Panel()
{
   if(!InpShowPanel) return;
   MqlTick quote; SymbolInfoTick(_Symbol,quote);
   double equity=AccountInfoDouble(ACCOUNT_EQUITY),peak=G("peak");
   double dd=peak>0.0?MathMax(0.0,(peak-equity)/peak*100.0):0.0;
   Comment("KING OF SCALPER BTC | EXPERIMENTAL v1.00\n",
      _Symbol," M1 | ",InpTickFlow?"Tick continuation":"Pullback breakout",
      "\nBalance: ",DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2),
      "  Equity: ",DoubleToString(equity,2)," ",AccountInfoString(ACCOUNT_CURRENCY),
      "\nSpread: ",DoubleToString(quote.ask-quote.bid,digits),"  ATR: ",DoubleToString(atrNow,digits),
      "\nLast planned lot: ",DoubleToString(lastVolume,8),"  Risk: ",DoubleToString(lastRisk,2),
      "\nDaily equity P/L: ",DoubleToString(equity-G("base"),2),"  DD: ",DoubleToString(dd,2),"%",
      "\nDay/DD/Fault locks: ",(int)G("daylock"),"/",(int)G("ddlock"),"/",(int)G("fault"),
      "\n",reason);
}
bool ValidInputs()
{
   return InpRiskPercent>0.0 && InpRiskPercent<=1.0 && InpFixedLot>0.0 && InpMaxLot>0.0 &&
      InpStopATR>0.0 && InpRewardR>0.0 && InpCommissionRoundTripPerLot>=0.0 &&
      InpSlippageAllowanceTicks>=0.0 && InpBETriggerR>0.0 && InpTrailStartR>0.0 &&
      InpTrailATR>0.0 && InpHuntStartR>0.0 && InpHuntATR>0.0 &&
      InpSetupExpirySeconds>0 && InpSetupExpirySeconds<=60 && InpStalePendingSeconds>0 &&
      InpSwingBars>=2 && InpSwingBars<=100 && InpMomentumBars>=1 && InpMomentumBars<=100 &&
      InpATRPeriod>=2 && InpTrendFastEMA>=2 && InpTrendSlowEMA>InpTrendFastEMA &&
      InpPullbackEMA>=2 && InpPullbackToleranceATR>=0.0 && InpMinMomentumATR>=0.0 &&
      InpMinATRPrice>=0.0 && InpMaxATRPrice>=0.0 &&
      (InpMaxATRPrice==0.0 || InpMaxATRPrice>=InpMinATRPrice) &&
      InpDailyLossMoney>0.0 && InpMaxDrawdownPercent>0.0 && InpMaxDrawdownPercent<=20.0 &&
      InpDailyTargetMoney>=0.0 && InpResetHourServer>=0 && InpResetHourServer<24 &&
      InpResetMinuteServer>=0 && InpResetMinuteServer<60 && InpProtectionResetToken>=0 &&
      InpMagic>0 && InpCooldownSeconds>=0 && InpMaxTradesPerDay>=0 &&
      InpDeviationPoints>=0 && InpMaxSpreadATR>0.0 && InpMaxCostToTarget>0.0 &&
      InpMaxMarginPercent>0.0 && InpMaxMarginPercent<=100.0 && InpMaxQuoteAgeSeconds>0 &&
      InpModifyIntervalSeconds>=1 && InpSessionStartMinute>=0 && InpSessionStartMinute<1440 &&
      InpSessionEndMinute>=0 && InpSessionEndMinute<1440 && InpTickConfirm>=2 && InpTickConfirm<=20;
}
int OnInit()
{
   if(!ValidInputs()) return INIT_PARAMETERS_INCORRECT;
   string symbol=_Symbol; StringToUpper(symbol);
   if(StringFind(symbol,"BTC")<0 || StringFind(symbol,"USD")<0)
      { Print("Attach to your broker's BTCUSD symbol, including its suffix."); return INIT_PARAMETERS_INCORRECT; }
   if(_Period!=PERIOD_M1) { Print("Attach EA to M1 chart."); return INIT_PARAMETERS_INCORRECT; }
   if(!SymbolSelect(_Symbol,true)) return INIT_FAILED;
   tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   pointSize=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   if(tickSize<=0.0 || pointSize<=0.0) return INIT_FAILED;
   ns="KBT1."+StringFormat("%I64d",AccountInfoInteger(ACCOUNT_LOGIN))+"."+
      IntegerToString((long)HashText(AccountInfoString(ACCOUNT_SERVER)+"|"+_Symbol+"|"+(string)InpMagic));
   if((bool)MQLInfoInteger(MQL_TESTER)) ns+=".test";
   // Test passes must not inherit another test's state.
   if((bool)MQLInfoInteger(MQL_TESTER)) GlobalVariablesDeleteAll(ns+".");
   if(!GlobalVariableCheck(GK("lease"))) S("lease",0.0);
   if(!Acquire()) { Print("Another instance holds the EA lease."); return INIT_FAILED; }
   stateReady=InitializeState();
   Release();
   if(!stateReady || stateWriteFailed) return INIT_FAILED;
   trade.SetExpertMagicNumber(InpMagic); trade.SetAsyncMode(false);
   trade.SetDeviationInPoints((ulong)InpDeviationPoints);
   trade.SetMarginMode();
   if(!trade.SetTypeFillingBySymbol(_Symbol)) return INIT_FAILED;
   hATR=iATR(_Symbol,PERIOD_M1,InpATRPeriod);
   hFast=iMA(_Symbol,PERIOD_M5,InpTrendFastEMA,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(_Symbol,PERIOD_M5,InpTrendSlowEMA,0,MODE_EMA,PRICE_CLOSE);
   hPull=iMA(_Symbol,PERIOD_M1,InpPullbackEMA,0,MODE_EMA,PRICE_CLOSE);
   if(hATR==INVALID_HANDLE || hFast==INVALID_HANDLE || hSlow==INVALID_HANDLE || hPull==INVALID_HANDLE)
      return INIT_FAILED;
   lastBar=iTime(_Symbol,PERIOD_M1,0);
   if(!EventSetTimer(1)) return INIT_FAILED;
   Print("KingBTC initialized. Account currency=",AccountInfoString(ACCOUNT_CURRENCY),
      "; commission allowance/lot=",InpCommissionRoundTripPerLot,
      "; initial day baseline is the first observed equity, not reconstructed midnight equity.");
   Note("Waiting for next completed M1 candle.");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int why)
{
   EventKillTimer();
   if(hATR!=INVALID_HANDLE) IndicatorRelease(hATR);
   if(hFast!=INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow!=INVALID_HANDLE) IndicatorRelease(hSlow);
   if(hPull!=INVALID_HANDLE) IndicatorRelease(hPull);
   if(InpShowPanel) Comment("");
   if(stateReady) Flush();
}
void OnTimer()
{
   if(!stateReady || !Acquire()) return;
   bool ready=UpdateProtection();
   Cleanup(Locked());
   if(ready && !Locked()) { ReconcilePositions(); if(!Locked()) ManagePositions(); }
   if(Locked()) Cleanup(true);
   Release(); Panel();
}
void OnTick()
{
   if(!stateReady || !Acquire()) return;
   MqlTick quote;
   if(!SymbolInfoTick(_Symbol,quote)) { Release(); return; }
   if(quote.bid!=previousBid)
   {
      int direction=previousBid<=0.0?0:quote.bid>previousBid?1:-1;
      tickCount=direction==tickDirection?tickCount+1:1;
      tickDirection=direction; previousBid=quote.bid;
   }
   bool ready=true;
   if(TimeCurrent()!=lastMaintenance)
   {
      ready=UpdateProtection(); lastMaintenance=TimeCurrent();
      Cleanup(Locked());
      if(ready && !Locked()) { ReconcilePositions(); if(!Locked()) ManagePositions(); }
   }
   if(ready && !Locked())
   {
      datetime bar=iTime(_Symbol,PERIOD_M1,0);
      if(bar>0 && bar!=lastBar) { lastBar=bar; BuildSetup(); }
      TryEntry(quote);
   }
   if(Locked()) { Note("Protection lock active: review panel and Experts log."); Cleanup(true); }
   Release(); Panel();
}
