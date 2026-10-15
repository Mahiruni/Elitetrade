package com.elitetrade.android

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel

/** Ephemeral same-process bridge. No service-role key or MetaApi token is embedded or persisted. */
internal object EliteEngineSession {
    @Volatile var api:EliteApi?=null
    @Volatile var running=false
    @Volatile var internetAvailable=false
    @Volatile var lastHeartbeatMillis=0L
    @Volatile var lastMessage="Stopped"
    @Volatile var successfulCycles=0
}
class EliteEngineService:Service() {
    companion object {
        private const val CHANNEL="elite_demo_monitor"
        private const val NOTIFICATION=6080
        private const val START="com.elitetrade.android.START_DEMO_MONITOR"
        private const val STOP="com.elitetrade.android.STOP_DEMO_MONITOR"
        fun start(context:Context,api:EliteApi){
            EliteEngineSession.api=api
            androidx.core.content.ContextCompat.startForegroundService(context,
                Intent(context,EliteEngineService::class.java).setAction(START))
        }
        fun stop(context:Context){
            context.startService(Intent(context,EliteEngineService::class.java).setAction(STOP))
        }
    }
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private var job:Job?=null
    private val networkWakeup=Channel<Unit>(Channel.CONFLATED)
    private var connectivityManager:ConnectivityManager?=null
    private var networkCallback:ConnectivityManager.NetworkCallback?=null
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onCreate(){
        super.onCreate()
        val channel=NotificationChannel(CHANNEL,"EliteTrade DEMO monitoring",NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    private fun notice(text:String):Notification {
        val home=PendingIntent.getActivity(this,0,Intent(this,NativeActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop=PendingIntent.getService(this,1,Intent(this,EliteEngineService::class.java).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Elite Engine · DEMO").setContentText(text.take(100))
            .setContentIntent(home).setOnlyAlertOnce(true).setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause,"Stop engine",stop).build()
    }
    private fun update(text:String){
        EliteEngineSession.lastMessage=text.take(180)
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION,notice(text))
    }
    /** Validated internet, not merely a connected Wi-Fi network with no upstream. */
    private fun refreshConnectivity(){
        val manager=connectivityManager ?: return
        val capabilities=manager.getNetworkCapabilities(manager.activeNetwork)
        EliteEngineSession.internetAvailable=
            capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)==true &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        networkWakeup.trySend(Unit)
    }
    private fun registerNetworkWatch(){
        val manager=getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        connectivityManager=manager
        val callback=object:ConnectivityManager.NetworkCallback(){
            override fun onAvailable(network:Network){refreshConnectivity()}
            override fun onLost(network:Network){refreshConnectivity()}
            override fun onCapabilitiesChanged(network:Network,capabilities:NetworkCapabilities){
                refreshConnectivity()
            }
        }
        networkCallback=callback
        manager.registerDefaultNetworkCallback(callback)
        refreshConnectivity()
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action==STOP){ stopSelf();return START_NOT_STICKY }
        val api=EliteEngineSession.api
        if(intent?.action!=START||api==null){stopSelf();return START_NOT_STICKY}
        try {
            if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q)
                startForeground(NOTIFICATION,notice("Connecting to DEMO backend…"),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(NOTIFICATION,notice("Connecting to DEMO backend…"))
            if(networkCallback==null)registerNetworkWatch()
        }catch(e:Exception){
            EliteEngineSession.lastMessage="Stopped · Android denied network foreground monitoring."
            stopSelf()
            return START_NOT_STICKY
        }
        if(job?.isActive==true)return START_NOT_STICKY
        EliteEngineSession.running=true
        EliteEngineSession.successfulCycles=0
        job=scope.launch {
            var consecutiveErrors=0
            var monitoringDelayMs=45_000L
            while(isActive){
                if(!EliteEngineSession.internetAvailable){
                    update("Internet offline · DEMO monitoring paused; auto-resumes while active")
                    networkWakeup.receive()
                    continue
                }
                try {
                    val reply=api.mobileEnginePulse()
                    monitoringDelayMs=if(reply.optInt("scanIntervalSeconds",45)==15)15_000L else 45_000L
                    if(!reply.optBoolean("ok")||reply.optString("mode")!="broker-demo-only")
                        throw ApiProblem("DEMO backend did not acknowledge monitoring.")
                    consecutiveErrors=0
                    EliteEngineSession.lastHeartbeatMillis=System.currentTimeMillis()
                    EliteEngineSession.successfulCycles++
                    update(if(reply.optBoolean("armed"))"DEMO bot monitoring · backend verified" else "Connected · no bots armed")
                    withTimeoutOrNull(45_000L){networkWakeup.receive()}
                }catch(e:CancellationException){throw e}
                catch(e:Exception){
                    val cause=(e.message ?: "").lowercase()
                    // Expired/revoked account and device-authorization failures
                    // require a deliberate sign-in, not unattended retries.
                    if(listOf("sign in","authentication","jwt","session expired",
                        "verify this","device verification","administrator",
                        "two-factor","not configured").any{cause.contains(it)}){
                        EliteEngineSession.lastMessage="Stopped · sign in or verify this device to resume."
                        stopSelf()
                        break
                    }
                    consecutiveErrors++
                    update("Backend/provider unavailable · retrying when connected")
                    // Retry is bounded; never spin or keep a falsely healthy
                    // heartbeat when requests are failing.
                    val waitMs=(45_000L*(1L shl consecutiveErrors.coerceAtMost(2))).coerceAtMost(300_000L)
                    withTimeoutOrNull(waitMs){networkWakeup.receive()}
                }
            }
        }
        return START_NOT_STICKY
    }
    /** Android 15+ limits background dataSync service runtime. Stop cleanly. */
    override fun onTimeout(startId:Int,fgsType:Int){
        EliteEngineSession.lastMessage="Stopped by Android background time limit · reopen Elite Engine."
        stopSelf(startId)
    }
    override fun onDestroy(){
        job?.cancel()
        networkCallback?.let {
            try {connectivityManager?.unregisterNetworkCallback(it)} catch(_:Exception){}
        }
        networkCallback=null
        connectivityManager=null
        scope.cancel()
        EliteEngineSession.running=false
        EliteEngineSession.internetAvailable=false
        EliteEngineSession.api=null
        if(!EliteEngineSession.lastMessage.startsWith("Stopped"))
            EliteEngineSession.lastMessage="Stopped · existing broker positions remain on MT5"
        super.onDestroy()
    }
}
