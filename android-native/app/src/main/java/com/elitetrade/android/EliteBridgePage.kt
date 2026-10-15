package com.elitetrade.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * EliteBridge Phase 3: signed protocol sandbox plus explicit live
 * DEMO broker/quote probe. No provider switching or orders.
 * This screen cannot place orders, swap provider, or collect broker secrets.
 */
@Composable
fun EliteBridgePage(api:EliteApi,onNavigate:(String)->Unit) {
    val gold=Color(0xFFD8B16A)
    val muted=MaterialTheme.colorScheme.onBackground.copy(alpha=.70f)
    val scope=rememberCoroutineScope()
    var busy by remember {mutableStateOf(false)}
    var report by remember {mutableStateOf<JSONObject?>(null)}
    var protocol by remember {mutableStateOf<JSONObject?>(null)}
    var protocolWarning by remember {mutableStateOf("")}
    var error by remember {mutableStateOf("")}
    var probes by remember {mutableStateOf(mapOf<String,JSONObject>())}
    var probeErrors by remember {mutableStateOf(mapOf<String,String>())}
    var probing by remember {mutableStateOf(setOf<String>())}
    fun probe(accountId:String) {
        if(accountId.isBlank() || probing.contains(accountId))return
        scope.launch {
            probing=probing+accountId
            probeErrors=probeErrors-accountId
            try {probes=probes+(accountId to api.eliteBridgeProbe(accountId))}
            catch(e:Exception){probeErrors=probeErrors+(accountId to (e.message?:"Connection probe unavailable."))}
            finally{probing=probing-accountId}
        }
    }

    fun load() {
        scope.launch {
            busy=true;error=""
            try{report=api.eliteBridgeStatus()}
            catch(e:Exception){error=e.message?:"Connection inventory is unavailable."}
            try{
                protocol=api.eliteBridgeProtocolStatus()
                protocolWarning=""
            }catch(e:Exception){
                protocolWarning="Protocol status awaiting updated backend deployment."
            }
            finally{busy=false}
        }
    }
    LaunchedEffect(Unit){load()}
    val providers=report?.optJSONArray("providers")
    val accounts=report?.optJSONArray("accounts")
    val heartbeat=report?.optBoolean("workerHeartbeatFresh")==true
    val current=report?.optString("activeProvider").orEmpty()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement=Arrangement.spacedBy(14.dp)){
        Text("BROKER CONNECTIVITY",fontSize=11.sp,color=gold,
            letterSpacing=1.6.sp,fontWeight=FontWeight.Bold)
        Text("EliteBridge",fontSize=30.sp,fontWeight=FontWeight.ExtraBold)
        Text("One EliteTrade app, provider-independent connectivity. Your current MetaApi connection stays untouched while we prepare a future independent MT5 bridge.",
            fontSize=13.sp,color=muted,lineHeight=20.sp)
        ElevatedCard{
            Column(Modifier.fillMaxWidth().padding(17.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(horizontalArrangement=Arrangement.spacedBy(9.dp)){
                    Icon(Icons.Default.Hub,contentDescription=null,tint=gold)
                    Text("Connection overview",fontSize=16.sp,fontWeight=FontWeight.Bold)
                }
                Text(if(current=="metaapi")"Active provider: MetaApi" else if(current.isBlank())"No active provider configured" else "Active provider: legacy gateway",
                    fontSize=13.sp)
                Text(if(heartbeat)"● Engine heartbeat fresh" else "○ Engine offline or heartbeat stale",
                    color=if(heartbeat)Color(0xFF34D399) else gold,fontSize=12.sp)
                Text("Live broker account type and permission checks occur in MT5 connection diagnostics. This inventory does not make trading decisions.",
                    fontSize=11.sp,color=muted)
            }
        }
        ElevatedCard{
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(7.dp)){
                Text(if(protocol?.optInt("phase")==4) "EliteBridge · Protocol v3 / Cloud Phase 4" else "EliteBridge · Protocol v3",
                    fontSize=16.sp,fontWeight=FontWeight.Bold,color=gold)
                Text(if(protocol?.optInt("phase")==4) "Signed DEMO telemetry · Ed25519 · secured cloud storage" else
                    "Signed DEMO telemetry · Ed25519 · sandbox only",fontSize=12.sp)
                Text(if(protocol?.optString("state")=="enrollment-ready")
                    "● Secure cloud enrollment available · Independent MT5 NOT CONNECTED"
                    else if(protocol?.optString("state")=="sandbox-only")
                    "● Protocol specification available · Independent MT5 NOT CONNECTED"
                    else "○ Protocol backend pending · Independent MT5 NOT CONNECTED",
                    color=gold,fontSize=12.sp)
                Text(if(protocol?.optBoolean("pairingEnabled")==true)
                    "Enrollment: administrator approval required · Direct broker orders: disabled"
                    else "Pairing: disabled · Direct broker orders: disabled",fontSize=11.sp,color=muted)
                if(protocolWarning.isNotBlank())Text(protocolWarning,fontSize=11.sp,color=muted)
                Text("The Termux protocol simulator proves signature and replay handling. It does not access Exness or replace MetaApi.",
                    fontSize=12.sp,color=muted,lineHeight=18.sp)
            }
        }
        Text("Available connections",fontSize=16.sp,fontWeight=FontWeight.Bold)
        if(providers!=null)for(i in 0 until providers.length()){
            val p=providers.optJSONObject(i)?:continue
            val implemented=p.optBoolean("implemented")
            val status=p.optString("status")
            ElevatedCard{
                Column(Modifier.fillMaxWidth().padding(15.dp),verticalArrangement=Arrangement.spacedBy(7.dp)){
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                        Text(p.optString("label"),fontWeight=FontWeight.Bold,fontSize=15.sp)
                        Text(if(!implemented)"FUTURE" else if(status=="configured")"CONFIGURED" else "NOT READY",
                            color=gold,fontSize=10.sp,fontWeight=FontWeight.Bold)
                    }
                    Text(p.optString("description"),fontSize=12.sp,color=muted,lineHeight=18.sp)
                    if(!implemented) Text("Not connected · no independent broker feed or orders yet",
                        color=gold,fontSize=11.sp,fontWeight=FontWeight.SemiBold)
                }
            }
        }
        Text("Saved MT5 bindings",fontSize=16.sp,fontWeight=FontWeight.Bold)
        if(accounts==null||accounts.length()==0)
            Text("No saved account binding found for this signed-in user.",fontSize=12.sp,color=muted)
        else for(i in 0 until accounts.length()){
            val a=accounts.optJSONObject(i)?:continue
            ElevatedCard {
                Column(Modifier.fillMaxWidth().padding(15.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                    Text(a.optString("broker")+" · "+a.optString("account"),fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                    Text("Registered provider: "+a.optString("provider")+
                        " · Saved state: "+a.optString("status"),fontSize=12.sp,color=muted)
                    Text("Saved binding only — not a fresh broker verification.",fontSize=11.sp,color=gold)
                    val accountId=a.optString("accountId").takeIf{it!="null"}.orEmpty()
                    if(accountId.isNotBlank()){
                        OutlinedButton(onClick={probe(accountId)},enabled=!probing.contains(accountId),
                            modifier=Modifier.fillMaxWidth()){
                            Icon(Icons.Default.Security,contentDescription=null)
                            Spacer(Modifier.width(6.dp))
                            Text(if(probing.contains(accountId))"Checking live DEMO…" else "Check live DEMO and XAUUSDm quote")
                        }
                        val result=probes[accountId]
                        if(result!=null){
                            val state=result.optString("state")
                            val verification=result.optJSONObject("verification")
                            val market=result.optJSONObject("market")
                            Text("Broker verification: "+state,fontSize=12.sp,fontWeight=FontWeight.Bold,
                                color=if(state=="verified-demo")Color(0xFF34D399) else gold)
                            Text(result.optString("message"),fontSize=11.sp,color=muted,lineHeight=17.sp)
                            if(verification!=null){
                                Text("MT5 type: "+verification.optString("accountType","unverified")+
                                    " · Trade permission: "+if(verification.optBoolean("tradeAllowed"))"allowed" else "not confirmed",
                                    fontSize=11.sp,color=muted)
                            }
                            val quote=market?.optJSONObject("quote")
                            if(market?.optString("state")=="fresh" && quote!=null){
                                Text("XAUUSDm · BID "+quote.optString("bid")+"  /  ASK "+quote.optString("ask"),
                                    fontSize=13.sp,fontWeight=FontWeight.SemiBold)
                                Text("Spread "+quote.optString("spread")+
                                    " · quote "+quote.optInt("ageSeconds")+"s old · read-only",
                                    fontSize=11.sp,color=muted)
                            } else if(market!=null) {
                                Text("Quote: "+market.optString("state"),fontSize=11.sp,color=gold)
                            }
                        }
                        if(probeErrors[accountId]!=null)
                            Text(probeErrors[accountId].orEmpty(),fontSize=11.sp,color=Color(0xFFEF7777))
                    }
                }
            }
        }
        OutlinedButton(onClick={load()},enabled=!busy,modifier=Modifier.fillMaxWidth()){
            Icon(Icons.Default.Refresh,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text(if(busy)"Checking…" else "Refresh connection inventory")
        }
        if(error.isNotBlank())Text(error,fontSize=12.sp,color=Color(0xFFEF7777))
        Button(onClick={onNavigate("MT5")},modifier=Modifier.fillMaxWidth()){
            Icon(Icons.Default.AccountBalance,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Open existing MT5 accounts")
        }
        OutlinedButton(onClick={onNavigate("Elite Engine")},modifier=Modifier.fillMaxWidth()){
            Icon(Icons.Default.Memory,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Open Elite Engine")
        }
        Text("Phase 3 is protocol-sandbox only, and broker diagnostics remain read-only. Live DEMO verification and XAUUSDm quotes use your existing MetaApi connection when requested. EliteBridge Direct MT5 remains unimplemented and needs a compatible terminal or broker API. No provider switch or broker order is performed here.",
            fontSize=12.sp,color=muted,lineHeight=19.sp)
    }
}
