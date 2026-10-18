// Validate broker metadata, not the printed ticker or its suffix.
#ifndef KING_XAU_SYMBOL_MQH
#define KING_XAU_SYMBOL_MQH
bool KGoldCurrencyPair(string base_currency,string profit_currency)
{
   StringToUpper(base_currency);
   StringToUpper(profit_currency);
   return base_currency=="XAU" && profit_currency=="USD";
}
#endif
