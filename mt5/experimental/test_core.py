"""Execute the exact portable-core functions extracted from the EA as C++.

This validates deterministic rule/math behavior. It is not an MQL5 runtime,
broker test, original-EX5 comparison, backtest, or profitability assessment.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent
source = (root / 'EliteTrade_SweepBreakout_Experimental_v1.mq5').read_text()
core = source.split('// BEGIN PORTABLE CORE', 1)[1].split('\n', 1)[1].split('// END PORTABLE CORE', 1)[0]
prefix = r'''
#include <algorithm>
#include <cmath>
#include <limits>
#include <random>
#include <iostream>
#include <stdexcept>
bool MathIsValidNumber(double x){return std::isfinite(x);}
double MathMax(double a,double b){return std::max(a,b);}
double MathMin(double a,double b){return std::min(a,b);}
double MathFloor(double x){return std::floor(x);}
double MathCeil(double x){return std::ceil(x);}
void check(bool condition,const char* name){if(!condition)throw std::runtime_error(name);}
'''
tests = r'''
int main(){
 int named=0;
 ESBar sweep{100,102,98,100},bull{100,104,99,103};
 check(ESSignal(sweep,bull,105,99,0.05,0.02)==1,"buy after reclaimed low sweep and bullish breakout");named++;
 ESBar upper{104,106,102,104},bear{104,105,100,101};
 check(ESSignal(upper,bear,105,99,0.05,0.02)==-1,"sell after reclaimed high sweep and bearish breakout");named++;
 ESBar inside{100,102,99.1,101};
 check(ESSignal(inside,bull,105,99,0.05,0.02)==0,"no liquidity sweep");named++;
 ESBar weak{100,102.01,99,102.01};
 check(ESSignal(sweep,weak,105,99,0.05,0.02)==0,"breakout buffer blocks weak confirmation");named++;
 ESBar failed{100,102,98,98.5};
 check(ESSignal(failed,bull,105,99,0.05,0.02)==0,"sweep must reclaim reference level");named++;
 ESBar both{101,106,98,101};
 check(ESSignal(both,bull,105,99,0.05,0.02)==0,"two-sided sweep rejected");named++;
 ESBar invalid{100,99,98,101};
 check(ESSignal(invalid,bull,105,99,0.05,0.02)==0,"invalid OHLC rejected");named++;
 check(ESSignal(sweep,bull,99,105,0.05,0.02)==0,"inverted reference range rejected");named++;
 check(ESSignal(sweep,bull,105,99,-1,0.02)==0,"negative threshold rejected");named++;
 check(ESPrice(100.023,0.01,false)<=100.023 && ESPrice(100.023,0.01,true)>=100.023,"directional price rounding");named++;
 check(ESPrice(100,0,false)==0,"invalid tick rejected");named++;
 check(ESVolume(0.005,0.01,10,0.01)==0,"never force minimum lot above budget");named++;
 check(std::abs(ESVolume(0.137,0.01,10,0.01)-0.13)<1e-12,"lot floors to step");named++;
 check(std::abs(ESVolume(5,0.01,0.1,0.01)-0.1)<1e-12,"maximum lot cap");named++;
 check(ESVolume(1,0.1,0.01,0.01)==0,"inconsistent broker lot bounds rejected");named++;
 check(std::abs(ESBudget(10000,0.25,10000,10000,2,5,10)-22.5)<1e-10,"risk budget and explicit reserve");named++;
 check(ESBudget(9800,0.25,10000,10000,2,5,10)==0,"daily loss threshold blocks new risk");named++;
 check(ESBudget(9500,0.25,9500,10000,2,5,10)==0,"peak drawdown threshold blocks new risk");named++;
 check(std::abs(ESBudget(9810,0.25,10000,10000,2,5,0)-10)<1e-8,"remaining daily allowance caps new risk");named++;
 check(ESBudget(std::numeric_limits<double>::quiet_NaN(),1,100,100,2,5,0)==0,"NaN budget rejected");named++;
 check(ESSession(23,22,6) && ESSession(2,22,6) && !ESSession(12,22,6),"overnight server-hour session");named++;
 check(ESSession(12,0,24) && !ESSession(24,0,24),"all-day valid hours only");named++;
 std::mt19937_64 rng(15102601);
 std::uniform_real_distribution<double> raw(0.000001,100.0);
 const double steps[]={0.001,0.01,0.1,1.0};
 for(int i=0;i<5000;i++){
   double step=steps[i%4],maximum=step*1000,requested=raw(rng);
   double value=ESVolume(requested,step,maximum,step);
   check(value>=0 && value<=std::min(requested,maximum)+1e-9,"random volume cap");
   if(value>0){check(value>=step-1e-9,"random minimum lot");check(std::abs(value/step-std::round(value/step))<1e-7,"random step alignment");}
   double price=raw(rng)*100;
   check(ESPrice(price,step,false)<=price+1e-8,"random downward price rounding");
   check(ESPrice(price,step,true)>=price-1e-8,"random upward price rounding");
 }
 std::cout<<"{\"named_scenarios_passed\":"<<named<<",\"randomized_cases_passed\":5000,\"original_ex5_compared\":false,\"broker_runtime_tested\":false}"<<std::endl;
}
'''
with tempfile.TemporaryDirectory(prefix='esbx-core-') as tmp:
    cpp = Path(tmp)/'core.cpp'
    exe = Path(tmp)/'core-test'
    cpp.write_text(prefix+core+tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-O2',str(cpp),'-o',str(exe)],check=True)
    subprocess.run([str(exe)],check=True)
