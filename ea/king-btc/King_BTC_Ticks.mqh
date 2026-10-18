// Rolling quote signal; shared unchanged with the compiled C++ regression tests.
#ifndef KING_BTC_TICKS_MQH
#define KING_BTC_TICKS_MQH
struct KTickWindow
{
   int used;
   long stamps[256];
   double bids[256];
   double asks[256];
   void Reset() { used=0; }
   void DropFirst(int count)
   {
      if(count<=0) return;
      if(count>=used) { Reset(); return; }
      for(int i=count;i<used;i++)
      {
         stamps[i-count]=stamps[i];
         bids[i-count]=bids[i];
         asks[i-count]=asks[i];
      }
      used-=count;
   }
   bool Add(long timestamp,double bid,double ask,int window_ms)
   {
      if(timestamp<=0 || window_ms<=0 || !MathIsValidNumber(bid) ||
         !MathIsValidNumber(ask) || bid<=0.0 || ask<=bid) return false;
      if(used>0 && (timestamp<stamps[used-1] || timestamp-stamps[used-1]>window_ms))
         Reset();
      int expired=0;
      while(expired<used && stamps[expired]<timestamp-window_ms) expired++;
      DropFirst(expired);
      if(used>0 && bids[used-1]==bid && asks[used-1]==ask) return false;
      if(used==256) DropFirst(1);
      stamps[used]=timestamp; bids[used]=bid; asks[used]=ask; used++;
      return true;
   }
   double Net()
   {
      if(used<2) return 0.0;
      return ((bids[used-1]-bids[0])+(asks[used-1]-asks[0]))*0.5;
   }
   double Path()
   {
      double length=0.0;
      for(int i=1;i<used;i++)
         length+=MathAbs(((bids[i]-bids[i-1])+(asks[i]-asks[i-1]))*0.5);
      return length;
   }
   int Signal(double minimum_move,int confirmations,int minimum_span_ms,double efficiency_floor)
   {
      if(used<confirmations+1 || confirmations<1 || minimum_move<=0.0 ||
         minimum_span_ms<0 || efficiency_floor<0.0 || efficiency_floor>1.0) return 0;
      if(stamps[used-1]-stamps[0]<minimum_span_ms) return 0;
      double net=Net(),path=Path();
      if(path<=0.0 || MathAbs(net)<minimum_move || MathAbs(net)/path<efficiency_floor) return 0;
      int direction=net>0.0?1:-1;
      if(direction*(bids[used-1]-bids[0])<=0.0 ||
         direction*(asks[used-1]-asks[0])<=0.0) return 0;
      for(int i=used-confirmations;i<used;i++)
      {
         double move=((bids[i]-bids[i-1])+(asks[i]-asks[i-1]))*0.5;
         if(direction*move<=0.0) return 0;
      }
      return direction;
   }
};
#endif
