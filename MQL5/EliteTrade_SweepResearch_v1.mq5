//+------------------------------------------------------------------+
//| EliteTrade Sweep Research EA v1.0 (independently authored)       |
//| Research hypothesis: closed-M1 liquidity-sweep reversal           |
//| DOES NOT recreate or decrypt the reference Scalpin SS EX5       |
//| No external network/API, DLL, credential or hidden dependencies  |
//+------------------------------------------------------------------+
#property strict
#property version "1.00"
#property description "Independent M1 liquidity sweep research EA. Signal-only by default; simulated tester/demo trades only."

#include <Trade\Trade.mqh>

input group "RESEARCH / EXECUTION"
input bool   InpExecuteOrders=false;          // Default: signals only; no orders
input string InpRunTag="sweep_v1";            // Audit run label
input ulong  InpMagic=2026101501;             // Isolate candidate positions
input int    InpSlippagePoints=20;

input group "M1 SIGNAL HYPOTHESIS"
input int    InpLookbackBars=10;              // Prior closed M1 candles (excluding setup)
input double InpSweepMinPoints=3.0;          // Minimum prior-high/low penetration
input double InpMinWickBodyRatio=1.20;      // Sweep-side wick / |body|, body floor 1pt
input int    InpATRPeriod=14;
input double InpMinATRPoints=10.0;          // Minimum completed-bar ATR
input bool   InpUseM5EMAFilter=false;        // Optional, more restrictive bias
input int    InpM5EMAPeriod=50;

input group "RISK / TRADE FILTERS"
input double InpRiskPercent=0.25;           // Equity risk per position, 0 < risk <= 1%
input double InpDailyLossLimitPct=2.0;      // Conservative EA-local realized + floating loss gate
input int    InpMaxEntriesPerDay=6;
input double InpMaxSpreadPoints=35.0;
input double InpMaxSpreadToATR=0.50;
input double InpStopBufferPoints=5.0;
input double InpMaxStopATR=3.0;
input double InpTakeProfitR=1.5;
input double InpMaxLots=0.50;
input int    InpSessionStartHour=0;         // Broker server time [0,23]
input int    InpSessionEndHour=24;          // Exclusive end [1,24], 24 means midnight

input group "EVIDENCE"
input bool   InpWriteAudit=true;            // CSV: one decision record per closed M1 bar
input bool   InpWriteEvents=true;           // Phase-2-compatible transaction capture

CTrade g_trade;
int g_atrHandle=INVALID_HANDLE;
int g_emaHandle=INVALID_HANDLE;
int g_audit=INVALID_HANDLE;
int g_events=INVALID_HANDLE;
long g_seq=0;
datetime g_lastClosedBar=0;
string g_prefix="";

string N(const double v) { return DoubleToString(v,10); }
string I(const long v) { return (string)v; }
string U(const ulong v) { return (string)v; }

string SafeTag(const string raw)
  {
   string tag="";
   for(int i=0;i<StringLen(raw) && i<40;i++)
     {
      ushort c=StringGetCharacter(raw,i);
      if((c>=48 && c<=57)||(c>=65 && c<=90)||(c>=97 && c<=122)||c==45||c==95)
         tag+=StringSubstr(raw,i,1);
     }
   return (tag=="" ? "run" : tag);
  }

void Audit(const datetime bar,const string event,const string side,const string reason,
           const double priorHigh,const double priorLow,const double setupHigh,
           const double setupLow,const double closePrice,const double atrPts,
           const double spreadPts,const double entry,const double sl,
           const double tp,const double volume,const string result)
  {
   if(g_audit==INVALID_HANDLE) return;
   FileWrite(g_audit,I((long)TimeCurrent()*1000),I((long)bar),InpRunTag,
             _Symbol,"M1",(InpExecuteOrders ? "DEMO_EXECUTION" : "SIGNAL_ONLY"),
             event,side,reason,N(priorHigh),N(priorLow),N(setupHigh),
             N(setupLow),N(closePrice),N(atrPts),N(spreadPts),
             N(entry),N(sl),N(tp),N(volume),result);
   FileFlush(g_audit);
  }

