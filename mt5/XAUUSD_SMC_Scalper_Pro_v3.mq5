//+------------------------------------------------------------------+
//|  XAUUSD_SMC_Scalper_Pro_v3.mq5                                    |
//|  Strict, risk-capped MT5 Expert Advisor | research / demo first   |
//|  Never assume a high win rate. Validate in Strategy Tester first. |
//+------------------------------------------------------------------+
#property copyright "EliteTrade - Gold SMC Scalper"
#property version   "3.00"
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

input group "Risk & safety"
input bool   InpEnableNewEntries       = false; // OFF by default. Arm in MT5 after demo validation.
input double InpRiskPercent            = 0.5;
input double InpMaxDailyLossPercent    = 2.5;
input double InpTP1RR                  = 1.0;
input double InpTP2RR                  = 2.5;
input double InpCloseAtTP1Percent      = 70.0;
input int    InpBEBufferPoints         = 15;
input bool   InpATRTrailRunner         = true;
input double InpTrailATRMult           = 1.5;
input ulong  InpMagic                   = 990026;

input group "SMC logic"
input ENUM_TIMEFRAMES InpHTF           = PERIOD_M15;
input ENUM_TIMEFRAMES InpEntryTF       = PERIOD_M5;
input int    InpHTF_EMA                = 50;
input int    InpSwingBars              = 8;
input double InpOTE_Shallow            = 0.618;
input double InpOTE_Deep               = 0.786;
input int    InpMinFVGPoints           = 25;
input int    InpStopBufferPoints       = 30;
input int    InpMaxEntryDeviationPts   = 15;

input group "Gold market guards"
input int    InpATRPeriod              = 14;
input int    InpMinATRPoints           = 40;
input int    InpMaxATRPoints           = 350;
input int    InpMaxSpreadPoints        = 25;
input bool   InpBlockHighImpactNews    = true; // Missing calendar = no new trade.
input int    InpNewsBlockBeforeMin     = 30;
input int    InpNewsBlockAfterMin      = 30;
input int    InpLondonStartUTC         = 7;
input int    InpLondonEndUTC           = 10;
input int    InpNewYorkStartUTC        = 12;
input int    InpNewYorkEndUTC          = 16;

int g_emaHandle=INVALID_HANDLE, g_atrHandle=INVALID_HANDLE;
datetime g_lastEntryBar=0;
string g_dayPrefix="";
double g_dayBaseline=0;
bool g_dayHalted=false;

