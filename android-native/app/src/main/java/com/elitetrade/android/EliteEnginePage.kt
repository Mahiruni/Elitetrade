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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun EliteEnginePage(api:EliteApi,context:Context){
    val gold=Color(0xFFD8B16A)
    val muted=MaterialTheme.colorScheme.onBackground.copy(alpha=.73f)
    val scope=rememberCoroutineScope()
    var enabled by remember{mutableStateOf(false)}
    var ready by remember{mutableStateOf(false)}
    var loading by remember{mutableStateOf(true)}
    var error by remember{mutableStateOf("")}
    var confirm by remember{mutableStateOf(false)}
    var running by remember{mutableStateOf(false)}
    var lastSuccess by remember{mutableLongStateOf(0L)}
    var cycles by remember{mutableIntStateOf(0)}
    var detail by remember{mutableStateOf("Stopped")}
    var internetAvailable by remember{mutableStateOf(false)}
    val notifyPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    fun load(){
        scope.launch{
            loading=true;error=""
            try{val s=api.mobileEngineStatus();enabled=s.optBoolean("enabled");ready=s.optBoolean("ready")}
            catch(e:Exception){error=e.message?:"Unable to check backend readiness."}
            finally{loading=false}
        }
    }
    LaunchedEffect(Unit){
        load()
        var checkCount=0
        while(true){
            running=EliteEngineSession.running
            lastSuccess=EliteEngineSession.lastHeartbeatMillis
            cycles=EliteEngineSession.successfulCycles
            detail=EliteEngineSession.lastMessage
            internetAvailable=EliteEngineSession.internetAvailable
            // Fetch backend confirmation regularly. Phone-local success alone
            // does not prove that Supabase still sees a fresh worker heartbeat.
            if(checkCount%15==0&&checkCount>0){
                try{
                    val server=api.mobileEngineStatus()
                    ready=server.optBoolean("ready")
                    enabled=server.optBoolean("enabled")
                }catch(_:Exception){ready=false}
            }
            checkCount++
            delay(2000)
        }
    }
    val fresh=running&&lastSuccess>0&&System.currentTimeMillis()-lastSuccess<90_000L
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)){
        Text("NATIVE DEMO ENGINE",color=gold,fontSize=11.sp,fontWeight=FontWeight.Bold,letterSpacing=1.7.sp)
        Text("Elite Engine",fontSize=30.sp,fontWeight=FontWeight.ExtraBold)
        Text("Your Android phone runs the foreground monitoring session. Broker verification, risk control and any DEMO orders remain on EliteTrade's private backend.",color=muted,fontSize=13.sp)
        ElevatedCard{
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Text(if(fresh&&ready)"● ENGINE ONLINE · SERVER CONFIRMED" else if(running&&fresh)"● PHONE ACTIVE · VERIFYING SERVER" else if(running)"● CONNECTION STALE" else "○ STOPPED",
                    color=if(fresh&&ready)Color(0xFF34D399) else gold,fontWeight=FontWeight.Bold)
                Text(detail,color=muted,fontSize=12.sp)
                Text(if(internetAvailable)"Internet: available · reconnect enabled while engine runs" else
                    "Internet: offline/unverified · DEMO evaluation paused",
                    color=if(internetAvailable)Color(0xFF34D399) else gold,fontSize=12.sp)
                Text("Successful cycles: $cycles",fontSize=12.sp)
                Text(if(lastSuccess==0L)"No successful phone heartbeat" else
                    "Last heartbeat: "+((System.currentTimeMillis()-lastSuccess)/1000).coerceAtLeast(0)+" sec ago",
                    color=muted,fontSize=12.sp)
            }
        }
        Text("Private server connection",fontWeight=FontWeight.Bold)
        Text(if(enabled)"Broker DEMO engine: server configured" else "Backend not enabled: MOBILE_DEMO_ENGINE_ENABLED must be enabled on Vercel before starting.",
            color=if(enabled)Color(0xFF34D399) else gold,fontSize=12.sp)
        Text(if(ready)"Server confirms a fresh demo worker heartbeat" else "Server has not confirmed a recent worker heartbeat. Starting a bot will be blocked until it is fresh.",color=muted,fontSize=12.sp)
        OutlinedButton(onClick={load()},enabled=!loading,modifier=Modifier.fillMaxWidth()){
            Icon(Icons.Default.Refresh,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text(if(loading)"Checking…" else "Refresh backend status")
        }
        if(error.isNotBlank())Text(error,color=Color(0xFFEF7777),fontSize=12.sp)
        if(running){
            Button(onClick={EliteEngineService.stop(context)},modifier=Modifier.fillMaxWidth(),
                colors=ButtonDefaults.buttonColors(containerColor=Color(0xFFEF7777))){
                Icon(Icons.Default.StopCircle,contentDescription=null)
                Text(" Stop engine (does not close MT5 positions)")
            }
        }else Button(onClick={confirm=true},enabled=enabled&&!loading,modifier=Modifier.fillMaxWidth(),
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