void EventRow(const string kind,const long timeMs,const string quality,
              const string symbol,const string orderId,const string dealId,
              const string positionId,const string magic,const string side,
              const string entry,const string orderType,const string orderState,
              const string volume,const string price,const string sl,
              const string tp,const string profit,const string commission,
              const string swap,const string retcode)
  {
   if(g_events==INVALID_HANDLE) return;
   g_seq++;
   FileWrite(g_events,I(g_seq),kind,I(timeMs),quality,symbol,orderId,dealId,
             positionId,magic,side,entry,orderType,orderState,volume,price,
             sl,tp,profit,commission,swap,retcode);
   FileFlush(g_events);
  }

void Marker(const string kind)
  {
   EventRow(kind,(long)TimeCurrent()*1000,"server_second_precision",_Symbol,
            "","","",U(InpMagic),"","","","","","","",
            "","","","","");
  }

bool ValidateInputs()
  {
   if(InpMagic==0 || InpLookbackBars<3 || InpLookbackBars>300 ||
      InpSweepMinPoints<0 || InpMinWickBodyRatio<0 ||
      InpATRPeriod<2 || InpMinATRPoints<0 || InpM5EMAPeriod<2 ||
      InpRiskPercent<=0 || InpRiskPercent>1.0 ||
      InpDailyLossLimitPct<=0 || InpDailyLossLimitPct>5.0 ||
      InpMaxEntriesPerDay<1 || InpMaxEntriesPerDay>100 ||
      InpMaxSpreadPoints<=0 || InpMaxSpreadToATR<=0 ||
      InpStopBufferPoints<0 || InpMaxStopATR<1.0 ||
      InpTakeProfitR<0.5 || InpTakeProfitR>10.0 ||
      InpMaxLots<=0 || InpSlippagePoints<0 ||
      InpSessionStartHour<0 || InpSessionStartHour>23 ||
      InpSessionEndHour<1 || InpSessionEndHour>24 ||
      InpSessionStartHour==InpSessionEndHour)
      return false;
   return true;
  }

int OnInit()
  {
   // A real account must NEVER be operated by an unverified research candidate.
   // The MT5 Strategy Tester is simulated even if the account environment is REAL.
   if(!MQLInfoInteger(MQL_TESTER) &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
     {
      Print("EliteTrade research EA: REJECTED non-demo account.");
      return INIT_FAILED;
     }
   if(!ValidateInputs())
     {
      Print("EliteTrade EA: invalid input range, refusing initialization.");
      return INIT_PARAMETERS_INCORRECT;
     }

   g_atrHandle=iATR(_Symbol,PERIOD_M1,InpATRPeriod);
   if(g_atrHandle==INVALID_HANDLE) return INIT_FAILED;
   if(InpUseM5EMAFilter)
     {
      g_emaHandle=iMA(_Symbol,PERIOD_M5,InpM5EMAPeriod,0,MODE_EMA,PRICE_CLOSE);
      if(g_emaHandle==INVALID_HANDLE) return INIT_FAILED;
     }
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePoints);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   g_trade.SetAsyncMode(false);

   string stamp=TimeToString(TimeLocal(),TIME_DATE|TIME_SECONDS);
   StringReplace(stamp,".","-");
   StringReplace(stamp,":","-");
   StringReplace(stamp," ","_");
   g_prefix="EliteTradeEvidence\\candidate-"+SafeTag(InpRunTag)+"-"+stamp+"-"+U((ulong)GetTickCount());
   if(InpWriteAudit)
     {
      g_audit=FileOpen(g_prefix+"-decisions.csv",FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ,';',CP_UTF8);
      if(g_audit==INVALID_HANDLE)
        {
         Print("Cannot open mandatory audit file: ",GetLastError());
         return INIT_FAILED;
        }
      FileWrite(g_audit,"server_epoch_ms","bar_epoch","run_tag","symbol",
                "timeframe","mode","event","side","reason","reference_high",
                "reference_low","setup_high","setup_low","setup_close",
                "atr_points","spread_points","entry","sl","tp","lots","retcode");
      FileFlush(g_audit);
     }
   if(InpWriteEvents)
     {
      g_events=FileOpen(g_prefix+"-events.csv",FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ,';',CP_UTF8);
      if(g_events==INVALID_HANDLE)
        {
         Print("Cannot open transaction evidence file: ",GetLastError());
         return INIT_FAILED;
        }
      FileWrite(g_events,"seq","kind","server_epoch_ms","time_quality",
                "symbol","order_ticket","deal_ticket","position_ticket",
                "magic","side","entry","order_type","order_state",
                "volume","price","sl","tp","profit","commission","swap","retcode");
      FileFlush(g_events);
      Marker("SESSION_START");
     }

   // Avoid firing a historical signal immediately upon chart attachment.
   g_lastClosedBar=iTime(_Symbol,PERIOD_M1,1);
   Print("EliteTrade Sweep Research v1 initialized, mode=",
         (InpExecuteOrders ? "DEMO/TEST EXECUTION" : "SIGNAL ONLY"),
         ", audit prefix: ",g_prefix);
   return INIT_SUCCEEDED;
  }

