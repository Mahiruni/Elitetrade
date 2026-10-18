#include <algorithm>
#include <cctype>
#include <iostream>
#include <stdexcept>
#include <string>
using string=std::string;
bool StringToUpper(string &value) {
  std::transform(value.begin(),value.end(),value.begin(),[](unsigned char c){return static_cast<char>(std::toupper(c));});
  return true;
}
#include "../King_XAU_Symbol.mqh"
int main() {
  struct Case { string base,profit; bool expected; };
  Case cases[]={
    {"XAU","USD",true},{"xau","usd",true},{"XaU","uSD",true},
    {"BTC","USD",false},{"XAG","USD",false},{"XAU","EUR",false},
    {"USD","XAU",false},{"","USD",false},{"XAU","",false},
    {"XAUUSD","USD",false},{"XAU","USDT",false},{"XAU ","USD",false}
  };
  int count=0;
  for(const auto &item:cases) {
    if(KGoldCurrencyPair(item.base,item.profit)!=item.expected)
      throw std::runtime_error("Incorrect broker currency metadata acceptance");
    ++count;
  }
  std::cout<<"PASS: "<<count<<" gold metadata acceptance/rejection cases\n";
}
