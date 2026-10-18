// Pure sizing functions shared by the EA and the compiled numeric tests.
#ifndef KING_XAU_RISK_MQH
#define KING_XAU_RISK_MQH
double KFloorVolume(double raw,double step)
{
   if(raw<=0.0 || step<=0.0) return 0.0;
   return MathFloor(raw/step+1e-9)*step;
}
double KRiskVolume(double budget,double loss_per_lot,double costs_per_lot,
                   double minimum,double maximum,double step)
{
   double unit=loss_per_lot+costs_per_lot;
   if(budget<=0.0 || unit<=0.0 || minimum<=0.0 || maximum<minimum || step<=0.0)
      return 0.0;
   double volume=KFloorVolume(MathMin(budget/unit,maximum),step);
   if(volume<minimum-1e-10 || volume*unit>budget+1e-8) return 0.0;
   return volume;
}
double KPriceFloor(double price,double tick)
{
   if(tick<=0.0) return 0.0;
   return MathFloor(price/tick+1e-9)*tick;
}
double KPriceCeil(double price,double tick)
{
   if(tick<=0.0) return 0.0;
   return MathCeil(price/tick-1e-9)*tick;
}
#endif