bool SessionAllowed()
  {
   MqlDateTime now;
   TimeToStruct(TimeCurrent(),now);
   int start=InpSessionStartHour, end=InpSessionEndHour;
   if(start<end) return (now.hour>=start && now.hour<end);
   return (now.hour>=start || now.hour<end);
  }

bool OtherOrdersOrPositions()
  {
   // Intentionally disallows other bots/manual positions on this symbol too:
   // netting accounts can otherwise merge positions and corrupt risk estimates.
   for(int p=PositionsTotal()-1;p>=0;p--)
     {
      ulong ticket=PositionGetTicket(p);
      if(ticket>0 && PositionSelectByTicket(ticket) &&
         PositionGetString(POSITION_SYMBOL)==_Symbol) return true;
     }
   for(int o=OrdersTotal()-1;o>=0;o--)
     {
      ulong ticket=OrderGetTicket(o);
      if(ticket>0 && OrderGetString(ORDER_SYMBOL)==_Symbol) return true;
     }
   return false;
  }

bool DailyRiskAllowed(string &reason)
  {
   MqlDateTime md;
   TimeToStruct(TimeCurrent(),md);
   md.hour=0;md.min=0;md.sec=0;
   datetime dayStart=StructToTime(md);
   if(!HistorySelect(dayStart,TimeCurrent()))
     {
      reason="HISTORY_UNAVAILABLE";
      return false;
     }
   double realizedNet=0.0;
   double floatingNet=0.0;
   int dailyEntries=0;
   for(int i=0;i<HistoryDealsTotal();i++)
     {
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket==0) continue;
      if(HistoryDealGetString(ticket,DEAL_SYMBOL)!=_Symbol ||
         (ulong)HistoryDealGetInteger(ticket,DEAL_MAGIC)!=InpMagic) continue;
      realizedNet+=HistoryDealGetDouble(ticket,DEAL_PROFIT)+
                HistoryDealGetDouble(ticket,DEAL_COMMISSION)+
                HistoryDealGetDouble(ticket,DEAL_SWAP);
      ENUM_DEAL_ENTRY e=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket,DEAL_ENTRY);
      ENUM_DEAL_TYPE t=(ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket,DEAL_TYPE);
      if((e==DEAL_ENTRY_IN || e==DEAL_ENTRY_INOUT) &&
         (t==DEAL_TYPE_BUY || t==DEAL_TYPE_SELL)) dailyEntries++;
     }
   if(dailyEntries>=InpMaxEntriesPerDay)
     {
      reason="MAX_DAILY_ENTRIES";
      return false;
     }
   // Includes floating risk for EA-owned positions; independent-account isolation is required.
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0 && PositionSelectByTicket(ticket) &&
         PositionGetString(POSITION_SYMBOL)==_Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagic)
         floatingNet+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
     }
   // Reconstruct a day-start baseline using closed results only; floating P/L
   // must not be subtracted from the balance baseline. Account must be isolated.
   double approximateDayStartBalance=AccountInfoDouble(ACCOUNT_BALANCE)-realizedNet;
   if(approximateDayStartBalance<=0)
     {
      reason="INVALID_BALANCE";
      return false;
     }
   if(realizedNet+floatingNet<=-approximateDayStartBalance*InpDailyLossLimitPct/100.0)
     {
      reason="DAILY_LOSS_LIMIT";
      return false;
     }
   return true;
  }

