// New experimental implementation. No original EX5 source was recovered.
// This program implements the rules documented in its accompanying README.
#property strict
#property version "1.00"
#property copyright "EliteTrade - Experimental research EA"
#property description "M1 liquidity sweep followed by a closed-bar breakout."
#property description "Independent experimental rules; not a verified StopHunter clone."

input group "Execution"
input bool InpEnableNewEntries = true;
input bool InpAllowRealAccounts = false;
input ENUM_TIMEFRAMES InpEntryTimeframe = PERIOD_M1;
input ulong InpMagic = 15102601;
input int InpMaxDeviationPoints = 20;
input bool InpWriteAuditCSV = true;

input group "Sweep and breakout"
input int InpRangeBars = 12;
input int InpATRPeriod = 14;
input double InpMinSweepATR = 0.05;
input double InpBreakoutBufferATR = 0.02;
input double InpStopBufferATR = 0.15;
input double InpRewardRisk = 2.0;
input double InpMaxEntryChaseATR = 0.50;
input bool InpUseTrendFilter = true;
input ENUM_TIMEFRAMES InpTrendTimeframe = PERIOD_M15;
input int InpTrendEMAPeriod = 50;

input group "Risk limits"
input double InpRiskPercent = 0.25;
input double InpMaximumLots = 0.10;
input double InpRiskReservePercent = 10.0;
input double InpDailyLossPercent = 2.0;
input double InpPeakDrawdownPercent = 5.0;
input double InpMaxSpreadATR = 0.15;
input double InpMaxMarginFraction = 0.25;

input group "Position management"
input bool InpUseBreakeven = true;
input double InpBreakevenAtR = 1.0;
input double InpBreakevenBufferATR = 0.02;
input bool InpUseATRTrailing = true;
input double InpTrailStartR = 1.5;
input double InpTrailingATR = 1.5;

input group "Optional broker-server session"
input bool InpUseSessionFilter = false;
input int InpSessionStartHour = 0;
input int InpSessionEndHour = 24;

// BEGIN PORTABLE CORE -- exact functions are also exercised by the C++ tests.
struct ESBar { double open; double high; double low; double close; };
bool ESPositive(const double x) { return MathIsValidNumber(x) && x>0.0; }
bool ESValidBar(const ESBar &b)
{
   return ESPositive(b.open) && ESPositive(b.high) && ESPositive(b.low) &&
          ESPositive(b.close) && b.high>=MathMax(b.open,b.close) &&
          b.low<=MathMin(b.open,b.close) && b.high>=b.low;
}
int ESSignal(const ESBar &sweep,const ESBar &confirm,const double rangeHigh,
             const double rangeLow,const double minimumSweep,const double buffer)
{
   if(!ESValidBar(sweep) || !ESValidBar(confirm) || !ESPositive(rangeLow) ||
      !ESPositive(rangeHigh) || rangeHigh<=rangeLow || !MathIsValidNumber(minimumSweep) ||
      !MathIsValidNumber(buffer) || minimumSweep<0.0 || buffer<0.0) return 0;
   bool down=sweep.low<rangeLow-minimumSweep && sweep.close>rangeLow;
   bool up=sweep.high>rangeHigh+minimumSweep && sweep.close<rangeHigh;
   if(down && up) return 0;
   if(down && confirm.close>sweep.high+buffer && confirm.close>confirm.open) return 1;
   if(up && confirm.close<sweep.low-buffer && confirm.close<confirm.open) return -1;
   return 0;
}
double ESPrice(const double value,const double tick,const bool upward)
{
   if(!ESPositive(value) || !ESPositive(tick)) return 0.0;
   double units=value/tick;
   return (upward ? MathCeil(units-1e-9) : MathFloor(units+1e-9))*tick;
}
double ESVolume(const double raw,const double minimum,const double maximum,const double step)
{
   if(!ESPositive(raw) || !ESPositive(minimum) || !ESPositive(maximum) ||
      !ESPositive(step) || maximum<minimum) return 0.0;
   double cap=MathMin(raw,maximum);
   double value=MathFloor(cap/step+1e-10)*step;
   if(value>cap+1e-10) value-=step;
   return value+1e-10<minimum ? 0.0 : value;
}
double ESBudget(const double equity,const double riskPercent,const double dayBase,
                const double peak,const double dailyPercent,const double drawdownPercent,
                const double reservePercent)
{
   if(!ESPositive(equity) || !ESPositive(riskPercent) || !ESPositive(dayBase) ||
      !ESPositive(peak) || !ESPositive(dailyPercent) || !ESPositive(drawdownPercent) ||
      !MathIsValidNumber(reservePercent) || reservePercent<0.0 || reservePercent>=100.0) return 0.0;
   double daily=dayBase*dailyPercent/100.0-(dayBase-equity);
   double drawdown=peak*drawdownPercent/100.0-(peak-equity);
   double available=MathMin(equity*riskPercent/100.0,MathMin(daily,drawdown));
   return MathMax(0.0,available)*(1.0-reservePercent/100.0);
}
bool ESSession(const int hour,const int start,const int end)
{
   if(hour<0 || hour>23 || start<0 || start>23 || end<0 || end>24) return false;
   if(start==end || (start==0 && end==24)) return true;
   return start<end ? (hour>=start && hour<end) : (hour>=start || hour<end);
}
// END PORTABLE CORE

