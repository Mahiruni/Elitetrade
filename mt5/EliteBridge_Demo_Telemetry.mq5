//+------------------------------------------------------------------+
//| EliteBridge Demo Telemetry.mq5                                    |
//| Read-only exporter for a real locally signed-in Windows MT5 DEMO. |
//| NO trade operations, no account login or credentials exported.    |
//+------------------------------------------------------------------+
#property strict
#property version "1.00"
#property description "EliteBridge read-only DEMO account broker quote exporter"
input string InpBrokerSymbol="XAUUSDm";

int OnInit() {
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) {
      Print("EliteBridge exporter supports DEMO accounts only.");
      return INIT_FAILED;
   }
   if(!SymbolSelect(InpBrokerSymbol,true)) {
      Print("EliteBridge symbol not available. Select exact broker symbol.");
      return INIT_FAILED;
   }
   FolderCreate("EliteBridge",FILE_COMMON);
   EventSetTimer(2);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTick() { /* No execution. Timer writes only broker quotes. */ }
void OnTimer() {
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO ||
      !TerminalInfoInteger(TERMINAL_CONNECTED))return;
   MqlTick tick;
   if(!SymbolInfoTick(InpBrokerSymbol,tick)||tick.bid<=0||tick.ask<tick.bid||
      tick.time_msc<=0)return;
   int digits=(int)SymbolInfoInteger(InpBrokerSymbol,SYMBOL_DIGITS);
   int h=FileOpen("EliteBridge\\quote.csv",
      FILE_COMMON|FILE_WRITE|FILE_CSV|FILE_ANSI,'|');
   if(h==INVALID_HANDLE)return;
   FileWrite(h,"demo","true",
      AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)?"true":"false",
      InpBrokerSymbol,DoubleToString(tick.bid,digits),
      DoubleToString(tick.ask,digits),IntegerToString(tick.time_msc));
   FileFlush(h);
   FileClose(h);
}