// Direction calculation is based solely on completed M1 candles.
// Reference range excludes bar[1], which is the just-closed setup candle.
int SweepSignal(const MqlRates &rates[],double &priorHigh,double &priorLow)
  {
   priorHigh=-DBL_MAX;
   priorLow=DBL_MAX;
   for(int j=2;j<=InpLookbackBars+1;j++)
     {
      priorHigh=MathMax(priorHigh,rates[j].high);
      priorLow=MathMin(priorLow,rates[j].low);
     }
   double minMove=InpSweepMinPoints*_Point;
   double body=MathMax(MathAbs(rates[1].close-rates[1].open),_Point);
   double lowWick=MathMax(0.0,MathMin(rates[1].close,rates[1].open)-rates[1].low);
   double highWick=MathMax(0.0,rates[1].high-MathMax(rates[1].close,rates[1].open));
   bool buy=(rates[1].low<priorLow-minMove && rates[1].close>priorLow &&
             lowWick>=InpMinWickBodyRatio*body && rates[1].close>rates[1].open);
   bool sell=(rates[1].high>priorHigh+minMove && rates[1].close<priorHigh &&
              highWick>=InpMinWickBodyRatio*body && rates[1].close<rates[1].open);
   if(buy==sell) return 0; // includes no signal and two-sided ambiguous sweeps
   return (buy ? 1 : -1);
  }

bool M5BiasAllowed(const int direction)
  {
   if(!InpUseM5EMAFilter) return true;
   double ema[];
   MqlRates m5[];
   if(CopyBuffer(g_emaHandle,0,1,1,ema)!=1 ||
      CopyRates(_Symbol,PERIOD_M5,1,1,m5)!=1) return false;
   return ((direction>0 && m5[0].close>ema[0]) ||
           (direction<0 && m5[0].close<ema[0]));
  }

double RoundToTick(const double price,const bool up)
  {
   double step=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(step<=0) step=_Point;
   double q=price/step;
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   return NormalizeDouble((up ? MathCeil(q-1e-9) : MathFloor(q+1e-9))*step,digits);
  }

double RiskVolume(const ENUM_ORDER_TYPE side,const double entry,const double stop)
  {
   double loss=0.0;
   if(!OrderCalcProfit(side,_Symbol,1.0,entry,stop,loss) ||
      loss>=-1e-8) return 0.0;
   double budget=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   if(step<=0 || minLot<=0 || maxLot<minLot || budget<=0) return 0.0;
   double raw=MathMin(budget/-loss,MathMin(InpMaxLots,maxLot));
   double lots=MathFloor((raw+1e-9)/step)*step;
   lots=NormalizeDouble(lots,8);
   // Never round UP to the minimum lot if it exceeds the risk budget.
   if(lots+1e-9<minLot || lots<=0) return 0.0;
   double check=0.0;
   if(!OrderCalcProfit(side,_Symbol,lots,entry,stop,check) || -check>budget+1e-6)
      return 0.0;
   return lots;
  }

