package com.elitetrade.android

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Native authenticated, read-only Gold SMC research. Never issues an order. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GoldSmcPage(api: EliteApi, bots: List<JSONObject>, accounts: List<JSONObject>) {
    val gold = Color(0xFFD8B16A)
    val muted = MaterialTheme.colorScheme.onBackground.copy(alpha=.72f)
    val scope = rememberCoroutineScope()
    val connected = accounts.filter { it.optString("status") == "connected" }.map { it.optString("id") }.toSet()
    val eligible = bots.filter { it.optString("symbol").matches(Regex("(?i)XAUUSD[A-Za-z0-9._-]{0,20}")) &&
        it.optString("account_id") in connected }
    var botId by remember(eligible) { mutableStateOf(eligible.firstOrNull()?.optString("id").orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<JSONObject?>(null) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("GOLD INTELLIGENCE",color=gold,fontSize=11.sp,fontWeight=FontWeight.Bold)
        Text("Gold SMC Scalper",fontSize=29.sp,fontWeight=FontWeight.ExtraBold)
        Text("M15 bias · M5 sweep → MSS → displacement FVG → OTE",fontSize=13.sp,color=muted)
        Text("Research only • No live order or automatic MT5 execution",color=gold,fontSize=12.sp)
        if(eligible.isEmpty()){
            Text("Connect an MT5 account and configure a Gold (XAUUSD) bot in Trading bots.",color=muted)
        }else{
            var expanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded=expanded,onExpandedChange={expanded=it}) {
                OutlinedTextField(
                    value=eligible.find { it.optString("id")==botId }?.optString("name").orEmpty(),
                    onValueChange={},readOnly=true,label={Text("XAUUSD configuration")},
                    modifier=Modifier.menuAnchor().fillMaxWidth())
                ExposedDropdownMenu(expanded=expanded,onDismissRequest={expanded=false}) {
                    eligible.forEach { bot ->
                        DropdownMenuItem(text={Text(bot.optString("name")+" · "+bot.optString("symbol"))},
                            onClick={botId=bot.optString("id");expanded=false;result=null;error=""})
                    }
                }
            }
            Button(enabled=!busy&&botId.isNotBlank(),onClick={
                busy=true;error="";result=null
                scope.launch {
                    try {
                        val packet=api.previewGoldSmc(botId)
                        val reading=packet.optJSONObject("goldSmc")
                            ?: throw ApiProblem("Broker research result is missing.")
                        if(reading.optBoolean("executionEnabled",true))
                            throw ApiProblem("Unsafe trading state was rejected.")
                        result=reading
                    }catch(e:Exception){error=e.message?:"Broker analysis failed. No trade."}
                    finally{busy=false}
                }
            },colors=ButtonDefaults.buttonColors(containerColor=gold,contentColor=Color.Black)){
                Text(if(busy)"Checking MT5 candles…" else "Analyze MT5",fontWeight=FontWeight.Bold)
            }
        }
        if(error.isNotBlank())Text(error,color=Color(0xFFEF7777))
        result?.let { r ->
            HorizontalDivider()
            val state=r.optString("state","WAIT")
            Text(state,color=when(state){"BUY"->Color(0xFF34D399);"SELL"->Color(0xFFFF747D);else->gold},
                fontWeight=FontWeight.ExtraBold,fontSize=34.sp)
            Text("Read-only · "+r.optString("symbol")+" · "+r.optString("accountType"),fontSize=12.sp,color=muted)
            listOf(
                "M15 bias" to r.optString("bias"),"EMA50" to r.optString("ema50"),
                "ATR points" to r.optString("atrPoints"),"Spread points" to r.optString("spreadPoints"),
                "UTC session" to r.optString("session"),"Quote time" to r.optString("quoteTime")
            ).forEach { (label,value) ->
                Surface(shape=androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                    border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant),color=MaterialTheme.colorScheme.surfaceVariant) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(label,fontSize=12.sp,color=muted)
                        Text(value,fontSize=16.sp,fontWeight=FontWeight.Bold)
                    }
                }
            }
            r.optJSONObject("structure")?.let { s ->
                Text("Structural evidence",fontWeight=FontWeight.Bold)
                Text("Sweep: "+s.optString("sweepAt"),fontSize=12.sp)
                Text("MSS: "+s.optString("shiftAt"),fontSize=12.sp)
                Text("FVG: "+s.optJSONObject("fvg")?.toString(),fontSize=12.sp)
                Text("OTE: "+s.optJSONObject("ote")?.toString(),fontSize=12.sp)
            }
            r.optJSONObject("plan")?.let { p ->
                Text("Indicative scenario — not an order",color=gold,fontWeight=FontWeight.Bold)
                listOf("entry","stopLoss","tp1","tp2").forEach { key ->
                    Text(key+": "+p.optString(key),fontSize=13.sp)
                }
            }
            val reasons=r.optJSONArray("reasons")
            for(i in 0 until (reasons?.length()?:0))
                Text("• "+reasons?.optString(i),fontSize=13.sp)
            Text("Economic news verification and position management are not performed by this page. Demo-test the separate MT5 EA before arming.",
                fontSize=12.sp,color=muted)
        }
    }
}
