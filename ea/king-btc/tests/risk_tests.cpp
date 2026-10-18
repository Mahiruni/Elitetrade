// Compiles the EA's exact pure sizing header as C++, with MQL math shims.
// This validates numeric invariants, not the MT5 broker/runtime.
#include <cmath>
#include <algorithm>
#include <iostream>
#include <random>
#include <stdexcept>
double MathFloor(double x) { return std::floor(x); }
double MathCeil(double x) { return std::ceil(x); }
double MathMin(double a,double b) { return std::min(a,b); }
#include "../King_BTC_Risk.mqh"
int checks=0;
void check(bool ok,const char* message) {
   ++checks;
   if(!ok) throw std::runtime_error(message);
}
int main() {
   check(std::abs(KRiskVolume(2.5,100,0,.01,1,.01)-.02)<1e-10,"round down");
   check(KRiskVolume(2.5,300,0,.01,1,.01)==0,"reject minimum above risk");
   check(KRiskVolume(2.5,245,10,.01,1,.01)==0,"commission can invalidate minimum");
   check(std::abs(KRiskVolume(3,100,10,.01,1,.01)-.02)<1e-10,"commission sizing");
   check(std::abs(KRiskVolume(10000,100,0,.01,.10,.01)-.10)<1e-10,"maximum cap");
   check(KRiskVolume(0,100,0,.01,1,.01)==0,"zero budget");
   check(KRiskVolume(10,100,0,.10,.01,.01)==0,"invalid broker range");
   check(std::abs(KPriceFloor(100.13,.25)-100.00)<1e-10,"price floor tick");
   check(std::abs(KPriceCeil(100.13,.25)-100.25)<1e-10,"price ceil tick");
   double previous=0;
   for(double equity: {1000.,1200.,1500.,2000.}) {
      double volume=KRiskVolume(equity*.0025,75,5,.001,10,.001);
      check(volume>=previous,"equity growth monotonic at fixed stop/cost");
      check(volume*80<=equity*.0025+1e-8,"equity example risk bound");
      previous=volume;
   }
   std::mt19937 rng(77101801);
   std::uniform_real_distribution<double> unit(0.001,50000),budget(.001,10000);
   const double steps[]={.001,.01,.05,.1,.25,1};
   for(int i=0;i<100000;i++) {
      double step=steps[i%6],minimum=step,maximum=step*(1+i%200);
      double loss=unit(rng),cost=unit(rng)/100.,money=budget(rng);
      double v=KRiskVolume(money,loss,cost,minimum,maximum,step);
      check(v==0 || v>=minimum-1e-9,"minimum valid");
      check(v<=maximum+1e-9,"maximum valid");
      check(v*(loss+cost)<=money+1e-8,"never exceeds planned risk");
      check(std::abs(v/step-std::round(v/step))<1e-6,"volume step valid");
      double raw=money/(loss+cost);
      check(v<=raw+1e-9,"never round up");
   }
   std::cout<<"PASS: "<<checks<<" numeric assertions (shared EA sizing header)\n";
}