void OnTick()
  {
   if(!MQLInfoInteger(MQL_TESTER) &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) return;
   datetime bar=iTime(_Symbol,PERIOD_M1,1);
   if(bar<=0 || bar==g_lastClosedBar) return;
   g_lastClosedBar=bar; // at most one evaluated entry opportunity per closed bar

   MqlRates candles[];
   ArraySetAsSeries(candles,true);
   int needed=InpLookbackBars+2;
   if(CopyRates(_Symbol,PERIOD_M1,0,needed,candles)!=needed)
     {
      Audit(bar,"SKIP","","M1_HISTORY_UNAVAILABLE",0,0,0,0,0,0,0,0,0,0,0,"");
      return;
     }
   double atr[];
   if(CopyBuffer(g_atrHandle,0,1,1,atr)!=1 || atr[0]<=0)
     {
      Audit(bar,"SKIP","","ATR_UNAVAILABLE",0,0,candles[1].high,
            candles[1].low,candles[1].close,0,0,0,0,0,0,"");
      return;
     }
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick) || tick.bid<=0 || tick.ask<=tick.bid)
     {
      Audit(bar,"SKIP","","NO_TICK",0,0,candles[1].high,
            candles[1].low,candles[1].close,atr[0]/_Point,0,0,0,0,0,"");
      return;
     }
   double hi=0,lo=0;
   int direction=SweepSignal(candles,hi,lo);
   string side=(direction>0 ? "BUY" : direction<0 ? "SELL" : "NONE");
   double atrPts=atr[0]/_Point;
   double spreadPts=(tick.ask-tick.bid)/_Point;
   string reason="";
   if(direction==0) reason="NO_VALID_SWEEP";
   else if(!SessionAllowed()) reason="OUTSIDE_SESSION";
   else if(atrPts<InpMinATRPoints) reason="LOW_ATR";
   else if(spreadPts>InpMaxSpreadPoints || spreadPts>InpMaxSpreadToATR*atrPts)
      reason="SPREAD_TOO_HIGH";
   else if(!M5BiasAllowed(direction)) reason="M5_FILTER_OR_DATA";
   else if(OtherOrdersOrPositions()) reason="SYMBOL_ALREADY_OCCUPIED";
   else if(!DailyRiskAllowed(reason)) { /* reason set by gate */ }

   if(reason!="")
     {
      Audit(bar,"SKIP",side,reason,hi,lo,candles[1].high,candles[1].low,
            candles[1].close,atrPts,spreadPts,0,0,0,0,"");
      return;
     }
   ENUM_ORDER_TYPE orderType=(direction>0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double entry=(direction>0 ? tick.ask : tick.bid);
   double targetStop=(direction>0 ? candles[1].low-InpStopBufferPoints*_Point
                                  : candles[1].high+InpStopBufferPoints*_Point);
   double stopPoints=(double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)+2.0;
   double minimum=stopPoints*_Point;
   double stop=(direction>0 ? MathMin(targetStop,tick.bid-minimum)
                            : MathMax(targetStop,tick.ask+minimum));
   stop=RoundToTick(stop,direction<0);
   double dist=MathAbs(entry-stop);
   if(dist<=0 || dist>InpMaxStopATR*atr[0])
     {
      Audit(bar,"SKIP",side,"INVALID_STOP_ATR",hi,lo,candles[1].high,
            candles[1].low,candles[1].close,atrPts,spreadPts,entry,stop,0,0,"");
      return;
     }
   double takeProfit=RoundToTick((direction>0 ? entry+InpTakeProfitR*dist
                                             : entry-InpTakeProfitR*dist),direction>0);
   if((direction>0 && takeProfit<=tick.bid+minimum) ||
      (direction<0 && takeProfit>=tick.ask-minimum))
     {
      Audit(bar,"SKIP",side,"INVALID_TARGET",hi,lo,candles[1].high,
            candles[1].low,candles[1].close,atrPts,spreadPts,entry,stop,takeProfit,0,"");
      return;
     }
   double lot=RiskVolume(orderType,entry,stop);
   if(lot<=0)
     {
      Audit(bar,"SKIP",side,"LOT_BELOW_MIN_OR_RISK_INVALID",hi,lo,
            candles[1].high,candles[1].low,candles[1].close,atrPts,spreadPts,
            entry,stop,takeProfit,0,"");
      return;
     }
   if(!InpExecuteOrders)
     {
      Audit(bar,"SIGNAL",side,"VALID_SIGNAL_NO_ORDER",hi,lo,candles[1].high,
            candles[1].low,candles[1].close,atrPts,spreadPts,entry,stop,takeProfit,lot,"");
      return;
     }
   // Recheck mode before the ONLY trade placement code path.
   if(!MQLInfoInteger(MQL_TESTER) &&
      AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
     {
      Audit(bar,"SKIP",side,"DEMO_ONLY",hi,lo,candles[1].high,
            candles[1].low,candles[1].close,atrPts,spreadPts,entry,stop,takeProfit,lot,"");
      return;
     }
   bool submitted=(direction>0 ? g_trade.Buy(lot,_Symbol,0.0,stop,takeProfit,"EliteTrade Sweep Research")
                               : g_trade.Sell(lot,_Symbol,0.0,stop,takeProfit,"EliteTrade Sweep Research"));
   uint code=g_trade.ResultRetcode();
   bool done=submitted && (code==TRADE_RETCODE_DONE || code==TRADE_RETCODE_DONE_PARTIAL);
   Audit(bar,(done ? "ORDER_RESULT" : "ORDER_REJECTED"),side,
         (done ? "BROKER_ACCEPTED_CHECK_FILLS" : "NOT_EXECUTED"),hi,lo,
         candles[1].high,candles[1].low,candles[1].close,atrPts,spreadPts,
         entry,stop,takeProfit,lot,U((ulong)code));
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(g_events==INVALID_HANDLE) return;
   if(trans.type==TRADE_TRANSACTION_REQUEST)
     {
      if(request.magic!=InpMagic || request.symbol!=_Symbol) return;
      EventRow("TRADE_TRANSACTION_REQUEST",(long)TimeCurrent()*1000,
               "server_second_precision",request.symbol,U(result.order),
               U(result.deal),U(request.position),U(request.magic),"",
               EnumToString(request.action),EnumToString(request.type),"",
               N(request.volume),N(request.price),N(request.sl),N(request.tp),
               "","","",U(result.retcode));
      return;
     }
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0 ||
      !HistoryDealSelect(trans.deal)) return;
   if((ulong)HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=InpMagic ||
      HistoryDealGetString(trans.deal,DEAL_SYMBOL)!=_Symbol) return;
   EventRow("TRADE_TRANSACTION_DEAL_ADD",
            HistoryDealGetInteger(trans.deal,DEAL_TIME_MSC),
            "deal_time_millisecond",_Symbol,
            U((ulong)HistoryDealGetInteger(trans.deal,DEAL_ORDER)),U(trans.deal),
            U((ulong)HistoryDealGetInteger(trans.deal,DEAL_POSITION_ID)),
            U(InpMagic),
            EnumToString((ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal,DEAL_TYPE)),
            EnumToString((ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal,DEAL_ENTRY)),
            "","",N(HistoryDealGetDouble(trans.deal,DEAL_VOLUME)),
            N(HistoryDealGetDouble(trans.deal,DEAL_PRICE)),"","",
            N(HistoryDealGetDouble(trans.deal,DEAL_PROFIT)),
            N(HistoryDealGetDouble(trans.deal,DEAL_COMMISSION)),
            N(HistoryDealGetDouble(trans.deal,DEAL_SWAP)),"");
  }

void OnDeinit(const int reason)
  {
   Marker("SESSION_END");
   if(g_events!=INVALID_HANDLE) { FileFlush(g_events);FileClose(g_events);g_events=INVALID_HANDLE; }
   if(g_audit!=INVALID_HANDLE) { FileFlush(g_audit);FileClose(g_audit);g_audit=INVALID_HANDLE; }
   if(g_atrHandle!=INVALID_HANDLE) IndicatorRelease(g_atrHandle);
   if(g_emaHandle!=INVALID_HANDLE) IndicatorRelease(g_emaHandle);
  }