int g_atr=INVALID_HANDLE,g_ema=INVALID_HANDLE,g_audit=INVALID_HANDLE;
bool g_tester=false,g_owner=false,g_dailyHalt=false,g_drawdownHalt=false,g_uncertain=false;
double g_ownerToken=0.0,g_dayBase=0.0,g_peak=0.0,g_initialRisk=0.0;
int g_day=0,g_signal=0;
ulong g_positionId=0;
datetime g_evaluatedBar=0,g_attemptBar=0;
long g_lastModifyMs=0;
double g_signalStop=0.0,g_signalClose=0.0,g_signalATR=0.0;
string g_prefix="",g_symbolKey="",g_status="Starting";

uint ESHash(const string value)
{
   uint result=2166136261;
   for(int i=0;i<StringLen(value);i++) { result^=(uint)StringGetCharacter(value,i); result*=16777619; }
   return result;
}
string DayKey() { return g_prefix+".D"+IntegerToString(g_day); }
double ReadState(const string key,const double fallback)
{
   double value=0.0;
   if(!g_tester && GlobalVariableGet(key,value) && MathIsValidNumber(value)) return value;
   return fallback;
}
bool WriteState(const string key,const double value)
{
   if(g_tester) return true;
   if(GlobalVariableSet(key,value)>0) return true;
   g_uncertain=true;
   Print("STATE WRITE FAILED: ",key," error=",GetLastError());
   return false;
}
void FlushState() { if(!g_tester) GlobalVariablesFlush(); }
void Status(const string value)
{
   if(value!=g_status) {g_status=value; Print("ESBX: ",value);}
   Comment("EliteTrade SweepBreakout EXPERIMENTAL v1\nIndependent rules - original EX5 equivalence unverified\n",
           _Symbol," | ",EnumToString(InpEntryTimeframe),"\n",g_status,
           "\nRequested risk: ",DoubleToString(InpRiskPercent,2),"% | entry permission: ",
           InpEnableNewEntries ? "enabled" : "paused","\nSession times use broker server time.");
}
void Audit(const string event,const ulong order,const ulong deal,const ulong position,
           const int side,const double volume,const double price,const double sl,
           const double tp,const uint code,const string note,const long observedMs=0)
{
   if(g_audit==INVALID_HANDLE) return;
   long at=observedMs>0 ? observedMs : (long)TimeCurrent()*1000;
   FileSeek(g_audit,0,SEEK_END);
   FileWrite(g_audit,event,at,_Symbol,(string)order,(string)deal,(string)position,
             side==1 ? "buy" : side==-1 ? "sell" : "",DoubleToString(volume,8),
             DoubleToString(price,_Digits),DoubleToString(sl,_Digits),DoubleToString(tp,_Digits),code,note);
   FileFlush(g_audit);
}
bool TradingPermission()
{
   if(!g_tester && !TerminalInfoInteger(TERMINAL_CONNECTED)) {Status("Terminal disconnected");return false;}
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) || !AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      {Status("Trading permission is disabled in MT5 or on this account");return false;}
   if(!g_tester && AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL && !InpAllowRealAccounts)
      {Status("Real-account entries and management require explicit opt-in");return false;}
   return true;
}
bool RefreshRiskState()
{
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(!ESPositive(equity)) {Status("Account equity unavailable");return false;}
   MqlDateTime tm;
   if(!TimeToStruct(TimeCurrent(),tm)) return false;
   int day=tm.year*10000+tm.mon*100+tm.day;
   if(day!=g_day)
   {
      g_day=day;
      g_dayBase=ReadState(DayKey()+".base",equity);
      g_dailyHalt=ReadState(DayKey()+".halt",0.0)>0.0;
      WriteState(DayKey()+".base",g_dayBase);
      FlushState();
   }
   g_peak=MathMax(g_peak,ReadState(g_prefix+".peak",g_peak));
   g_dailyHalt=g_dailyHalt || ReadState(DayKey()+".halt",0.0)>0.0;
   g_drawdownHalt=g_drawdownHalt || ReadState(g_prefix+".halt",0.0)>0.0;
   if(!ESPositive(g_dayBase)) {Status("Invalid daily equity baseline");return false;}
   if(equity>g_peak) {g_peak=equity;WriteState(g_prefix+".peak",g_peak);}
   if(equity<=g_dayBase*(1.0-InpDailyLossPercent/100.0) && !g_dailyHalt)
      {g_dailyHalt=true;WriteState(DayKey()+".halt",1.0);FlushState();}
   if(equity<=g_peak*(1.0-InpPeakDrawdownPercent/100.0) && !g_drawdownHalt)
      {g_drawdownHalt=true;WriteState(g_prefix+".halt",1.0);FlushState();}
   return true;
}
bool SymbolExposure()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0 && PositionSelectByTicket(ticket) && PositionGetString(POSITION_SYMBOL)==_Symbol) return true;
   }
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong ticket=OrderGetTicket(i);
      if(ticket>0 && OrderSelect(ticket) && OrderGetString(ORDER_SYMBOL)==_Symbol) return true;
   }
   return false;
}
bool FillPolicy(ENUM_ORDER_TYPE_FILLING &policy)
{
   long mode=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   if((mode&SYMBOL_FILLING_FOK)!=0) {policy=ORDER_FILLING_FOK;return true;}
   if((mode&SYMBOL_FILLING_IOC)!=0) {policy=ORDER_FILLING_IOC;return true;}
   if(SymbolInfoInteger(_Symbol,SYMBOL_TRADE_EXEMODE)!=SYMBOL_TRADE_EXECUTION_MARKET)
      {policy=ORDER_FILLING_RETURN;return true;}
   return false;
}
bool DefiniteRejection(const uint code)
{
   return code==TRADE_RETCODE_REQUOTE || code==TRADE_RETCODE_REJECT ||
      code==TRADE_RETCODE_INVALID || code==TRADE_RETCODE_INVALID_VOLUME ||
      code==TRADE_RETCODE_INVALID_PRICE || code==TRADE_RETCODE_INVALID_STOPS ||
      code==TRADE_RETCODE_TRADE_DISABLED || code==TRADE_RETCODE_MARKET_CLOSED ||
      code==TRADE_RETCODE_NO_MONEY || code==TRADE_RETCODE_PRICE_CHANGED ||
      code==TRADE_RETCODE_PRICE_OFF || code==TRADE_RETCODE_INVALID_FILL ||
      code==TRADE_RETCODE_INVALID_ORDER || code==TRADE_RETCODE_INVALID_EXPIRATION;
}
double BrokerDistance(const bool modifying=false)
{
   long stops=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long freeze=modifying ? SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL) : 0;
   return (MathMax(stops,freeze)+2)*_Point;
}
bool ReadATR(double &value)
{
   double buffer[1];
   if(CopyBuffer(g_atr,0,1,1,buffer)!=1 || !ESPositive(buffer[0])) return false;
   value=buffer[0];return true;
}
ESBar Bar(const MqlRates &rate)
{
   ESBar result;
   result.open=rate.open;result.high=rate.high;result.low=rate.low;result.close=rate.close;
   return result;
}
bool EvaluateClosedBars()
{
   datetime current=iTime(_Symbol,InpEntryTimeframe,0);
   if(current<=0 || current==g_evaluatedBar) return true;
   MqlRates bars[];ArraySetAsSeries(bars,true);
   int needed=InpRangeBars+3;
   if(CopyRates(_Symbol,InpEntryTimeframe,0,needed,bars)!=needed || !ReadATR(g_signalATR))
      {Status("Waiting for closed bars and ATR history");return false;}
   double trend=0.0,trendClose=0.0;
   if(InpUseTrendFilter)
   {
      double buffer[1];
      if(CopyBuffer(g_ema,0,1,1,buffer)!=1 || !ESPositive(buffer[0]))
         {Status("Waiting for the closed higher-timeframe EMA");return false;}
      trend=buffer[0];trendClose=iClose(_Symbol,InpTrendTimeframe,1);
      if(!ESPositive(trendClose)) return false;
   }
   g_evaluatedBar=current;g_signal=0;
   int seconds=PeriodSeconds(InpEntryTimeframe);
   if(bars[0].time-bars[1].time!=seconds || bars[1].time-bars[2].time!=seconds)
      {Status("Recent candle sequence has a gap");return true;}
   double high=bars[3].high,low=bars[3].low;
   for(int i=3;i<needed;i++)
   {
      ESBar value=Bar(bars[i]);
      if(!ESValidBar(value)) {Status("Invalid reference-range data");return true;}
      high=MathMax(high,bars[i].high);low=MathMin(low,bars[i].low);
   }
   ESBar sweep=Bar(bars[2]),confirmation=Bar(bars[1]);
   g_signal=ESSignal(sweep,confirmation,high,low,g_signalATR*InpMinSweepATR,g_signalATR*InpBreakoutBufferATR);
   if(InpUseTrendFilter && ((g_signal==1 && trendClose<=trend) || (g_signal==-1 && trendClose>=trend))) g_signal=0;
   g_signalStop=g_signal==1 ? MathMin(bars[2].low,bars[1].low)-g_signalATR*InpStopBufferATR :
                              MathMax(bars[2].high,bars[1].high)+g_signalATR*InpStopBufferATR;
   g_signalClose=bars[1].close;
   if(g_signal==0) Status("Monitoring: no closed-bar sweep and breakout setup");
   else Audit("signal",0,0,0,g_signal,0,g_signalClose,g_signalStop,0,0,"closed-bar sweep+breakout");
   return true;
}
void ManagePositions(const MqlTick &quote)
{
   if(!InpUseBreakeven && !InpUseATRTrailing) return;
   if(quote.time_msc-g_lastModifyMs<1000) return;
   double atr=0.0,tick=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(!ReadATR(atr) || !ESPositive(tick)) return;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket) || PositionGetString(POSITION_SYMBOL)!=_Symbol ||
         (ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      ulong identifier=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
      int side=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY ? 1 : -1;
      double entry=PositionGetDouble(POSITION_PRICE_OPEN),oldSL=PositionGetDouble(POSITION_SL),tp=PositionGetDouble(POSITION_TP);
      if(identifier!=g_positionId)
      {
         g_positionId=identifier;g_initialRisk=ReadState(g_prefix+".R."+(string)identifier,0.0);
         if(!ESPositive(g_initialRisk) && ESPositive(oldSL) && side*(entry-oldSL)>0.0)
            {g_initialRisk=side*(entry-oldSL);WriteState(g_prefix+".R."+(string)identifier,g_initialRisk);FlushState();}
      }
      if(!ESPositive(g_initialRisk)) {Status("Initial position risk unavailable; broker SL/TP retained");continue;}
      double exit=side==1 ? quote.bid : quote.ask;
      double progress=side*(exit-entry),proposed=oldSL;
      if(InpUseBreakeven && progress>=InpBreakevenAtR*g_initialRisk)
      {
         double be=entry+side*InpBreakevenBufferATR*atr;
         if(proposed==0.0 || side*(be-proposed)>0.0) proposed=be;
      }
      if(InpUseATRTrailing && progress>=InpTrailStartR*g_initialRisk)
      {
         double trail=exit-side*InpTrailingATR*atr;
         if(proposed==0.0 || side*(trail-proposed)>0.0) proposed=trail;
      }
      proposed=NormalizeDouble(ESPrice(proposed,tick,side==-1),_Digits);
      double distance=BrokerDistance(true);
      double freeze=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL)*_Point;
      if(!ESPositive(proposed) || (oldSL>0.0 && side*(proposed-oldSL)<tick*0.9) || side*(exit-proposed)<distance ||
         (oldSL>0.0 && MathAbs(exit-oldSL)<=freeze) || (tp>0.0 && MathAbs(tp-exit)<=freeze)) continue;
      MqlTradeRequest request={};MqlTradeResult result={};MqlTradeCheckResult check={};
      request.action=TRADE_ACTION_SLTP;request.symbol=_Symbol;request.position=ticket;
      request.magic=InpMagic;request.sl=proposed;request.tp=tp;
      g_lastModifyMs=quote.time_msc;
      if(!OrderCheck(request,check) || (check.retcode!=0 && check.retcode!=TRADE_RETCODE_DONE)) continue;
      bool sent=OrderSend(request,result);
      Audit("position.sl-request",result.order,result.deal,identifier,side,PositionGetDouble(POSITION_VOLUME),entry,proposed,tp,result.retcode,sent?result.comment:"OrderSend returned false");
      if(!sent || (result.retcode!=TRADE_RETCODE_DONE && result.retcode!=TRADE_RETCODE_NO_CHANGES))
         Print("SL update unconfirmed: ",result.retcode," ",result.comment);
   }
}
void TryEntry(const MqlTick &quote)
{
   if(!InpEnableNewEntries) {Status("New entries paused; owned-position management remains enabled");return;}
   g_uncertain=g_uncertain || ReadState(g_symbolKey+".uncertain",0.0)>0.0;
   if(g_uncertain) {Status("Entry locked: reconcile the previous uncertain request in MT5");return;}
   if(g_drawdownHalt || g_dailyHalt) {Status(g_drawdownHalt ? "Peak drawdown limit reached" : "Daily loss limit reached");return;}
   if(SymbolExposure()) {Status("Monitoring existing symbol exposure; no additional entry");return;}
   if(!EvaluateClosedBars() || g_signal==0) return;
   g_attemptBar=(datetime)ReadState(g_symbolKey+".attempt",(double)g_attemptBar);
   if(g_attemptBar>=g_evaluatedBar) {Status("This candle already had an entry attempt");return;}
   MqlDateTime tm;TimeToStruct(TimeCurrent(),tm);
   if(InpUseSessionFilter && !ESSession(tm.hour,InpSessionStartHour,InpSessionEndHour)) {Status("Waiting for configured broker-server session");return;}
   if(quote.ask-quote.bid>InpMaxSpreadATR*g_signalATR) {Status("Waiting: spread exceeds ATR allowance");return;}
   long tradeMode=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE);
   if(tradeMode!=SYMBOL_TRADE_MODE_FULL && tradeMode!=(g_signal==1 ? SYMBOL_TRADE_MODE_LONGONLY : SYMBOL_TRADE_MODE_SHORTONLY))
      {Status("Broker symbol trading mode blocks this direction");return;}
   long orderModes=SymbolInfoInteger(_Symbol,SYMBOL_ORDER_MODE);
   if((orderModes&SYMBOL_ORDER_MARKET)==0 || (orderModes&SYMBOL_ORDER_SL)==0 || (orderModes&SYMBOL_ORDER_TP)==0)
      {Status("Broker does not support protected market entries");return;}
   double entry=g_signal==1 ? quote.ask : quote.bid;
   if(MathAbs(entry-g_signalClose)>InpMaxEntryChaseATR*g_signalATR) {Status("Waiting: entry moved too far from confirmation close");return;}
   double tick=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE),minimum=BrokerDistance();
   if(!ESPositive(tick) || !ESPositive(minimum)) return;
   double exit=g_signal==1 ? quote.bid : quote.ask;
   double sl=g_signal==1 ? MathMin(g_signalStop,exit-minimum) : MathMax(g_signalStop,exit+minimum);
   sl=NormalizeDouble(ESPrice(sl,tick,g_signal==-1),_Digits);
   double risk=g_signal*(entry-sl);
   if(!ESPositive(sl) || !ESPositive(risk)) return;
   double tp=NormalizeDouble(ESPrice(entry+g_signal*InpRewardRisk*risk,tick,g_signal==1),_Digits);
   if(!ESPositive(tp) || g_signal*(exit-sl)<minimum || g_signal*(tp-exit)<minimum) {Status("Broker stop distance blocks entry");return;}
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double budget=ESBudget(equity,InpRiskPercent,g_dayBase,g_peak,InpDailyLossPercent,InpPeakDrawdownPercent,InpRiskReservePercent);
   double minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),maxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   ENUM_ORDER_TYPE type=g_signal==1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double minLoss=0.0;
   if(!ESPositive(budget) || !ESPositive(minLot) || !OrderCalcProfit(type,_Symbol,minLot,entry,sl,minLoss) || minLoss>=0.0)
      {Status("Unable to calculate stop-loss risk");return;}
   double volume=NormalizeDouble(ESVolume(budget/(-minLoss)*minLot,minLot,MathMin(maxLot,InpMaximumLots),step),8);
   double plannedLoss=0.0;
   if(!ESPositive(volume) || !OrderCalcProfit(type,_Symbol,volume,entry,sl,plannedLoss) || plannedLoss>=0.0 || -plannedLoss>budget+1e-8)
      {Status("Risk budget cannot cover a valid broker lot");return;}
   double margin=0.0,free=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(!ESPositive(free) || !OrderCalcMargin(type,_Symbol,volume,entry,margin) || margin<0.0 || margin>free*InpMaxMarginFraction)
      {Status("Insufficient configured margin allowance");return;}
   MqlTradeRequest request={};MqlTradeResult result={};MqlTradeCheckResult check={};
   ENUM_ORDER_TYPE_FILLING filling=ORDER_FILLING_FOK;
   if(!FillPolicy(filling)) {Status("Unsupported broker fill policy");return;}
   request.action=TRADE_ACTION_DEAL;request.magic=InpMagic;request.symbol=_Symbol;request.volume=volume;
   request.type=type;request.price=entry;request.sl=sl;request.tp=tp;
   request.deviation=(ulong)InpMaxDeviationPoints;request.type_filling=filling;request.comment="ESBX experimental v1";
   if(!OrderCheck(request,check) || (check.retcode!=0 && check.retcode!=TRADE_RETCODE_DONE))
      {Status("Broker preflight rejected entry: "+check.comment);return;}
   // Persist both attempt and ambiguity marker BEFORE requesting broker execution.
   g_attemptBar=g_evaluatedBar;
   if(!WriteState(g_symbolKey+".attempt",(double)g_attemptBar) || !WriteState(g_symbolKey+".uncertain",1.0)) return;
   FlushState();g_uncertain=true;
   Audit("entry.request",0,0,0,g_signal,volume,entry,sl,tp,0,"requested; not yet broker-confirmed");
   bool sent=OrderSend(request,result);
   Audit("entry.result",result.order,result.deal,0,g_signal,result.volume,result.price,sl,tp,result.retcode,result.comment);
   // PLACED/timeout/connection errors do not authorize an automatic retry.
   if(sent && (result.retcode==TRADE_RETCODE_DONE || result.retcode==TRADE_RETCODE_DONE_PARTIAL) && result.deal>0)
   {
      if(HistoryDealSelect(result.deal))
      {
         ulong identifier=(ulong)HistoryDealGetInteger(result.deal,DEAL_POSITION_ID);
         double filledRisk=g_signal*(HistoryDealGetDouble(result.deal,DEAL_PRICE)-sl);
         if(ESPositive(filledRisk))
         {
            WriteState(g_prefix+".R."+(string)identifier,filledRisk);
            g_positionId=identifier;g_initialRisk=filledRisk;
         }
      }
      if(WriteState(g_symbolKey+".uncertain",0.0)) g_uncertain=false;
      FlushState();Status("Broker confirmed entry; monitoring owned position");
   }
   else if(DefiniteRejection(result.retcode))
   {
      if(WriteState(g_symbolKey+".uncertain",0.0)) g_uncertain=false;
      FlushState();Status("Broker rejected entry; this candle will not be retried");
   }
   else Status("Entry result requires reconciliation; automatic retry is locked");
   g_signal=0;
}
int OnInit()
{
   g_tester=(bool)MQLInfoInteger(MQL_TESTER);
   if(InpRangeBars<3 || InpRangeBars>500 || InpATRPeriod<2 || InpATRPeriod>500 || InpTrendEMAPeriod<2 ||
      InpRiskPercent<=0.0 || InpRiskPercent>5.0 || InpMaximumLots<=0.0 || InpRewardRisk<0.25 ||
      InpDailyLossPercent<=0.0 || InpDailyLossPercent>=50.0 || InpPeakDrawdownPercent<=0.0 || InpPeakDrawdownPercent>=90.0 ||
      InpRiskReservePercent<0.0 || InpRiskReservePercent>=100.0 || InpMinSweepATR<0.0 || InpBreakoutBufferATR<0.0 ||
      InpStopBufferATR<0.0 || InpMaxEntryChaseATR<=0.0 || InpMaxSpreadATR<=0.0 ||
      InpMaxMarginFraction<=0.0 || InpMaxMarginFraction>1.0 || InpBreakevenAtR<=0.0 || InpBreakevenBufferATR<0.0 ||
      InpTrailStartR<=0.0 || InpTrailingATR<=0.0 || InpMaxDeviationPoints<0 || InpSessionStartHour<0 ||
      InpSessionStartHour>23 || InpSessionEndHour<0 || InpSessionEndHour>24 || InpMagic==0 || PeriodSeconds(InpEntryTimeframe)<60)
      {Print("Invalid EA inputs.");return INIT_PARAMETERS_INCORRECT;}
   if(!g_tester && (AccountInfoInteger(ACCOUNT_LOGIN)<=0 || StringLen(AccountInfoString(ACCOUNT_SERVER))==0))
      {Print("Connect a terminal account before attaching this EA.");return INIT_FAILED;}
   string account=(string)AccountInfoInteger(ACCOUNT_LOGIN)+"|"+AccountInfoString(ACCOUNT_SERVER)+"|"+(string)InpMagic;
   g_prefix=StringFormat("ESBX1.%u",ESHash(account));
   g_symbolKey=g_prefix+StringFormat(".S%u",ESHash(_Symbol));
   if(!g_tester)
   {
      if(!GlobalVariableTemp(g_symbolKey+".owner")) return INIT_FAILED;
      g_ownerToken=(double)(GetTickCount64()%1000000000)+1.0;
      if(!GlobalVariableSetOnCondition(g_symbolKey+".owner",g_ownerToken,0.0))
         {Print("Another instance owns this account/symbol/magic in this terminal.");return INIT_FAILED;}
      g_owner=true;
   }
   g_atr=iATR(_Symbol,InpEntryTimeframe,InpATRPeriod);
   if(InpUseTrendFilter) g_ema=iMA(_Symbol,InpTrendTimeframe,InpTrendEMAPeriod,0,MODE_EMA,PRICE_CLOSE);
   if(g_atr==INVALID_HANDLE || (InpUseTrendFilter && g_ema==INVALID_HANDLE)) return INIT_FAILED;
   g_peak=ReadState(g_prefix+".peak",AccountInfoDouble(ACCOUNT_EQUITY));
   g_drawdownHalt=ReadState(g_prefix+".halt",0.0)>0.0;
   g_attemptBar=(datetime)ReadState(g_symbolKey+".attempt",0.0);
   g_uncertain=ReadState(g_symbolKey+".uncertain",0.0)>0.0;
   if(InpWriteAuditCSV)
   {
      string filename=g_symbolKey+".csv";
      g_audit=FileOpen(filename,FILE_CSV|FILE_READ|FILE_WRITE|FILE_SHARE_READ|FILE_ANSI,',');
      if(g_audit==INVALID_HANDLE) {Print("Cannot open audit CSV: ",GetLastError());return INIT_FAILED;}
      if(FileSize(g_audit)==0) FileWrite(g_audit,"event","server_time_ms","symbol","order_id","deal_id","position_id","side","volume","price","sl","tp","retcode","note");
      Print("Audit CSV: MQL5/Files/",filename);
   }
   Print("EXPERIMENTAL independent sweep/breakout rules. Original EX5 equivalence and performance are unverified.");
   Status("Ready: waiting for market ticks and a valid closed-bar setup");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason)
{
   if(g_owner) GlobalVariableSetOnCondition(g_symbolKey+".owner",0.0,g_ownerToken);
   if(g_atr!=INVALID_HANDLE) IndicatorRelease(g_atr);
   if(g_ema!=INVALID_HANDLE) IndicatorRelease(g_ema);
   if(g_audit!=INVALID_HANDLE) FileClose(g_audit);
   FlushState();Comment("");
}
void OnTick()
{
   MqlTick quote;
   if(!SymbolInfoTick(_Symbol,quote) || !ESPositive(quote.bid) || !ESPositive(quote.ask) || quote.ask<quote.bid ||
      TimeCurrent()-quote.time>30 || quote.time-TimeCurrent()>5) {Status("Waiting for a valid fresh broker tick");return;}
   if(!RefreshRiskState() || !TradingPermission()) return;
   ManagePositions(quote);
   TryEntry(quote);
}
void OnTradeTransaction(const MqlTradeTransaction &transaction,const MqlTradeRequest &request,const MqlTradeResult &result)
{
   if(transaction.type!=TRADE_TRANSACTION_DEAL_ADD || transaction.deal==0 || !HistoryDealSelect(transaction.deal)) return;
   if(HistoryDealGetString(transaction.deal,DEAL_SYMBOL)!=_Symbol || (ulong)HistoryDealGetInteger(transaction.deal,DEAL_MAGIC)!=InpMagic) return;
   long type=HistoryDealGetInteger(transaction.deal,DEAL_TYPE);
   int side=type==DEAL_TYPE_BUY ? 1 : type==DEAL_TYPE_SELL ? -1 : 0;
   string note="entry="+(string)HistoryDealGetInteger(transaction.deal,DEAL_ENTRY)+
      ";profit="+DoubleToString(HistoryDealGetDouble(transaction.deal,DEAL_PROFIT),8)+
      ";commission="+DoubleToString(HistoryDealGetDouble(transaction.deal,DEAL_COMMISSION),8)+
      ";swap="+DoubleToString(HistoryDealGetDouble(transaction.deal,DEAL_SWAP),8);
   long entryKind=HistoryDealGetInteger(transaction.deal,DEAL_ENTRY);
   if((entryKind==DEAL_ENTRY_IN || entryKind==DEAL_ENTRY_INOUT) &&
      (g_uncertain || ReadState(g_symbolKey+".uncertain",0.0)>0.0))
   {
      // A subsequently observed genuine own-entry deal reconciles a timeout/PLACED result.
      if(WriteState(g_symbolKey+".uncertain",0.0)) g_uncertain=false;
      FlushState();
   }
   Audit("broker.deal",(ulong)HistoryDealGetInteger(transaction.deal,DEAL_ORDER),transaction.deal,
      (ulong)HistoryDealGetInteger(transaction.deal,DEAL_POSITION_ID),side,
      HistoryDealGetDouble(transaction.deal,DEAL_VOLUME),HistoryDealGetDouble(transaction.deal,DEAL_PRICE),0,0,0,note,
      HistoryDealGetInteger(transaction.deal,DEAL_TIME_MSC));
}
