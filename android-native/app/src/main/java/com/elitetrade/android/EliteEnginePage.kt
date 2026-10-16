package com.elitetrade.android

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun EliteEnginePage(
    api:EliteApi,
    context:Context,
    onRegisterRefresh: ((suspend () -> Unit)?) -> Unit
){
    val gold=Color(0xFFD8B16A)
    val muted=MaterialTheme.colorScheme.onBackground.copy(alpha=.73f)
    val lifecycleOwner=LocalLifecycleOwner.current
    val refreshIntervalMillis=15_000L
    var enabled by remember{mutableStateOf(false)}
    var ready by remember{mutableStateOf(false)}
    var loading by remember{mutableStateOf(false)}
    var backendKnown by remember{mutableStateOf(false)}
    var checkedAtMillis by remember{mutableLongStateOf(0L)}
    var screenClockMillis by remember{mutableLongStateOf(System.currentTimeMillis())}
    var error by remember{mutableStateOf("")}
    var confirm by remember{mutableStateOf(false)}
    var running by remember{mutableStateOf(false)}
    var lastSuccess by remember{mutableLongStateOf(0L)}
    var cycles by remember{mutableIntStateOf(0)}
    var detail by remember{mutableStateOf("Stopped")}
    var internetAvailable by remember{mutableStateOf(false)}
    val scope=rememberCoroutineScope()
    var proAccounts by remember{mutableStateOf<List<JSONObject>>(emptyList())}
    var selectedAccount by remember{mutableStateOf("")}
    var proControl by remember{mutableStateOf<JSONObject?>(null)}
    var proError by remember{mutableStateOf("")}
    var proMessage by remember{mutableStateOf("")}
    var stopBusy by remember{mutableStateOf(false)}
    var accountMenu by remember{mutableStateOf(false)}
    val notifyPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    // Read-only authenticated status polling: never pulses the trading
    // worker, starts a bot or submits an MT5 order. One request at a time.
    suspend fun refreshBackend(){
        if(loading)return
        if(stopBusy)return
        loading=true
        try{
            val summary=api.engineProStatus()
            val items=summary.optJSONObject("accounts")?.optJSONArray("items")
            proAccounts=if(items==null)emptyList() else (0 until items.length()).mapNotNull{items.optJSONObject(it)}
            if(proAccounts.none{it.optString("id")==selectedAccount})selectedAccount=proAccounts.firstOrNull()?.optString("id") ?: ""
            val checkedAccount=selectedAccount
            val control=if(checkedAccount.isNotBlank())api.engineProAccount(checkedAccount) else null
            if(selectedAccount==checkedAccount)proControl=control
            proError=""
        }catch(e:CancellationException){loading=false;throw e}
        catch(e:Exception){proControl=null;proError="Independent control state unavailable. Retry before relying on a stop confirmation."}
        try{
            val status=api.mobileEngineStatus()
            enabled=status.optBoolean("enabled")
            ready=status.optBoolean("ready")
            backendKnown=true
            error=""
        }catch(e:CancellationException){throw e}
        catch(e:Exception){
            // Fail closed instead of continuing to display a stale
            // "SERVER CONFIRMED" or falsely claiming the backend is off.
            ready=false
            backendKnown=false
            error=e.message ?: "Unable to verify backend readiness."
        }finally{
            checkedAtMillis=System.currentTimeMillis()
            loading=false
        }
    }
    // Share this same verified read-only check with the common footer refresh.
    // Disposing the page unregisters its handler to prevent stale callbacks.
    DisposableEffect(api) {
        onRegisterRefresh(suspend { refreshBackend() })
        onDispose { onRegisterRefresh(null) }
    }
    // Poll only when the screen's Activity is at least STARTED. The
    // lifecycle cancels this loop when backgrounded; no Android alarms,
    // hidden background jobs, or duplicate status requests are created.
    LaunchedEffect(api,lifecycleOwner){
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){
            while(isActive){
                refreshBackend()
                delay(refreshIntervalMillis)
            }
        }
    }
    // The phone service reports activity separately; update its on-screen
    // heartbeat age every second, even when the heartbeat value is unchanged.
    LaunchedEffect(Unit){
        while(true){
            running=EliteEngineSession.running
            lastSuccess=EliteEngineSession.lastHeartbeatMillis
            cycles=EliteEngineSession.successfulCycles
            detail=EliteEngineSession.lastMessage
            internetAvailable=EliteEngineSession.internetAvailable
            screenClockMillis=System.currentTimeMillis()
            delay(1000L)
        }
    }
    val fresh=running&&lastSuccess>0&&screenClockMillis-lastSuccess<90_000L
    val backendCheckedAge=if(checkedAtMillis>0) ((screenClockMillis-checkedAtMillis)/1000).coerceAtLeast(0L) else null
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)){
        Text("ELITETRADE EXECUTION WORKSPACE",color=gold,fontSize=11.sp,fontWeight=FontWeight.Bold,letterSpacing=1.7.sp)
        Text("EliteEnginePro",fontSize=30.sp,fontWeight=FontWeight.ExtraBold)
        ElevatedCard{
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Text("INDEPENDENT EXECUTION · LOCKED",color=gold,fontWeight=FontWeight.Bold)
                Text("Broker authentication and a persistent MT5 runtime still require commissioning. A worker heartbeat does not verify broker connectivity.",color=muted,fontSize=12.sp)
                if(proAccounts.isNotEmpty()){
                    val selected=proAccounts.firstOrNull{it.optString("id")==selectedAccount}
                    Box{
                        OutlinedButton(onClick={accountMenu=true},enabled=!loading&&!stopBusy){
                            Text((selected?.optString("broker") ?: "MT5")+" · "+(selected?.optString("server") ?: "Choose account"))
                        }
                        DropdownMenu(expanded=accountMenu,onDismissRequest={accountMenu=false}){
                            proAccounts.forEach{account->
                                DropdownMenuItem(text={Text(account.optString("broker")+" · "+account.optString("server")+" · "+account.optString("id").take(8))},onClick={
                                    accountMenu=false;selectedAccount=account.optString("id");proControl=null;proMessage=""
                                    scope.launch{refreshBackend()}
                                })
                            }
                        }
                    }
                    Text(if(proControl==null)"Saved stop state: unknown" else if(proControl!!.optBoolean("killSwitch"))"Independent stop is saved" else "Independent stop is not active",color=gold,fontSize=12.sp)
                    Text("Unresolved broker outcomes: "+(proControl?.optInt("unresolvedCount")?.toString() ?: "Unknown"),color=muted,fontSize=12.sp)
                    Button(onClick={
                        val account=selectedAccount
                        scope.launch{
                            stopBusy=true
                            try{
                                val result=api.engineProAccount(account,true)
                                if(selectedAccount==account){
                                    proControl=result
                                    proMessage=if(result.optBoolean("killSwitch"))"Stop confirmed and saved. Existing positions remain open." else "Stop was not confirmed. Refresh and retry."
                                }
                            }catch(e:CancellationException){throw e}
                            catch(e:Exception){proControl=null;proMessage="Stop was not confirmed. Refresh and retry."}
                            finally{stopBusy=false}
                        }
                    },enabled=selectedAccount.isNotBlank()&&!stopBusy&&!loading,modifier=Modifier.fillMaxWidth()){
                        Text(if(stopBusy)"Saving stop…" else "Stop independent engine")
                    }
                }else Text("Save an MT5 account to access its persistent stop control.",color=muted,fontSize=12.sp)
                Text("This stops independent engine work only. Existing positions stay open; the separate legacy Android/MetaApi engine is unaffected.",color=muted,fontSize=12.sp)
                if(proError.isNotBlank())Text(proError,color=Color(0xFFEF7777),fontSize=12.sp)
                if(proMessage.isNotBlank())Text(proMessage,color=gold,fontSize=12.sp)
            }
        }
        Text("Existing supervised Android demo engine",fontWeight=FontWeight.Bold)
        Text("Your Android phone runs the foreground monitoring session. Broker verification, risk control and any DEMO orders remain on EliteTrade's private backend.",color=muted,fontSize=13.sp)
        ElevatedCard{
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Text(if(fresh&&ready&&backendKnown)"● ENGINE ONLINE · SERVER CONFIRMED" else if(running&&fresh)"● PHONE ACTIVE · VERIFYING SERVER" else if(running)"● CONNECTION STALE" else "○ STOPPED",
                    color=if(fresh&&ready&&backendKnown)Color(0xFF34D399) else gold,fontWeight=FontWeight.Bold)
                Text(detail,color=muted,fontSize=12.sp)
                Text(if(internetAvailable)"Internet: available · reconnect enabled while engine runs" else
                    "Internet: offline/unverified · DEMO evaluation paused",
                    color=if(internetAvailable)Color(0xFF34D399) else gold,fontSize=12.sp)
                Text("Successful cycles: $cycles",fontSize=12.sp)
                Text(if(lastSuccess==0L)"No successful phone heartbeat" else
                    "Last heartbeat: "+((screenClockMillis-lastSuccess)/1000).coerceAtLeast(0)+" sec ago",
                    color=muted,fontSize=12.sp)
            }
        }
        Text("Private server connection",fontWeight=FontWeight.Bold)
        Text(if(!backendKnown)"Broker DEMO engine: checking backend connection" else if(enabled)"Broker DEMO engine: server configured" else "Backend not enabled: MOBILE_DEMO_ENGINE_ENABLED must be enabled on Vercel before starting.",
            color=if(backendKnown&&enabled)Color(0xFF34D399) else gold,fontSize=12.sp)
        Text(if(!backendKnown)"Waiting for verified server status." else if(ready)"Server confirms a fresh demo worker heartbeat" else "Server has not confirmed a recent worker heartbeat. Starting a bot will be blocked until it is fresh.",color=muted,fontSize=12.sp)
        Text("Auto-refresh ON · Every 15 seconds while this screen is open",color=Color(0xFF34D399),fontSize=12.sp)
        Text(if(backendCheckedAge==null)"First backend check pending" else
            "Last backend check: ${backendCheckedAge}s ago",color=muted,fontSize=12.sp)
        if(error.isNotBlank())Text(error,color=Color(0xFFEF7777),fontSize=12.sp)
        if(running){
            Button(onClick={EliteEngineService.stop(context)},modifier=Modifier.fillMaxWidth(),
                colors=ButtonDefaults.buttonColors(containerColor=Color(0xFFEF7777))){
                Icon(Icons.Default.StopCircle,contentDescription=null)
                Text(" Stop engine (does not close MT5 positions)")
            }
        }else Button(onClick={confirm=true},enabled=backendKnown&&enabled&&!loading,modifier=Modifier.fillMaxWidth(),
            colors=ButtonDefaults.buttonColors(containerColor=gold,contentColor=Color.Black)){
            Icon(Icons.Default.PlayArrow,contentDescription=null)
            Text(" Start native DEMO engine")
        }
        HorizontalDivider()
        Text("Internet recovery",fontWeight=FontWeight.Bold)
        Text("When connected, the engine continues checking your DEMO strategy. If Wi-Fi or mobile data disconnects, requests pause. They resume when validated internet returns — only while Android keeps this foreground service running.",color=muted,fontSize=12.sp,lineHeight=19.sp)
        Text("Safe supervised testing",fontWeight=FontWeight.Bold)
        Text("1. Stop the old Termux worker before starting this one.\n"+
            "2. The phone sends authenticated heartbeat requests every 45 seconds.\n"+
            "3. This does not arm trading. Start a broker-verified DEMO bot separately in Bots.\n"+
            "4. Broker DEMO orders are possible only for explicitly armed bots passing server risk checks.\n"+
            "5. Android 15/16 limits dataSync foreground service background time to six hours per rolling day. Reopen/restart after the OS timeout; automatic internet recovery cannot bypass this limit.\n"+
            "6. Stopping this engine does not close existing MT5 positions.",
            color=muted,fontSize=12.sp,lineHeight=19.sp)
        Text("No Supabase service-role or MetaApi API token is stored in the APK.",color=gold,fontSize=12.sp)
    }
    if(confirm)AlertDialog(onDismissRequest={confirm=false},
        title={Text("Start supervised DEMO engine?")},
        text={Text("Make sure Termux's demo worker has stopped. This starts an ongoing foreground notification. No bot is armed by this action; existing armed DEMO bots may generate broker demo orders after all risk checks.")},
        confirmButton={TextButton(onClick={
            confirm=false
            if(Build.VERSION.SDK_INT>=33)notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            try{EliteEngineService.start(context,api)}
            catch(e:Exception){error=e.message?:"Android could not start foreground monitoring."}
        }){Text("Start DEMO engine")}},
        dismissButton={TextButton(onClick={confirm=false}){Text("Cancel")}})
}