// Return-code inspection is mandatory: CTrade's bool alone is not execution.
bool TradeDone()
{
   uint code=trade.ResultRetcode();
   return (code==TRADE_RETCODE_DONE || code==TRADE_RETCODE_DONE_PARTIAL);
}
string PositionKey(ulong identifier,string field)
{
   return StringFormat("GSM3.%I64d.%I64u.%I64u.%s",
                      AccountInfoInteger(ACCOUNT_LOGIN),InpMagic,identifier,field);
}
datetime UTCNow() { return TimeGMT(); }
string DayPrefix()
{
   MqlDateTime t; TimeToStruct(UTCNow(),t);
   return StringFormat("GSM3.%I64d.%I64u.%04d%02d%02d",
           AccountInfoInteger(ACCOUNT_LOGIN),InpMagic,t.year,t.mon,t.day);
}
void RefreshDailyGuard()
{
   string name=DayPrefix();
   if(name!=g_dayPrefix)
   {
      g_dayPrefix=name;
      string key=name+".base";
      if(!GlobalVariableCheck(key))
         GlobalVariableSet(key,AccountInfoDouble(ACCOUNT_EQUITY));
      g_dayBaseline=GlobalVariableGet(key);
   }
   string haltKey=g_dayPrefix+".halt";
   g_dayHalted=GlobalVariableCheck(haltKey) && GlobalVariableGet(haltKey)>0;
   if(g_dayBaseline<=0 || !MathIsValidNumber(g_dayBaseline))
      { g_dayHalted=true; return; }
   double threshold=g_dayBaseline*(1.0-InpMaxDailyLossPercent/100.0);
   if(AccountInfoDouble(ACCOUNT_EQUITY)<=threshold)
   {
      GlobalVariableSet(haltKey,1);
      g_dayHalted=true;
   }
}
double ATRPoints()
{
   double data[1];
   if(CopyBuffer(g_atrHandle,0,1,1,data)!=1 || !MathIsValidNumber(data[0]))
      return 0;
   return data[0]/_Point;
}
int Bias()
{
   double buf[1];
   if(CopyBuffer(g_emaHandle,0,1,1,buf)!=1) return 0;
   double close=iClose(_Symbol,InpHTF,1);
   double lo=iLow(_Symbol,InpHTF,1),priorLo=iLow(_Symbol,InpHTF,2);
   double hi=iHigh(_Symbol,InpHTF,1),priorHi=iHigh(_Symbol,InpHTF,2);
   if(close>buf[0] && lo>=priorLo)return 1;
   if(close<buf[0] && hi<=priorHi)return -1;
   return 0;
}
bool WithinSession()
{
   MqlDateTime t;TimeToStruct(UTCNow(),t);
   return (t.hour>=InpLondonStartUTC && t.hour<InpLondonEndUTC) ||
          (t.hour>=InpNewYorkStartUTC && t.hour<InpNewYorkEndUTC);
}
bool NewsSafe()
{
   if(!InpBlockHighImpactNews)return true;
   // Calendar functions use the trade server's clock, not UTC.
   datetime current=TimeTradeServer();
   if(current<=0)return false;
   MqlCalendarValue values[];
   int total=CalendarValueHistory(values,
      current-InpNewsBlockAfterMin*60,
      current+InpNewsBlockBeforeMin*60,"","USD");
   if(total<0)return false;  // Data outage: fail closed.
   for(int i=0;i<total;i++)
   {
      MqlCalendarEvent e;
      if(!CalendarEventById(values[i].event_id,e))return false;
      if(e.importance==CALENDAR_IMPORTANCE_HIGH)return false;
   }
   return true;
}
bool SymbolExposure()
{
   // Do not layer over unrelated positions or pending orders on gold.
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0 && PositionSelectByTicket(ticket) &&
         PositionGetString(POSITION_SYMBOL)==_Symbol)return true;
   }
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong ticket=OrderGetTicket(i);
      if(ticket>0 && OrderSelect(ticket) &&
         OrderGetString(ORDER_SYMBOL)==_Symbol)return true;
   }
   return false;
}
double RoundStop(double value,bool upward)
{
   double tick=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tick<=0)return 0;
   double n=upward ? MathCeil(value/tick-1e-9) : MathFloor(value/tick+1e-9);
   return NormalizeDouble(n*tick,_Digits);
}
double RiskCappedVolume(ENUM_ORDER_TYPE type,double entry,double sl)
{
   double budget=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double loss=0;
   if(budget<=0 || !OrderCalcProfit(type,_Symbol,1.0,entry,sl,loss) || loss>=0)
      return 0;
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double minV=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxV=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   if(step<=0||minV<=0||maxV<minV)return 0;
   double raw=MathMin(maxV,budget/(-loss));
   double lots=NormalizeDouble(MathFloor((raw+1e-10)/step)*step,8);
   // Never force the minimum lot if the minimum exceeds the risk budget.
   if(lots<minV)return 0;
   double actualLoss=0;
   if(!OrderCalcProfit(type,_Symbol,lots,entry,sl,actualLoss) ||
      actualLoss>=0 || -actualLoss>budget+0.01)return 0;
   return lots;
}
bool ValidStopDistance(int side,double entry,double stop,double tp)
{
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   long stops=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double required=(stops+2)*_Point;
   if(side==1)return (stop>0 && stop<entry && bid-stop>=required && tp-bid>=required);
   return (stop>entry && stop-ask>=required && ask-tp>=required && tp>0);
}
bool FindSetup(int side,double &stop)
{
   MqlRates b[];
   ArraySetAsSeries(b,true);
   int count=CopyRates(_Symbol,InpEntryTF,0,100,b);
   if(count<65)return false;
   // b[1] is the last fully closed bar; never use b[0] for signals.
   for(int sweep=8;sweep<=24;sweep++)
   {
      double priorHigh=-DBL_MAX,priorLow=DBL_MAX;
      for(int j=sweep+1;j<=sweep+InpSwingBars;j++)
      {
         priorHigh=MathMax(priorHigh,b[j].high);
         priorLow=MathMin(priorLow,b[j].low);
      }
      bool liquidity=(side==1)
         ? (b[sweep].low<priorLow && b[sweep].close>priorLow)
         : (b[sweep].high>priorHigh && b[sweep].close<priorHigh);
      if(!liquidity)continue;
      // Structure shift must occur AFTER sweep (smaller series index).
      for(int shift=sweep-1;shift>=3 && shift>=sweep-7;shift--)
      {
         bool mss=(side==1)
            ? (b[shift].close>priorHigh && b[shift].close>b[shift].open)
            : (b[shift].close<priorLow && b[shift].close<b[shift].open);
         if(!mss)continue;
         double body=0;
         for(int j=shift+1;j<=shift+8;j++)
            body+=MathAbs(b[j].close-b[j].open)/8.0;
         if(MathAbs(b[shift].close-b[shift].open)<1.2*body)continue;
         // Displacement FVG followed by a later OTE touch and rejection.
         for(int j=shift;j>=2 && j>=shift-4;j--)
         {
            double gapLow,gapHigh;
            if(side==1) {gapLow=b[j+2].high;gapHigh=b[j].low;}
            else {gapLow=b[j].high;gapHigh=b[j+2].low;}
            if(gapHigh-gapLow<InpMinFVGPoints*_Point)continue;
            double pivot=(side==1)?b[sweep].low:b[sweep].high;
            double extreme=pivot;
            for(int k=j;k<=sweep;k++)
            {
               if(side==1)extreme=MathMax(extreme,b[k].high);
               else extreme=MathMin(extreme,b[k].low);
            }
            double range=MathAbs(extreme-pivot);
            if(range<=InpMinFVGPoints*_Point*2)continue;
            double zoneLow=(side==1)?extreme-InpOTE_Deep*range:extreme+InpOTE_Shallow*range;
            double zoneHigh=(side==1)?extreme-InpOTE_Shallow*range:extreme+InpOTE_Deep*range;
            double intersectionLow=MathMax(zoneLow,gapLow);
            double intersectionHigh=MathMin(zoneHigh,gapHigh);
            if(intersectionLow>intersectionHigh)continue;
            bool touched=b[1].low<=intersectionHigh && b[1].high>=intersectionLow;
            bool rejection=(side==1)
               ? (b[1].close>b[1].open && b[1].close>b[2].close && b[1].close>=zoneLow)
               : (b[1].close<b[1].open && b[1].close<b[2].close && b[1].close<=zoneHigh);
            if(!touched||!rejection||j<=1)continue;
            if(side==1)stop=RoundStop(MathMin(b[sweep].low,b[1].low)-InpStopBufferPoints*_Point,false);
            else stop=RoundStop(MathMax(b[sweep].high,b[1].high)+InpStopBufferPoints*_Point,true);
            return stop>0;
         }
      }
   }
   return false;
}
void OpenSignal(int side,double stop)
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick) || tick.ask<=tick.bid)return;
   double entry=side==1?tick.ask:tick.bid;
   double distance=MathAbs(entry-stop);
   if(distance<=0 || (side==1&&stop>=entry) || (side==-1&&stop<=entry))return;
   double target=side==1?entry+distance*InpTP2RR:entry-distance*InpTP2RR;
   target=RoundStop(target,side==1);
   if(!ValidStopDistance(side,entry,stop,target))return; // Do not silently widen risk.
   ENUM_ORDER_TYPE type=side==1?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   double lots=RiskCappedVolume(type,entry,stop);
   if(lots<=0)return;
   double margin=0;
   if(!OrderCalcMargin(type,_Symbol,lots,entry,margin) || margin<=0 ||
      margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*0.5)return;
   bool submitted=side==1?
      trade.Buy(lots,_Symbol,0.0,stop,target,"Gold_SMC_v3"):
      trade.Sell(lots,_Symbol,0.0,stop,target,"Gold_SMC_v3");
   if(!submitted || !TradeDone())
      Print("Entry NOT confirmed. Server retcode=",trade.ResultRetcode());
}
void ManageOwnPositions()
{
   MqlTick t; if(!SymbolInfoTick(_Symbol,t))return;
   double atr=ATRPoints();
   long stops=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long freeze=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minDistance=(MathMax(stops,freeze)+3)*_Point;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0||!PositionSelectByTicket(ticket))continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol||
         (ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic)continue;
      long kind=PositionGetInteger(POSITION_TYPE);
      int side=kind==POSITION_TYPE_BUY?1:-1;
      double open=PositionGetDouble(POSITION_PRICE_OPEN),sl=PositionGetDouble(POSITION_SL);
      double tp=PositionGetDouble(POSITION_TP),vol=PositionGetDouble(POSITION_VOLUME);
      ulong identifier=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
      string stageKey=PositionKey(identifier,"stage"),riskKey=PositionKey(identifier,"risk");
      // Missing SL or TP is an emergency requiring manual reconciliation.
      if(sl<=0||tp<=0){Print("Unprotected gold position ",ticket," - manual attention required");continue;}
      double risk=GlobalVariableCheck(riskKey)?GlobalVariableGet(riskKey):0;
      if(risk<=0 && side*(open-sl)>0)
      {
         risk=MathAbs(open-sl);GlobalVariableSet(riskKey,risk);
      }
      if(risk<=0)continue;
      double price=side==1?t.bid:t.ask;
      double stage=GlobalVariableCheck(stageKey)?GlobalVariableGet(stageKey):0;
      bool hitTP1=side*(price-open)>=risk*InpTP1RR;
      if(stage==0 && hitTP1)
      {
         double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
         double minV=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
         if(step<=0 || minV<=0)continue;
         double closeLots=NormalizeDouble(MathFloor((vol*InpCloseAtTP1Percent/100.0)/step)*step,8);
         // Write an 'unknown' marker BEFORE sending a non-idempotent partial close.
         // Crash/network ambiguity never triggers an automatic second close.
         GlobalVariableSet(stageKey,-1.0);
         if(closeLots>=minV && vol-closeLots>=minV)
         {
            if(trade.PositionClosePartial(ticket,closeLots) && TradeDone())
               GlobalVariableSet(stageKey,1.0);
            else Print("Partial close unconfirmed; inspect position ",ticket," and reconcile stage manually.");
         }
         else
         {
            // Broker minimum volumes prevent a 70% split: protect with BE only.
            Print("Minimum lot prevents partial close. Breakeven-only fallback: ",ticket);
            GlobalVariableSet(stageKey,1.0);
         }
         stage=GlobalVariableGet(stageKey);
         if(!PositionSelectByTicket(ticket))continue;
         sl=PositionGetDouble(POSITION_SL);
      }
      // Even an ambiguous partial-close outcome must not create a duplicate.
      // Protection modification is idempotent; retry only when broker accepts.
      if(stage!=0)
      {
         double be=RoundStop(open+side*InpBEBufferPoints*_Point,side==1);
         bool needsBE=side==1?sl<be:sl>be;
         if(needsBE && side*(price-be)>minDistance)
         {
            if(!trade.PositionModify(ticket,be,tp)||!TradeDone())
               Print("Breakeven modification rejected. Ticket ",ticket);
            else sl=be;
         }
         if(stage>0 && InpATRTrailRunner && atr>0 && side*(sl-open)>=InpBEBufferPoints*_Point-2*_Point)
         {
            double candidate=RoundStop(price-side*atr*InpTrailATRMult*_Point,side==1?false:true);
            if(side*(candidate-sl)>10*_Point && side*(price-candidate)>minDistance)
               if(!trade.PositionModify(ticket,candidate,tp)||!TradeDone())
                  Print("ATR trail modification rejected. Ticket ",ticket);
         }
      }
   }
}
int OnInit()
{
   if(StringFind(StringToUpper(_Symbol),"XAUUSD")!=0)
      {Print("Attach to an XAUUSD broker symbol only.");return INIT_FAILED;}
   if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      {Print("v3 requires a hedging MT5 account for safe partial close semantics.");return INIT_FAILED;}
   if(InpRiskPercent<=0||InpRiskPercent>2||InpMaxDailyLossPercent<=0||InpMaxDailyLossPercent>10||
      InpTP1RR<=0||InpTP2RR<=InpTP1RR||InpCloseAtTP1Percent<=0||InpCloseAtTP1Percent>=100||
      InpOTE_Shallow<=0||InpOTE_Deep<=InpOTE_Shallow||InpOTE_Deep>=1||
      InpATRPeriod<2||InpSwingBars<4||InpSwingBars>14||
      InpMinATRPoints<=0||InpMinATRPoints>=InpMaxATRPoints||InpMaxSpreadPoints<=0)
      return INIT_PARAMETERS_INCORRECT;
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpMaxEntryDeviationPts);
   trade.SetAsyncMode(false);
   if(!trade.SetTypeFillingBySymbol(_Symbol))return INIT_FAILED;
   g_emaHandle=iMA(_Symbol,InpHTF,InpHTF_EMA,0,MODE_EMA,PRICE_CLOSE);
   g_atrHandle=iATR(_Symbol,InpEntryTF,InpATRPeriod);
   if(g_emaHandle==INVALID_HANDLE || g_atrHandle==INVALID_HANDLE)return INIT_FAILED;
   RefreshDailyGuard();
   Print("Gold SMC v3 armed=",InpEnableNewEntries,"; hedging-only; no guaranteed win rate.");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason)
{
   if(g_emaHandle!=INVALID_HANDLE)IndicatorRelease(g_emaHandle);
   if(g_atrHandle!=INVALID_HANDLE)IndicatorRelease(g_atrHandle);
}
void OnTick()
{
   // Position management always runs, even while new entries are disabled.
   ManageOwnPositions();
   RefreshDailyGuard();
   datetime bar=iTime(_Symbol,InpEntryTF,0);
   if(bar<=0||bar==g_lastEntryBar)return;
   g_lastEntryBar=bar;
   if(!InpEnableNewEntries||g_dayHalted||SymbolExposure()||!WithinSession())return;
   double atr=ATRPoints();
   if(atr<InpMinATRPoints||atr>InpMaxATRPoints)return;
   MqlTick t;
   if(!SymbolInfoTick(_Symbol,t)||t.ask<=t.bid||(t.ask-t.bid)/_Point>InpMaxSpreadPoints)return;
   if(!NewsSafe())return;
   int side=Bias();if(side==0)return;
   double stop=0;
   if(FindSetup(side,stop))OpenSignal(side,stop);
}
//+------------------------------------------------------------------+
