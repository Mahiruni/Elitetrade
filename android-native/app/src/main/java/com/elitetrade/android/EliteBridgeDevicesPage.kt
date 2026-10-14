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
import org.json.JSONArray
import org.json.JSONObject

/** Phase 4.2: authenticated, server-authorized device inventory and controls.
 *  No Android signing secret, pairing key, broker gateway or order transport.
 *  Enrollment remains server-disabled until the DB rollout and secure phone
 *  key provisioning are independently verified.
 */
@Composable
fun EliteBridgeDevicesPage(api:EliteApi,onBack:()->Unit) {
    val gold=Color(0xFFD8B16A)
    val muted=MaterialTheme.colorScheme.onBackground.copy(alpha=.72f)
    val admin=api.user?.optString("role")=="admin"
    val scope=rememberCoroutineScope()
    var busy by remember {mutableStateOf(false)}
    var loading by remember {mutableStateOf(false)}
    var unavailable by remember {mutableStateOf(false)}
    var devices by remember {mutableStateOf(JSONArray())}
    var error by remember {mutableStateOf("")}
    var notice by remember {mutableStateOf("")}
    var pending by remember {mutableStateOf<Pair<String,String>?>(null)}

    fun refresh() {
        scope.launch {
            loading=true;error="";notice=""
            try {
                devices=api.eliteBridgeDevices()
                unavailable=false
            }catch(e:Exception) {
                val msg=e.message.orEmpty()
                if(msg.contains("not been activated",ignoreCase=true)) {
                    unavailable=true
                    devices=JSONArray()
                }else {
                    error=msg.ifBlank{"Device registry is temporarily unavailable."}
                }
            }finally{loading=false}
        }
    }

    fun decide(deviceId:String,action:String) {
        if(busy)return
        scope.launch {
            busy=true;error="";notice=""
            try {
                api.eliteBridgeDeviceDecision(deviceId,action)
                notice=if(action=="approve")"Device approved by the server." else "Device revoked by the server."
                devices=api.eliteBridgeDevices()
                unavailable=false
            }catch(e:Exception){error=e.message?:"Device management request failed."}
            finally{busy=false}
        }
    }
    LaunchedEffect(Unit){refresh()}

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement=Arrangement.spacedBy(14.dp)){
        OutlinedButton(onClick=onBack,enabled=!busy){
            Icon(Icons.Default.ArrowBack,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Back to EliteBridge")
        }
        Text("DEVICE SECURITY",fontSize=11.sp,fontWeight=FontWeight.Bold,color=gold,
            letterSpacing=1.6.sp)
        Text("Trusted devices",fontSize=28.sp,fontWeight=FontWeight.ExtraBold)
        Text("Review secure enrollment requests, approved connections and revoked devices. Registration and independent MT5 connectivity are not active.",
            fontSize=13.sp,color=muted,lineHeight=20.sp)
        ElevatedCard {
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(7.dp)) {
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Shield,contentDescription=null,tint=gold)
                    Text("Security-first enrollment",fontWeight=FontWeight.Bold,fontSize=16.sp)
                }
                Text("Ed25519 signature verification • explicit approval • durable replay protection",
                    fontSize=12.sp,color=muted)
                Text("Orders: disabled  ·  Independent MT5: not connected",
                    fontSize=12.sp,color=gold,fontWeight=FontWeight.SemiBold)
                Text("New device registration requires a reviewed database migration and secure Android key provisioning. No private key is stored in this screen.",
                    fontSize=11.sp,color=muted,lineHeight=17.sp)
            }
        }
        if(unavailable){
            ElevatedCard {
                Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Text("Enrollment not activated",color=gold,fontWeight=FontWeight.Bold)
                    Text("This feature will open after secure staging validation and administrator-controlled rollout. Your existing MetaApi connection is unaffected.",
                        fontSize=12.sp,color=muted,lineHeight=18.sp)
                }
            }
        }else {
            Text(if(admin)"Device approval queue and inventory" else "Your device inventory",
                fontWeight=FontWeight.Bold,fontSize=17.sp)
            if(!loading && devices.length()==0 && error.isBlank())
                Text("No registered devices yet.",fontSize=12.sp,color=muted)
            for(i in 0 until devices.length()){
                val device=devices.optJSONObject(i)?:continue
                val id=device.optString("deviceId")
                val name=device.optString("displayName").ifBlank{"Unnamed device"}
                val status=device.optString("state")
                val fingerprint=device.optString("fingerprint")
                ElevatedCard {
                    Column(Modifier.fillMaxWidth().padding(15.dp),verticalArrangement=Arrangement.spacedBy(7.dp)){
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                            Text(name,fontWeight=FontWeight.Bold,fontSize=15.sp)
                            Text(status.uppercase(),fontWeight=FontWeight.Bold,fontSize=10.sp,
                                color=if(status=="approved")Color(0xFF34D399) else gold)
                        }
                        Text("Key fingerprint: "+if(fingerprint.length>=12)fingerprint.take(12)+"…" else "unavailable",
                            fontSize=11.sp,color=muted)
                        Text("Accepted message sequence: "+device.optLong("lastSequence",0),
                            fontSize=11.sp,color=muted)
                        Text("Independent broker: not connected · no orders",fontSize=11.sp,color=gold)
                        if(status=="pending" && admin){
                            Button(onClick={pending=Pair(id,"approve")},
                                enabled=!busy && id.isNotBlank(),modifier=Modifier.fillMaxWidth()){
                                Icon(Icons.Default.CheckCircle,contentDescription=null)
                                Spacer(Modifier.width(7.dp))
                                Text("Approve device")
                            }
                        }
                        if(status!="revoked"){
                            OutlinedButton(onClick={pending=Pair(id,"revoke")},
                                enabled=!busy && id.isNotBlank(),modifier=Modifier.fillMaxWidth()){
                                Icon(Icons.Default.Block,contentDescription=null)
                                Spacer(Modifier.width(7.dp))
                                Text("Revoke device")
                            }
                        }
                    }
                }
            }
        }
        if(loading)CircularProgressIndicator(modifier=Modifier.size(26.dp),color=gold)
        if(error.isNotBlank())Text(error,fontSize=12.sp,color=Color(0xFFEF7777))
        if(notice.isNotBlank())Text(notice,fontSize=12.sp,color=Color(0xFF34D399))
        OutlinedButton(onClick={refresh()},enabled=!loading&&!busy,
            modifier=Modifier.fillMaxWidth()){
            Icon(Icons.Default.Refresh,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Refresh devices")
        }
        Text("A signed heartbeat is not broker proof. Trading is never authorized from this screen.",
            fontSize=11.sp,color=muted,lineHeight=17.sp)
    }

    pending?.let { requested ->
        AlertDialog(
            onDismissRequest={if(!busy)pending=null},
            title={Text(if(requested.second=="approve")"Approve trusted device?" else "Revoke trusted device?")},
            text={Text(
                if(requested.second=="approve")
                    "Approve only a device you have independently verified. This permits DEMO telemetry checks, not broker orders."
                else "This prevents the device from submitting further accepted telemetry. Existing MT5 positions are unaffected."
            )},
            confirmButton={
                Button(onClick={
                    val item=pending
                    pending=null
                    if(item!=null)decide(item.first,item.second)
                },enabled=!busy){
                    Text(if(requested.second=="approve")"Approve" else "Revoke")
                }
            },
            dismissButton={TextButton(onClick={pending=null},enabled=!busy){Text("Cancel")}}
        )
    }
}
