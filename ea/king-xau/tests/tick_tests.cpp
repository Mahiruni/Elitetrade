// Runs the actual rolling quote window used by the MQL5 EA.
#include <cmath>
#include <iostream>
#include <limits>
#include <random>
#include <stdexcept>
double MathAbs(double v) { return std::abs(v); }
bool MathIsValidNumber(double v) { return std::isfinite(v); }
#include "../King_XAU_Ticks.mqh"
int checks=0;
void check(bool ok,const char* why) { ++checks; if(!ok) throw std::runtime_error(why); }
int main() {
  KTickWindow w{}; w.Reset();
  check(w.Signal(1,2,250,.6)==0,"empty");
  check(w.Add(1000,100,102,3000),"first quote");
  check(!w.Add(1100,100,102,3000),"duplicate ignored");
  w.Add(1200,101,103,3000);
  check(w.Signal(1,2,250,.6)==0,"needs two confirmations");
  w.Add(1400,102,104,3000);
  check(w.Signal(1,2,250,.6)==1,"up signal before any candle boundary");
  check(w.Signal(3,2,250,.6)==0,"movement threshold");
  check(w.Signal(1,3,250,.6)==0,"confirmation threshold");
  check(w.Signal(1,2,500,.6)==0,"minimum span");
  w.Reset();
  w.Add(2000,110,112,3000); w.Add(2200,109,111,3000); w.Add(2400,108,110,3000);
  check(w.Signal(1,2,250,.6)==-1,"down signal");
  w.Reset();
  w.Add(1000,100,102,3000); w.Add(1200,100,104,3000); w.Add(1400,100,106,3000);
  check(w.Signal(1,2,250,.6)==0,"ask-only spread expansion rejected");
  w.Reset();
  w.Add(1000,100,110,3000); w.Add(1200,101,109,3000); w.Add(1400,102,108,3000);
  check(w.Signal(.1,2,250,.6)==0,"spread-only contraction rejected");
  w.Reset();
  w.Add(1000,100,102,3000); w.Add(1100,105,107,3000); w.Add(1200,99,101,3000);
  w.Add(1300,101,103,3000); w.Add(1400,103,105,3000);
  check(w.Signal(1,2,250,.6)==0,"chop efficiency rejection");
  check(w.Signal(1,2,250,.1)==1,"explicit lower efficiency gate");
  w.Add(5000,120,122,3000);
  check(w.used==1 && w.Signal(1,2,250,.6)==0,"gap discards old movement");
  w.Add(4000,119,121,3000);
  check(w.used==1,"out-of-order reset");
  w.Reset();
  w.Add(1000,100,102,3000); w.Add(1200,101,103,3000); w.Add(1400,102,104,3000);
  check(w.Signal(1,2,250,.6)==1,"signal ready before consume");
  w.Reset();
  check(w.Signal(1,2,250,.6)==0,"consumed window cannot reenter");
  check(!w.Add(2000,100,99,3000),"crossed quote rejected");
  check(!w.Add(2000,0,102,3000),"zero price rejected");
  check(!w.Add(2000,std::numeric_limits<double>::infinity(),102,3000),"nonfinite rejected");
  check(!w.Add(0,100,102,3000),"invalid timestamp rejected");
  w.Reset();
  for(int i=0;i<2000;i++) {
    w.Add(10000+i,100+i*.01,102+i*.01,3000);
    check(w.used>0 && w.used<=256,"bounded window at high tick rates");
  }
  std::mt19937 rng(77101802);
  std::uniform_real_distribution<double> delta(-2,2),spread(.1,4);
  w.Reset(); double bid=10000;
  for(int i=0;i<20000;i++) {
    bid+=delta(rng); double ask=bid+spread(rng);
    w.Add(20000+i*20,bid,ask,3000);
    int signal=w.Signal(.75,2,250,.6);
    if(signal!=0) {
      check(signal*(w.bids[w.used-1]-w.bids[0])>0,"both bid and ask direction");
      check(signal*(w.asks[w.used-1]-w.asks[0])>0,"both quotes direction");
      check(std::abs(w.Net())>=.75,"signal meets move floor");
      check(std::abs(w.Net())/w.Path()>=.6,"signal meets efficiency floor");
    }
  }
  std::cout<<"PASS: "<<checks<<" rolling-tick assertions; no broker/performance claims\n";
}
