package com.elitetrade.android

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

private val Night = Color(0xFF000000)
private val Surface = Color(0xFF0A0A0A)
private val Raised = Color(0xFF0D0D0D)
private val Ink = Color(0xFFFFFFFF)
private val Muted = Color(0xFF9CA3AF)
private val Blue = Color(0xFF528BF9)
private val Gold = Color(0xFFD8B16A)
private val Up = Color(0xFF34D399)
private val Down = Color(0xFFFF747D)

class NativeActivity : ComponentActivity() {
    private lateinit var api: EliteApi
    private lateinit var updater: EliteUpdateManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = EliteApi(applicationContext)
        updater = EliteUpdateManager(this)
        window.statusBarColor = android.graphics.Color.BLACK
        window.navigationBarColor = android.graphics.Color.BLACK
        window.decorView.systemUiVisibility = 0
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        setContent { EliteTradeNative(api, updater) }
    }
    override fun onResume() {
        super.onResume()
        if (::updater.isInitialized) updater.resumePendingInstaller()
    }
}

private fun JSONObject.str(name: String, fallback: String = ""): String =
    if (isNull(name)) fallback else optString(name,fallback).ifBlank { fallback }
private fun JSONObject.money(name: String): String {
    val num = optDouble(name,Double.NaN)
    if (!num.isFinite()) return "—"
    return try { NumberFormat.getCurrencyInstance(Locale.US).apply {
        currency=java.util.Currency.getInstance(str("currency","USD"))
    }.format(num) } catch (_: Exception) { "%.2f".format(Locale.US,num) }
}
private fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }
private fun labelStatus(value: String): String = value.replace('_',' ').replaceFirstChar { it.uppercase() }
private fun JSONObject.snapshot(): JSONObject? = optJSONObject("snapshot")
private fun firstAccount(accounts: List<JSONObject>, selected: String): JSONObject? =
    accounts.find { it.str("id")==selected } ?: accounts.firstOrNull()
private fun valueText(s: JSONObject?, key: String): String =
    if (s == null) "—" else s.money(key)
private fun compactNumber(value: Double): String =
    if (value.isFinite()) "%+.2f".format(Locale.US,value) else "—"

@Composable
private fun EliteTradeNative(api: EliteApi, updater: EliteUpdateManager) {
    var updateInfo by remember { mutableStateOf<EliteUpdate?>(null) }
    var showUpdateDialog by remember { mutableStateOf(false) }
    var updateBusy by remember { mutableStateOf(false) }
    var updateProgress by remember { mutableIntStateOf(0) }
    var updateError by remember { mutableStateOf("") }
    var booting by remember { mutableStateOf(true) }
    var signedIn by remember { mutableStateOf(false) }
    var screen by remember { mutableStateOf("Home") }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var pendingConfirmationEmail by remember { mutableStateOf("") }
    var awaitingDeviceVerification by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    // The Elite Engine page registers its own read-only server readiness check.
    // Our single footer refresh awaits it after the shared account refresh.
    var engineRefreshHandler by remember { mutableStateOf<(suspend () -> Unit)?>(null) }
    val accounts = remember { mutableStateListOf<JSONObject>() }
    val bots = remember { mutableStateListOf<JSONObject>() }
    val executionHistory = remember { mutableStateListOf<JSONObject>() }
    var activeAccount by remember { mutableStateOf("") }
    var adminData by remember { mutableStateOf<JSONObject?>(null) }
    var supportData by remember { mutableStateOf<JSONObject?>(null) }
    var payments by remember { mutableStateOf(JSONArray()) }
    var billingMethods by remember { mutableStateOf<JSONObject?>(null) }
    var billingInvoices by remember { mutableStateOf<JSONObject?>(null) }
    var billingPayments by remember { mutableStateOf(JSONArray()) }
    var billingBusy by remember { mutableStateOf(false) }
    var billingError by remember { mutableStateOf("") }
    var pendingReview by remember { mutableStateOf<JSONObject?>(null) }
    var showConnect by remember { mutableStateOf(false) }
    var pendingControl by remember { mutableStateOf<JSONObject?>(null) }
    var pendingBotPreview by remember { mutableStateOf<JSONObject?>(null) }
    var pendingStrategySelection by remember { mutableStateOf<Pair<JSONObject,String>?>(null) }
    var selectedConversation by remember { mutableStateOf("") }
    var thread by remember { mutableStateOf<JSONObject?>(null) }
    val context = LocalContext.current
    val themePrefs = remember(context) { context.getSharedPreferences("elitetrade_appearance", Context.MODE_PRIVATE) }
    var lightTheme by remember { mutableStateOf(themePrefs.getBoolean("light_theme", false)) }
    val toggleTheme: () -> Unit = {
        lightTheme = !lightTheme
        themePrefs.edit().putBoolean("light_theme", lightTheme).apply()
    }
    val hostWindow = (context as? ComponentActivity)?.window
    SideEffect {
        hostWindow?.let { window ->
            val chrome = if (lightTheme) android.graphics.Color.rgb(244, 246, 250) else android.graphics.Color.BLACK
            window.statusBarColor = chrome
            window.navigationBarColor = chrome
            if (Build.VERSION.SDK_INT >= 30) {
                val iconMask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                window.insetsController?.setSystemBarsAppearance(if (lightTheme) iconMask else 0, iconMask)
            } else {
                window.decorView.systemUiVisibility = if (lightTheme)
                    (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) else 0
            }
        }
    }
    val scope = rememberCoroutineScope()
    val bg = if (lightTheme) Color(0xFFF4F6FA) else Night
    val panel = if (lightTheme) Color.White else Surface
    val textColor = if (lightTheme) Color(0xFF142238) else Ink
    val mutedColor = if (lightTheme) Color(0xFF617188) else Muted
    val scheme = if (lightTheme) lightColorScheme(primary=Color(0xFF295FC3),background=bg,surface=panel,onBackground=textColor,onSurface=textColor)
                 else darkColorScheme(primary=Blue,background=bg,surface=panel,onBackground=textColor,onSurface=textColor)

    fun checkForUpdates() {
        if (updater.isDebug()) {
            message = "This is a testing APK. Install the official signed EliteTrade release once to enable future in-place updates."
            return
        }
        scope.launch {
            updateError = ""
            try {
                val latest = updater.check()
                if (latest == null) message = "EliteTrade is up to date, or no signed release is published yet."
                else { updateInfo = latest; showUpdateDialog = true }
            } catch(e: Exception) { message = e.message ?: "Couldn't check for updates." }
        }
    }

    LaunchedEffect(Unit) {
        if (!updater.isDebug()) {
            try {
                val latest = updater.check()
                if (latest != null) { updateInfo = latest; showUpdateDialog = true }
            } catch (_: Exception) { /* Offline start must not block authentication. */ }
        }
    }

    fun refreshBilling() {
        scope.launch {
            if (billingBusy) return@launch
            billingBusy=true; billingError=""
            try {
                billingMethods=api.paymentMethods()
                billingInvoices=api.cryptoInvoices()
                billingPayments=api.payments()
                api.refreshMember()
            } catch(e:Exception) {
                billingError=e.message ?: "Unable to refresh payments. Try again."
            } finally {billingBusy=false}
        }
    }

    fun refresh() {
        if (refreshing) return // Do not duplicate broker or payment requests on rapid taps.
        refreshing = true
        scope.launch {
            busy = true; error = ""
            try {
                api.refreshMember() // Update server-authoritative subscription and role before showing account data.
                val a = api.accounts().objects()
                val overview = api.botsOverview()
                val b = (overview.optJSONArray("bots") ?: JSONArray()).objects()
                val receipts = (overview.optJSONArray("executionHistory") ?: JSONArray()).objects()
                accounts.clear(); accounts.addAll(a)
                bots.clear(); bots.addAll(b)
                executionHistory.clear(); executionHistory.addAll(receipts)
                if (a.none { it.str("id") == activeAccount }) activeAccount = a.firstOrNull()?.str("id") ?: ""
                if (screen=="Support") supportData=api.support()
                if (screen=="Admin" && api.user?.str("role")=="admin") adminData=api.admin()
                if (screen=="Activity") payments=api.payments()
                if (screen in listOf("Billing","Payment Methods","Payment History")) {
                    billingMethods=api.paymentMethods()
                    billingInvoices=api.cryptoInvoices()
                    billingPayments=api.payments()
                }
                if (screen=="Elite Engine") engineRefreshHandler?.invoke()
            } catch (e: Exception) { error = e.message ?: "Could not refresh account information." }
            finally { busy=false; refreshing=false }
        }
    }

    LaunchedEffect(Unit) {
        try { api.config(); signedIn=api.restore(); awaitingDeviceVerification=api.needsDeviceVerification }
        catch (e:Exception) { error=e.message ?: "Service unavailable." }
        finally { booting=false }
    }
    LaunchedEffect(signedIn) {
        if(signedIn){refresh();refreshBilling()}
        else {billingMethods=null;billingInvoices=null;billingPayments=JSONArray();executionHistory.clear()}
    }
    LaunchedEffect(screen) {
        if (signedIn) {
            try {
                if (screen=="Support") supportData=api.support()
                if (screen=="Admin" && api.user?.str("role")=="admin") adminData=api.admin()
                if (screen=="Activity") payments=api.payments()
                if(screen in listOf("Billing","Payment Methods","Payment History")) refreshBilling()
            } catch (e:Exception) { error=e.message ?: "Couldn't load this screen." }
        }
    }
    LaunchedEffect(signedIn,screen) {
        while(signedIn && screen in listOf("Billing","Payment Methods","Payment History")) {
            kotlinx.coroutines.delay(30000)
            if(signedIn) refreshBilling()
        }
    }
    LaunchedEffect(selectedConversation) {
        if (selectedConversation.isNotBlank()) {
            try { thread=api.supportThread(selectedConversation) }
            catch (e:Exception) {error=e.message ?: "Conversation unavailable."}
        } else thread=null
    }
    BackHandler(enabled=signedIn && (screen !in listOf("Home","Markets","Trade","Bot","Account") || selectedConversation.isNotBlank())) {
        if (selectedConversation.isNotBlank()) selectedConversation="" else screen="Account"
    }

    MaterialTheme(colorScheme=scheme) {
        Box(Modifier.fillMaxSize().background(bg).safeDrawingPadding()) {
            if (booting) {
                Column(Modifier.align(Alignment.Center),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(20.dp)) {
                    BrandEmblem()
                    CircularProgressIndicator(color=Gold,strokeWidth=2.dp)
                }
            } else if (!signedIn && awaitingDeviceVerification) {
                DeviceVerificationPage(
                    busy=busy,error=error,message=message,light=lightTheme,
                    email=api.deviceEmail,
                    onVerify={code->
                        scope.launch {
                            busy=true;error="";message=""
                            try {
                                if(api.confirmDeviceCode(code)){
                                    awaitingDeviceVerification=false
                                    signedIn=true
                                    screen="Home"
                                } else {
                                    error="Your device verification could not be completed. Request a new code."
                                }
                            } catch(e:Exception){error=e.message ?: "Code verification failed."}
                            finally {busy=false}
                        }
                    },
                    onResend={
                        scope.launch {
                            busy=true;error="";message=""
                            try {
                                api.requestDeviceVerification()
                                message="Verification requested. Check your inbox and spam folder for the eight-digit code."
                            } catch(e:Exception){error=e.message ?: "Could not request a verification email."}
                            finally {busy=false}
                        }
                    },
                    onCancel={
                        scope.launch {
                            busy=true
                            try { api.signOut() }
                            finally {
                                awaitingDeviceVerification=false
                                pendingConfirmationEmail=""
                                error=""
                                message=""
                                busy=false
                            }
                        }
                    }
                )
            } else if (!signedIn) {
                AuthPage(
                    busy=busy,error=error,message=message,light=lightTheme,
                    pendingEmail=pendingConfirmationEmail,
                    onResend={ email ->
                        scope.launch {
                            busy=true;error="";message=""
                            try {
                                api.resendConfirmation(email)
                                message="If this address has an unconfirmed registration, a new verification request was accepted. Check your inbox and spam folder."
                            } catch (e:Exception) {
                                error=e.message ?: "Confirmation could not be requested. Try again later."
                            } finally {busy=false}
                        }
                    },
                    onLogin={email,pass->
                        scope.launch {
                            busy=true;error="";message=""
                            try {
                                if(api.signIn(email,pass)){signedIn=true;screen="Home"}
                                else if(api.needsDeviceVerification){
                                    awaitingDeviceVerification=true
                                    try {
                                        api.requestDeviceVerification()
                                        message="A verification code was requested for this device."
                                    } catch(e:Exception) {
                                        error=e.message ?: "Choose Send code to verify this device."
                                    }
                                } else error="Unable to verify this account. Try signing in again."
                            }
                            catch (e:Exception){error=e.message ?: "Unable to sign in."}
                            finally { busy=false }
                        }
                    },
                    onSignup={name,email,pass->
                        scope.launch {
                            busy=true;error="";message=""
                            try {
                                if(api.signUp(name,email,pass)){
                                    pendingConfirmationEmail="";signedIn=true;screen="Home"
                                } else if(api.needsDeviceVerification) {
                                    awaitingDeviceVerification=true
                                    try {
                                        api.requestDeviceVerification()
                                        message="A verification code was requested for this device."
                                    } catch(e:Exception) {
                                        error=e.message ?: "Choose Send code to verify this device."
                                    }
                                } else {
                                    pendingConfirmationEmail=email.trim()
                                    message="Registration requested. If confirmation is required, check your inbox or spam folder."
                                }
                            } catch (e:Exception) {error=e.message ?: "Account creation failed."}
                            finally {busy=false}
                        }
                    },
                    onRecovery={email->
                        scope.launch {
                            busy=true;error=""
                            try {api.recoverPassword(email);message="If the address is registered, recovery instructions have been sent."}
                            catch (e:Exception){error=e.message ?: "Recovery request failed."}
                            finally {busy=false}
                        }
                    }
                )
            } else {
                val mainTabs=listOf("Home","Markets","Trade","Bot","Account")
                val selected=firstAccount(accounts,activeAccount)
                val keyboardOpen=WindowInsets.ime.getBottom(LocalDensity.current) > 0
                Column(Modifier.fillMaxSize()) {
                    NativeHeader(
                        title=screen,selected=selected,
                        onBack=if(screen !in mainTabs) {{screen="Account";selectedConversation=""}} else null,
                        onNotifications={screen="Activity"},
                        onMenuNavigate={destination->screen=destination;error="";message=""},
                        isAdmin=api.user?.str("role")=="admin",
                        light=lightTheme,textColor=textColor
                    )
                    updateInfo?.let { available ->
                        Surface(color=Gold.copy(alpha=.11f),modifier=Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(horizontal=16.dp,vertical=7.dp),
                                verticalAlignment=Alignment.CenterVertically) {
                                Icon(Icons.Default.SystemUpdate,contentDescription=null,tint=Gold)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("EliteTrade update available",fontSize=13.sp,fontWeight=FontWeight.Bold,color=textColor)
                                    Text("Version " + available.versionName,fontSize=11.sp,color=mutedColor)
                                }
                                TextButton(onClick={showUpdateDialog=true}) { Text("Update",color=Gold) }
                            }
                        }
                    }
                    if (error.isNotBlank()) {
                        Surface(color=Down.copy(alpha=.12f),modifier=Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(horizontal=18.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically) {
                                Icon(Icons.Default.Warning,contentDescription=null,tint=Down,modifier=Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(error,color=textColor,fontSize=12.sp,modifier=Modifier.weight(1f))
                                TextButton(onClick={error=""}){Text("Dismiss",fontSize=12.sp)}
                            }
                        }
                    }
                    if (message.isNotBlank()) {
                        Surface(color=Up.copy(alpha=.13f),modifier=Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(horizontal=16.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
                                Text(message,modifier=Modifier.weight(1f),fontSize=13.sp)
                                TextButton(onClick={message=""}){Text("OK")}
                            }
                        }
                    }
                    Box(Modifier.weight(1f)) {
                        when(screen) {
                            "Home" -> HomePage(selected,accounts,bots,panel,textColor,mutedColor,
                                onSelect={activeAccount=it},onConnect={showConnect=true},
                                onBot={screen="Bot"},onPositions={screen="Trade"},onActivity={screen="Activity"})
                            "Markets" -> MarketsPage(bots,selected,panel,textColor,mutedColor,onTrade={screen="Trade"})
                            "Trade" -> TradePage(selected,panel,textColor,mutedColor)
                            "Bot" -> BotPage(bots,accounts,executionHistory,panel,textColor,mutedColor,onConnect={showConnect=true},
                                onControl={pendingControl=it},onEngine={screen="Elite Engine"},
                                onStrategy={bot,strategy->pendingStrategySelection=bot to strategy},
                                onPreview={bot->
                                    scope.launch {
                                        busy=true;error=""
                                        try { pendingBotPreview=api.previewBot(bot.str("id")) }
                                        catch(e:Exception){error=e.message ?: "Risk preview unavailable. Check your MT5 demo connection."}
                                        finally{busy=false}
                                    }
                                })
                            "ClaudeBot" -> ClaudeBotPage(api,bots,accounts,
                                api.user?.optBoolean("active")==true || api.user?.str("role")=="admin")
                            "Claude Pro Bot" -> ClaudeProBotPage(api,onNavigate={screen=it})
                            "Gold SMC Scalper" -> GoldSmcPage(api,bots,accounts)
                            "Elite Engine" -> EliteEnginePage(api,context,
                                onRegisterRefresh={ handler -> engineRefreshHandler=handler })
                            "EliteBridge" -> EliteBridgePage(api,onNavigate={screen=it})
                            "Account" -> AccountPage(api.user,panel,textColor,mutedColor,lightTheme,
                                onNavigate={screen=it},onTheme=toggleTheme,onCheckUpdates={checkForUpdates()},
                                onSignOut={
                                    scope.launch {EliteEngineService.stop(context);api.signOut();accounts.clear();bots.clear();executionHistory.clear();signedIn=false;screen="Home"}
                                })
                            "MT5" -> AccountsPage(accounts,panel,textColor,mutedColor,onConnect={showConnect=true})
                            "Support" -> SupportPage(supportData,selectedConversation,thread,panel,textColor,mutedColor,
                                onOpen={selectedConversation=it},onBack={selectedConversation=""},
                                onCreate={
                                    scope.launch {
                                        busy=true
                                        try {
                                            val result=api.supportCreate()
                                            supportData=api.support()
                                            selectedConversation=result.str("id")
                                        } catch(e:Exception){error=e.message ?: "Could not start conversation."}
                                        finally {busy=false}
                                    }
                                },
                                onSend={note->
                                    scope.launch {
                                        busy=true
                                        try {api.supportSend(selectedConversation,note);thread=api.supportThread(selectedConversation);supportData=api.support()}
                                        catch(e:Exception){error=e.message ?: "Message was not sent."}
                                        finally {busy=false}
                                    }
                                },busy=busy
                            )
                            "Activity" -> ActivityPage(payments,panel,textColor,mutedColor)
                            "Billing","Payment Methods","Payment History" -> EliteBillingPage(
                                section=screen,methodsData=billingMethods,invoiceData=billingInvoices,
                                payments=billingPayments,
                                active=api.user?.optBoolean("active")==true || api.user?.str("role")=="admin",
                                busy=billingBusy,error=billingError,
                                onNavigate={screen=it},
                                onCreateInvoice={methodId->
                                    scope.launch {
                                        billingBusy=true;billingError=""
                                        try {
                                            api.createCryptoInvoice(methodId)
                                            billingInvoices=api.cryptoInvoices()
                                            billingPayments=api.payments()
                                        } catch(e:Exception){billingError=e.message ?: "Invoice creation failed."}
                                        finally{billingBusy=false}
                                    }
                                },
                                onRefresh={refreshBilling()},
                                onSupport={screen="Support"}
                            )
                            "Settings" -> SettingsPage(lightTheme,panel,textColor,onTheme=toggleTheme,
                                onSupport={screen="Support"},onCheckUpdates={checkForUpdates()})
                            "Admin" -> AdminPage(adminData,panel,textColor,mutedColor,onReview={payment,approved->
                                pendingReview=JSONObject().put("id",payment.str("id")).put("status",if(approved)"approved" else "rejected")
                            })
                            else -> AccountPage(api.user,panel,textColor,mutedColor,lightTheme,onNavigate={screen=it},
                                onTheme=toggleTheme,onCheckUpdates={checkForUpdates()},onSignOut={
                                    scope.launch {EliteEngineService.stop(context);api.signOut();signedIn=false;screen="Home"}
                                })
                        }
                        if(busy && screen != "Support") LinearProgressIndicator(
                            modifier=Modifier.fillMaxWidth().align(Alignment.TopCenter).height(2.dp),color=Gold)
                    }
                    // Footer tool is in its own row, never layered over Stop engine
                    // or other critical actions. One tap reloads the relevant backend.
                    if (!keyboardOpen) {
                        Row(
                            modifier=Modifier.fillMaxWidth().padding(horizontal=19.dp,vertical=6.dp),
                            horizontalArrangement=Arrangement.End,
                            verticalAlignment=Alignment.CenterVertically
                        ) {
                            FloatingActionButton(
                                onClick={refresh()},
                                modifier=Modifier.size(54.dp),
                                shape=CircleShape,
                                containerColor=if(lightTheme)Color(0xFF295FC3) else Gold,
                                contentColor=if(lightTheme)Color.White else Night,
                                elevation=FloatingActionButtonDefaults.elevation(defaultElevation=7.dp)
                            ) {
                                if(refreshing) CircularProgressIndicator(
                                    modifier=Modifier.size(23.dp),strokeWidth=2.4.dp,
                                    color=if(lightTheme)Color.White else Night)
                                else Icon(Icons.Default.Refresh,contentDescription="Refresh backend data",
                                    modifier=Modifier.size(25.dp))
                            }
                        }
                    }
                    if (!keyboardOpen && screen!="Claude Pro Bot") {
                        FloatingTabs(mainTabs,screen,lightTheme) { screen=it;error="";message="" }
                    }
                }

                pendingReview?.let { candidate ->
                    AlertDialog(
                        onDismissRequest={pendingReview=null},
                        title={Text(if(candidate.str("status")=="approved")"Approve payment?" else "Reject payment?")},
                        text={Text("Review the transaction evidence and amount in the administrator records first. Approval activates an account and must be based on independently verified payment evidence.")},
                        confirmButton={
                            TextButton(onClick={
                                pendingReview=null
                                scope.launch {
                                    busy=true;error=""
                                    try {api.reviewPayment(candidate.str("id"),candidate.str("status")=="approved","Reviewed by administrator")
                                        adminData=api.admin()
                                        message="Payment review recorded."
                                    } catch(e:Exception){error=e.message ?: "Payment review failed."}
                                    finally{busy=false}
                                }
                            }){Text("Confirm review")}
                        },
                        dismissButton={TextButton(onClick={pendingReview=null}){Text("Cancel")}}
                    )
                }
                if(showConnect) {
                    ConnectMt5Sheet(onDismiss={showConnect=false},onSave={broker,login,serverName,password->
                        scope.launch {
                            busy=true;error=""
                            try {
                                val response=api.connectMt5(broker,login,serverName,password)
                                showConnect=false
                                message=response.str("message","MT5 submitted for review.")
                                refresh()
                            } catch(e:Exception){error=e.message ?: "Could not save MT5 account."}
                            finally {busy=false}
                        }
                    })
                }
                pendingStrategySelection?.let { (bot,strategy) ->
                    val label=when(strategy){
                        "scalping-m1"->"1-Min Scalper · M1"
                        "scalping-s15"->"15-Second Scalper · S15"
                        "scalping"->"Scalping · M5"
                        "trend"->"Trend · M15"
                        else->"Breakout · M15"
                    }
                    AlertDialog(
                        onDismissRequest={pendingStrategySelection=null},
                        title={Text("Select "+label+"?")},
                        text={Text("This changes only the saved strategy. M1 uses EMA 5/13 on closed 1-minute MT5 DEMO candles. A shorter timeframe does not guarantee a higher win rate. Your account, lot limit, stop loss, take profit, daily loss and drawdown settings remain unchanged. No bot is started and no order is placed.")},
                        confirmButton={
                            TextButton(onClick={
                                pendingStrategySelection=null
                                scope.launch {
                                    busy=true;error=""
                                    try {
                                        api.selectStrategy(bot,strategy)
                                        message=label+" saved. Preview the strategy before intentionally starting DEMO monitoring."
                                        refresh()
                                    } catch(e:Exception){error=e.message ?: "Strategy could not be saved."}
                                    finally {busy=false}
                                }
                            }) { Text("Save strategy") }
                        },
                        dismissButton={TextButton(onClick={pendingStrategySelection=null}){Text("Cancel")}}
                    )
                }
                pendingBotPreview?.let { preview ->
                    val signal=preview.optJSONObject("signal")
                    val fit=preview.optJSONObject("riskFit")
                    val proposal=fit?.optJSONObject("suggestion")
                    val blocked=fit?.optString("status")=="blocked_minimum_lot"
                    val explanatory=if(blocked)
                        "Your current stop distance costs too much at the broker minimum lot. " +
                        "Approximate loss: " + fit!!.optDouble("minLotRiskAtConfiguredStop") +
                        " versus risk allowance: " + fit.optDouble("riskBudget") + ". " +
                        (if(proposal!=null) "For MANUAL review only: stop " +
                            proposal.optDouble("stopLossPercent") + "% and target " +
                            proposal.optDouble("takeProfitPercent") + "%. " else
                            "No safely affordable alternative could be validated. ") +
                        "A tighter stop can be hit more often. Do not increase your risk allowance just to force an entry."
                    else if(fit?.optString("status")=="affordable")
                        "Estimated minimum lot sizing appears affordable, but the position/exposure, margin, session and worker checks still need verification."
                    else "Broker risk affordability could not be verified from the current quote. No risk settings were changed."
                    AlertDialog(
                        onDismissRequest={pendingBotPreview=null},
                        title={Text("Live broker signal & risk")},
                        text={Column(verticalArrangement=Arrangement.spacedBy(9.dp)){
                            Text("Signal: "+(signal?.str("side")?.ifBlank{"No entry"} ?: "No entry"))
                            Text(explanatory,fontSize=13.sp)
                            Text("Read-only preview. No broker order was sent, and strategy profitability is unverified.",
                                fontSize=11.sp,color=Muted)
                        }},
                        confirmButton={TextButton(onClick={pendingBotPreview=null}){Text("Close")}}
                    )
                }
                pendingControl?.let { bot ->
                    val running = bot.str("status")!="running"
                    AlertDialog(
                        onDismissRequest={pendingControl=null},
                        title={Text(if(running) "Start automation?" else "Stop automation?")},
                        text={Text(if(running) "This arms DEMO monitoring on your existing Exness account. A broker-demo order may be placed only after a qualifying signal and all server risk checks. Make sure Elite Engine has a fresh server heartbeat. No real-account trading is allowed."
                              else "Stop new automated entries. Existing DEMO broker positions remain open and protected by their MT5 stop-loss/take-profit orders.")},
                        confirmButton={
                            Button(onClick={
                                pendingControl=null
                                scope.launch {
                                    busy=true;error=""
                                    try {
                                        if(running) {
                                            // User explicitly confirmed demo automation. Never arm a bot
                                            // from a background refresh or a read-only risk preview.
                                            // Android foreground monitoring is a time-limited session,
                                            // not a substitute for permanent hosted worker uptime.
                                            val engine=api.mobileEngineStatus()
                                            if(!engine.optBoolean("enabled"))
                                                throw IllegalStateException("Elite Engine is unavailable on the server. Open Elite Engine and check setup.")
                                            var ready=engine.optBoolean("ready")
                                            if(!ready) {
                                                EliteEngineService.start(context,api)
                                                for(attempt in 1..10) {
                                                    delay(1000L)
                                                    if(api.mobileEngineStatus().optBoolean("ready")) {
                                                        ready=true
                                                        break
                                                    }
                                                }
                                                if(!ready)throw IllegalStateException(
                                                    "Android monitoring has not established a fresh heartbeat. Open Elite Engine to diagnose before starting the bot.")
                                            }
                                        }
                                        api.controlBot(bot.str("id"),running)
                                        message="Command acknowledged. Refreshing server status."
                                        refresh()
                                    } catch (e:Exception) {error=e.message ?: "Gateway did not confirm this command."}
                                    finally {busy=false}
                                }
                            },colors=ButtonDefaults.buttonColors(containerColor=if(running) Blue else Down)){
                                Text(if(running) "Confirm start" else "Confirm stop")
                            }
                        },
                        dismissButton={TextButton(onClick={pendingControl=null}){Text("Cancel")}}
                    )
                }
            }
        }
        if (showUpdateDialog && updateInfo != null) {
            val available = updateInfo!!
            AlertDialog(
                onDismissRequest={if(!updateBusy) showUpdateDialog=false},
                icon={ Icon(Icons.Default.SystemUpdate,contentDescription=null,tint=Gold) },
                title={ Text("EliteTrade update available") },
                text={
                    Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                        Text("Version " + available.versionName + " is ready. Update your installed app without removing your account or its data.")
                        if (available.notes.isNotBlank()) Text(available.notes.take(200),fontSize=12.sp)
                        if (updateBusy) {
                            LinearProgressIndicator(progress={updateProgress/100f},modifier=Modifier.fillMaxWidth())
                            Text("Downloading and verifying… " + updateProgress + "%",fontSize=12.sp)
                        }
                        if (updateError.isNotBlank())
                            Text(updateError,color=MaterialTheme.colorScheme.error,fontSize=12.sp)
                        Text("Android will ask you to approve installation. Only official APKs with matching signatures are accepted.",
                            fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                confirmButton={
                    Button(enabled=!updateBusy,onClick={
                        scope.launch {
                            updateBusy=true;updateError="";updateProgress=0
                            try {
                                updater.download(available) { percent -> updateProgress = percent }
                                showUpdateDialog=false
                                message="Android's installer will finish the upgrade. Your data stays installed."
                            } catch(e:Exception) {
                                updateError=e.message ?: "Couldn't install the update. Try again."
                            } finally {updateBusy=false}
                        }
                    }) {
                        Text(if(updateBusy)"Downloading…" else "Download & update")
                    }
                },
                dismissButton={TextButton(enabled=!updateBusy,onClick={showUpdateDialog=false}){Text("Later")}}
            )
        }
    }
}

@Composable
private fun BrandEmblem() {
    Box(Modifier.size(65.dp).clip(RoundedCornerShape(21.dp)).background(
        Brush.linearGradient(listOf(Color(0xFF29384B),Color(0xFF0F1620)))),
        contentAlignment=Alignment.Center) {
        Text("EB",color=Gold,fontSize=25.sp,fontWeight=FontWeight.Black,letterSpacing=(-1).sp)
    }
}


@Composable
private fun DeviceVerificationPage(
    busy:Boolean,error:String,message:String,light:Boolean,email:String,
    onVerify:(String)->Unit,onResend:()->Unit,onCancel:()->Unit
) {
    var code by remember { mutableStateOf("") }
    val base=if(light) Color(0xFFF4F6FA) else Night
    val headline=if(light) Color(0xFF15243A) else Ink
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).background(base)
        .padding(horizontal=28.dp,vertical=28.dp),
        verticalArrangement=Arrangement.spacedBy(18.dp)) {
        Spacer(Modifier.height(12.dp))
        BrandEmblem()
        Text("Verify this device",fontSize=26.sp,fontWeight=FontWeight.Bold,color=headline)
        Text(
            if (email.isNotBlank()) "For account security, enter the eight-digit verification code sent to $email."
            else "For account security, enter the eight-digit verification code sent to your registered email.",
            fontSize=14.sp,color=if(light)Color(0xFF617188) else Muted
        )
        OutlinedTextField(
            value=code,
            onValueChange={code=it.filter(Char::isDigit).take(8)},
            label={Text("Eight-digit email code")},
            modifier=Modifier.fillMaxWidth(),
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.NumberPassword),
            singleLine=true
        )
        if(error.isNotBlank()) Text(error,color=Down,fontSize=13.sp)
        if(message.isNotBlank()) Text(message,color=Up,fontSize=13.sp)
        Button(
            onClick={onVerify(code)},enabled=!busy&&code.length==8,
            modifier=Modifier.fillMaxWidth().height(56.dp),
            shape=RoundedCornerShape(16.dp),
            colors=ButtonDefaults.buttonColors(containerColor=Blue)
        ) {
            if(busy) CircularProgressIndicator(color=Color.White,modifier=Modifier.size(22.dp),strokeWidth=2.dp)
            else Text("Verify & open EliteTrade",fontWeight=FontWeight.SemiBold)
        }
        TextButton(onClick=onResend,enabled=!busy,modifier=Modifier.align(Alignment.CenterHorizontally)) {
            Text("Send another code")
        }
        Text("Each code expires. For your security, verification cannot be skipped. Repeated email requests may be rate-limited.",
            fontSize=12.sp,color=if(light)Color(0xFF617188) else Muted)
        HorizontalDivider(color=if(light)Color(0xFFE1E6ED) else Raised)
        TextButton(onClick=onCancel,enabled=!busy,modifier=Modifier.align(Alignment.CenterHorizontally)){
            Text("Use another account")
        }
    }
}

@Composable
private fun AuthPage(busy:Boolean,error:String,message:String,light:Boolean,
    pendingEmail:String,onResend:(String)->Unit,
    onLogin:(String,String)->Unit,onSignup:(String,String,String)->Unit,onRecovery:(String)->Unit) {
    var mode by remember {mutableStateOf("Sign in")}
    var name by remember {mutableStateOf("")}
    var email by remember {mutableStateOf("")}
    var password by remember {mutableStateOf("")}
    var showPassword by remember {mutableStateOf(false)}
    LaunchedEffect(pendingEmail) {
        if (pendingEmail.isNotBlank()) {
            email = pendingEmail
            mode = "Confirm"
        }
    }
    val base=if(light) Color(0xFFF4F6FA) else Night
    val headline=if(light) Color(0xFF15243A) else Ink
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).background(base)
        .padding(horizontal=28.dp,vertical=28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        Spacer(Modifier.height(18.dp))
        BrandEmblem()
        Spacer(Modifier.height(12.dp))
        Text("EliteBot",fontSize=32.sp,fontWeight=FontWeight.Bold,color=headline,letterSpacing=(-1).sp)
        Text("YOUR TRADING BOT",fontSize=11.sp,letterSpacing=2.sp,color=Gold,fontWeight=FontWeight.SemiBold)
        Spacer(Modifier.height(18.dp))
        Text(when(mode){"Sign up"->"Your edge starts here.";"Recovery"->"Recover your account.";"Confirm"->"Verify your email.";else->"Welcome back."},
            fontSize=25.sp,fontWeight=FontWeight.Bold,color=headline)
        Text(when(mode){"Sign up"->"Create your secure EliteTrade account.";"Recovery"->"We'll send instructions to your email.";"Confirm"->"Request another confirmation email for a pending registration.";else->"Your portfolio. Your rules. Your control."},
            fontSize=14.sp,color=if(light)Color(0xFF617188) else Muted)
        Spacer(Modifier.height(12.dp))
        if(mode=="Sign up") {
            OutlinedTextField(value=name,onValueChange={name=it},modifier=Modifier.fillMaxWidth(),label={Text("Full name")},singleLine=true)
        }
        OutlinedTextField(value=email,onValueChange={email=it},modifier=Modifier.fillMaxWidth(),
            label={Text("Email address")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email))
        if(mode!="Recovery" && mode!="Confirm") {
            OutlinedTextField(value=password,onValueChange={password=it},modifier=Modifier.fillMaxWidth(),
                label={Text("Password")},singleLine=true,
                visualTransformation=if(showPassword)VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon={IconButton(onClick={showPassword=!showPassword}){
                    Icon(if(showPassword)Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription=if(showPassword)"Hide password" else "Show password")
                }},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password))
        }
        if(error.isNotBlank())Text(error,color=Down,fontSize=13.sp)
        if(message.isNotBlank())Text(message,color=Up,fontSize=13.sp)
        if(mode=="Confirm") {
            Surface(
                color=Blue.copy(alpha=.10f),
                shape=RoundedCornerShape(16.dp),
                modifier=Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(15.dp),verticalArrangement=Arrangement.spacedBy(7.dp)) {
                    Text("Check your email",fontSize=15.sp,fontWeight=FontWeight.SemiBold)
                    Text("Check Inbox, Spam and Promotions. Resending only works for a registration that still needs confirmation. If your account is already verified, sign in instead.",
                        fontSize=12.sp,color=if(light)Color(0xFF617188) else Muted,lineHeight=17.sp)
                }
            }
            Button(onClick={onResend(email.trim())},enabled=!busy&&email.contains('@'),
                modifier=Modifier.fillMaxWidth().height(56.dp),shape=RoundedCornerShape(16.dp),
                colors=ButtonDefaults.buttonColors(containerColor=Blue)) {
                if(busy) CircularProgressIndicator(color=Color.White,modifier=Modifier.size(22.dp),strokeWidth=2.dp)
                else Text("Resend confirmation email",fontWeight=FontWeight.SemiBold)
            }
            Text("Supabase may rate-limit repeated emails. Request acceptance does not guarantee inbox delivery.",
                fontSize=11.sp,color=if(light)Color(0xFF617188) else Muted)
        } else {
            Button(onClick={
                when(mode){"Sign up"->onSignup(name,email,password);"Recovery"->onRecovery(email);else->onLogin(email,password)}
            },enabled=!busy&&email.contains('@')&&(mode=="Recovery"||(password.length >= (if(mode=="Sign up")12 else 1) &&
                (mode!="Sign up"||name.isNotBlank()))),
                modifier=Modifier.fillMaxWidth().height(56.dp),shape=RoundedCornerShape(16.dp),
                colors=ButtonDefaults.buttonColors(containerColor=Blue)) {
                if(busy) CircularProgressIndicator(color=Color.White,modifier=Modifier.size(22.dp),strokeWidth=2.dp)
                else Text(when(mode){"Sign up"->"Create account";"Recovery"->"Send recovery email";else->"Secure sign in"},fontWeight=FontWeight.SemiBold)
            }
        }
        if(mode=="Sign in") {
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                TextButton(onClick={mode="Confirm"}) {Text("Resend confirmation",fontSize=12.sp)}
                TextButton(onClick={mode="Recovery"}) {Text("Forgot password?",fontSize=12.sp)}
            }
        }
        HorizontalDivider(color=if(light)Color(0xFFE1E6ED) else Raised)
        TextButton(onClick={mode=if(mode=="Sign up")"Sign in" else if(mode=="Recovery")"Sign in" else "Sign up"},
            modifier=Modifier.align(Alignment.CenterHorizontally)){
            Text(if(mode=="Sign in")"New to EliteTrade? Create account" else "Return to sign in")
        }
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment=Alignment.CenterVertically) {
            Icon(Icons.Default.Lock,contentDescription=null,tint=Muted,modifier=Modifier.size(15.dp))
            Spacer(Modifier.width(8.dp))
            Text("Secure authentication · English",fontSize=12.sp,color=Muted)
        }
    }
}

@Composable
private fun NativeHeader(title:String,selected:JSONObject?,onBack:(()->Unit)?,
    onNotifications:()->Unit,onMenuNavigate:(String)->Unit,isAdmin:Boolean,
    light:Boolean,textColor:Color) {
    var menuOpen by remember {mutableStateOf(false)}
    val p=if(light)Color(0xFFFEFFFF) else Surface
    Surface(color=p,shadowElevation=2.dp,tonalElevation=0.dp) {
        Row(Modifier.fillMaxWidth().height(66.dp).padding(horizontal=16.dp),
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            if(onBack!=null) {
                IconButton(onClick=onBack,modifier=Modifier.size(42.dp)){
                    Icon(Icons.Default.ArrowBack,contentDescription="Back",tint=textColor)
                }
            } else {
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(Raised),contentAlignment=Alignment.Center){
                    Text("EB",color=Gold,fontWeight=FontWeight.Black,fontSize=15.sp)
                }
            }
            Column(Modifier.weight(1f)) {
                Text(if(title=="Home")"EliteTrade" else title,fontWeight=FontWeight.Bold,fontSize=18.sp,
                    color=textColor,maxLines=1,overflow=TextOverflow.Ellipsis)
                if(title=="Home" || title=="Markets" || title=="Trade") {
                    Text(if(selected==null)"No MT5 account connected"
                        else selected.str("broker") + " · " + labelStatus(selected.str("status","unknown")),
                        fontSize=11.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
            }
            Box {
                IconButton(onClick={menuOpen=true},modifier=Modifier.size(40.dp)) {
                    Icon(Icons.Default.Menu,contentDescription="Open navigation menu",tint=textColor)
                }
                DropdownMenu(expanded=menuOpen,onDismissRequest={menuOpen=false}) {
                    val items=listOf("Home","Markets","Trade","Bot","Elite Engine","EliteBridge","ClaudeBot","Claude Pro Bot","Gold SMC Scalper","Account","MT5",
                        "Activity","Billing","Settings","Support")+(if(isAdmin)listOf("Admin") else emptyList())
                    items.forEach { destination->
                        DropdownMenuItem(text={Text(destination,
                            color=if(destination=="ClaudeBot"||destination=="Elite Engine"||destination=="EliteBridge")Gold else MaterialTheme.colorScheme.onSurface,
                            fontWeight=if(destination==title)FontWeight.Bold else FontWeight.Medium)},
                            leadingIcon={Icon(if(destination=="EliteBridge")Icons.Default.Cable else if(destination=="Elite Engine")Icons.Default.Memory else if(destination=="ClaudeBot")Icons.Default.AutoGraph
                                else if(destination=="Bot")Icons.Default.SmartToy else Icons.Default.ChevronRight,
                                contentDescription=null)},
                            onClick={menuOpen=false;onMenuNavigate(destination)})
                    }
                }
            }
            IconButton(onClick=onNotifications,modifier=Modifier.size(40.dp)) {
                Icon(Icons.Default.NotificationsNone,contentDescription="Notifications",tint=textColor)
            }
        }
    }
}

@Composable
private fun FloatingTabs(tabs:List<String>,selected:String,light:Boolean,onSelect:(String)->Unit) {
    val icons=listOf(Icons.Default.Home,Icons.Default.TrendingUp,Icons.Default.ShowChart,Icons.Default.SmartToy,Icons.Default.Person)
    val panel=if(light) Color(0xF9FFFFFF) else Color(0xEE0A0A0A)
    Surface(Modifier.fillMaxWidth().padding(start=12.dp,end=12.dp,bottom=9.dp,top=5.dp),
        color=panel,shape=RoundedCornerShape(24.dp),border=BorderStroke(1.dp,if(light)Color(0xFFDCE3EC) else Color(0xFF262626)),
        shadowElevation=12.dp) {
        Row(Modifier.fillMaxWidth().padding(5.dp),horizontalArrangement=Arrangement.spacedBy(2.dp)) {
            tabs.forEachIndexed { index,tab ->
                val active=selected==tab
                Column(Modifier.weight(1f).heightIn(min=57.dp).clip(RoundedCornerShape(16.dp))
                    .background(if(active)Blue.copy(alpha=.19f) else Color.Transparent)
                    .clickable {onSelect(tab)}.padding(vertical=5.dp),
                    horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center) {
                    Icon(icons[index],contentDescription=null,tint=if(active)Blue else Muted,modifier=Modifier.size(22.dp))
                    Spacer(Modifier.height(3.dp))
                    Text(tab,fontSize=10.sp,fontWeight=if(active)FontWeight.Bold else FontWeight.Medium,
                        color=if(active)Blue else Muted,maxLines=1)
                }
            }
        }
    }
}

@Composable
private fun PageScroll(content:@Composable ColumnScope.()->Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=17.dp),
        verticalArrangement=Arrangement.spacedBy(15.dp),content=content)
}
@Composable private fun SectionTitle(text:String,action:String="",onAction:(()->Unit)?=null) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Text(text,color=MaterialTheme.colorScheme.onBackground,fontSize=16.sp,fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
        if(action.isNotBlank() && onAction!=null) TextButton(onClick=onAction){Text(action,fontSize=12.sp)}
    }
}
@Composable private fun EliteCard(panel:Color,content:@Composable ColumnScope.()->Unit) {
    Surface(color=panel,shape=RoundedCornerShape(20.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.onBackground.copy(alpha=.06f))) {
        Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(11.dp),content=content)
    }
}
@Composable private fun StatusPill(value:String) {
    val c=when(value.lowercase()){"connected","running","approved"->Up;"stopped","paused"->Gold;
        "disconnected","error"->Down;else->Muted}
    Surface(shape=RoundedCornerShape(100),color=c.copy(alpha=.13f)) {
        Text(labelStatus(value),fontSize=11.sp,fontWeight=FontWeight.SemiBold,color=c,
            modifier=Modifier.padding(horizontal=10.dp,vertical=5.dp))
    }
}
@Composable private fun Metric(label:String,value:String,modifier:Modifier=Modifier,tint:Color=MaterialTheme.colorScheme.onSurface) {
    Column(modifier,verticalArrangement=Arrangement.spacedBy(5.dp)){
        Text(label,color=Muted,fontSize=11.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
        Text(value,color=tint,fontSize=17.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
    }
}

@Composable
private fun HomePage(selected:JSONObject?,accounts:List<JSONObject>,bots:List<JSONObject>,panel:Color,
    textColor:Color,muted:Color,
    onSelect:(String)->Unit,onConnect:()->Unit,onBot:()->Unit,
    onPositions:()->Unit,onActivity:()->Unit) {
    var hidden by remember { mutableStateOf(false) }
    val snap=selected?.snapshot()
    val connected=selected?.str("status")=="connected"
    PageScroll {
        Spacer(Modifier.height(4.dp))
        Text("PORTFOLIO OVERVIEW",color=Gold,fontSize=11.sp,fontWeight=FontWeight.Bold,letterSpacing=1.5.sp)
        EliteCard(panel) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Text("Account balance",color=muted,fontSize=13.sp,modifier=Modifier.weight(1f))
                IconButton(onClick={hidden=!hidden},modifier=Modifier.size(30.dp)) {
                    Icon(if(hidden)Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription=if(hidden)"Show balance" else "Hide balance",tint=muted,modifier=Modifier.size(19.dp))
                }
            }
            Text(if(hidden)"••••••" else valueText(snap,"balance"),color=textColor,fontSize=32.sp,
                fontWeight=FontWeight.Bold,letterSpacing=(-1).sp)
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                StatusPill(selected?.str("status","not connected") ?: "not connected")
                Text(if(snap==null)"Broker snapshot unavailable" else "Broker-reported account values",color=muted,fontSize=11.sp)
            }
            HorizontalDivider(color=textColor.copy(alpha=.08f))
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
                Metric("Equity",if(hidden)"••••" else valueText(snap,"equity"),Modifier.weight(1f))
                val pnl=snap?.optDouble("profit",Double.NaN) ?: Double.NaN
                Metric("Floating P/L",if(hidden)"••••" else valueText(snap,"profit"),
                    Modifier.weight(1f),if(pnl>0)Up else if(pnl<0)Down else textColor)
            }
        }
        if(accounts.size>1) {
            SectionTitle("Trading accounts")
            Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                accounts.forEach { a ->
                    FilterChip(selected=selected?.str("id")==a.str("id"),onClick={onSelect(a.str("id"))},
                        label={Text(a.str("broker") + " · " + a.str("login"))})
                }
            }
        }
        SectionTitle("Quick actions")
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(9.dp)) {
            QuickAction("Connect MT5",Icons.Default.AddCircle,Blue,Modifier.weight(1f),onConnect)
            QuickAction("Manage Bot",Icons.Default.SmartToy,Color(0xFF8E6B37),Modifier.weight(1f),onBot)
            QuickAction("Positions",Icons.Default.ShowChart,Color(0xFF176358),Modifier.weight(1f),onPositions)
        }
        SectionTitle("Open positions", "View all",onPositions)
        EliteCard(panel) {
            val items=snap?.optJSONArray("positions")?.objects().orEmpty()
            if (!connected || snap==null) EmptyLine("Broker connection required","Position details are unavailable until MT5 confirms a snapshot.")
            else if(items.isEmpty())EmptyLine("No open positions","No broker positions were reported.")
            else items.take(3).forEach { PositionItem(it,textColor,muted) }
        }
        SectionTitle("EliteBot", "Manage",onBot)
        EliteCard(panel) {
            if(bots.isEmpty()) EmptyLine("No bot configured","Your trading bot will appear here when it is available.")
            else bots.forEach { bot ->
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(bot.str("name","EliteBot"),color=textColor,fontWeight=FontWeight.SemiBold)
                        Text(bot.str("symbol","—")+" · "+bot.str("strategy","—"),color=muted,fontSize=12.sp)
                    }
                    StatusPill(bot.str("status","unknown"))
                }
            }
        }
        TextButton(onClick=onActivity,modifier=Modifier.align(Alignment.CenterHorizontally)){Text("Recent activity  →")}
        Spacer(Modifier.height(12.dp))
    }
}
@Composable private fun QuickAction(label:String,icon:ImageVector,color:Color,modifier:Modifier,onClick:()->Unit) {
    Surface(modifier.height(86.dp).clickable(onClick=onClick),shape=RoundedCornerShape(18.dp),color=color) {
        Column(Modifier.padding(8.dp),horizontalAlignment=Alignment.CenterHorizontally,
            verticalArrangement=Arrangement.Center) {
            Icon(icon,contentDescription=null,tint=Color.White,modifier=Modifier.size(23.dp))
            Spacer(Modifier.height(6.dp))
            Text(label,color=Color.White,fontWeight=FontWeight.SemiBold,fontSize=11.sp,textAlign=TextAlign.Center,
                maxLines=1)
        }
    }
}
@Composable private fun EmptyLine(title:String,details:String) {
    Text(title,fontSize=14.sp,fontWeight=FontWeight.SemiBold)
    Text(details,color=Muted,fontSize=12.sp,lineHeight=17.sp)
}
@Composable private fun PositionItem(position:JSONObject,textColor:Color,muted:Color) {
    val pnl=position.optDouble("profit",Double.NaN)
    Row(Modifier.fillMaxWidth().padding(vertical=7.dp),verticalAlignment=Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(position.str("symbol","Instrument"),color=textColor,fontWeight=FontWeight.SemiBold,fontSize=14.sp)
            Text(position.str("type","Open")+" · "+position.str("volume","—")+" lots",color=muted,fontSize=11.sp)
        }
        Text(if(pnl.isFinite()) compactNumber(pnl) else "—",fontSize=15.sp,
            color=if(pnl>0) Up else if(pnl<0) Down else muted,fontWeight=FontWeight.Bold)
    }
}

@Composable
private fun MarketsPage(bots:List<JSONObject>,selected:JSONObject?,panel:Color,textColor:Color,muted:Color,onTrade:()->Unit) {
    var query by remember { mutableStateOf("") }
    val symbols=bots.distinctBy {it.str("symbol")}.filter {it.str("symbol").contains(query,true)}
    PageScroll {
        Spacer(Modifier.height(4.dp))
        Text("Markets",fontSize=24.sp,fontWeight=FontWeight.Bold,color=textColor)
        OutlinedTextField(value=query,onValueChange={query=it},modifier=Modifier.fillMaxWidth(),
            singleLine=true,placeholder={Text("Find an instrument")},
            leadingIcon={Icon(Icons.Default.Search,contentDescription=null)})
        SectionTitle("Your broker watchlist")
        if(symbols.isEmpty()) EliteCard(panel){ EmptyLine("No instruments available","Connect MT5 and configure a bot to populate your market watchlist.") }
        else symbols.forEach { bot ->
            Surface(color=panel,shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().clickable(onClick=onTrade)) {
                Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically) {
                    Box(Modifier.size(42.dp).clip(CircleShape).background(Blue.copy(alpha=.15f)),contentAlignment=Alignment.Center) {
                        Text(bot.str("symbol").take(2),color=Blue,fontWeight=FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(bot.str("symbol"),color=textColor,fontWeight=FontWeight.SemiBold)
                        Text(bot.str("strategy","Strategy"),color=muted,fontSize=11.sp)
                    }
                    Column(horizontalAlignment=Alignment.End) {
                        Text("Quote unavailable",color=muted,fontSize=12.sp)
                        Text("No verified price",color=muted,fontSize=10.sp)
                    }
                    Spacer(Modifier.width(5.dp))
                    Icon(Icons.Default.ChevronRight,contentDescription=null,tint=muted,modifier=Modifier.size(18.dp))
                }
            }
        }
        Text("Displayed symbols come from your saved bot configurations. No market movement is estimated.",
            color=muted,fontSize=12.sp)
    }
}

@Composable
private fun TradePage(selected:JSONObject?,panel:Color,textColor:Color,muted:Color) {
    val positions=selected?.snapshot()?.optJSONArray("positions")?.objects().orEmpty()
    PageScroll {
        Spacer(Modifier.height(4.dp))
        Text("Trade workspace",fontSize=23.sp,fontWeight=FontWeight.Bold,color=textColor)
        EliteCard(panel){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(selected?.str("broker","No broker selected") ?: "No MT5 account",color=textColor,fontSize=16.sp,fontWeight=FontWeight.SemiBold)
                    Text(selected?.str("login","Connect MT5") ?: "Connect to view positions",color=muted,fontSize=12.sp)
                }
                StatusPill(selected?.str("status","unavailable") ?: "unavailable")
            }
        }
        EliteCard(panel) {
            Text("Market chart",color=textColor,fontWeight=FontWeight.SemiBold,fontSize=16.sp)
            Box(Modifier.fillMaxWidth().height(175.dp).clip(RoundedCornerShape(14.dp))
                .background(Raised.copy(alpha=.55f)),contentAlignment=Alignment.Center) {
                Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.ShowChart,contentDescription=null,tint=Muted,modifier=Modifier.size(29.dp))
                    Text("No verified broker candles",color=Ink,fontSize=14.sp)
                    Text("Chart data must come from MT5 — never simulated.",color=Muted,fontSize=11.sp)
                }
            }
        }
        SectionTitle("Open positions")
        if(positions.isEmpty()) EliteCard(panel){EmptyLine("No broker positions available","Positions are shown only when the server confirms live account data.")}
        else positions.forEach { pos -> EliteCard(panel){PositionItem(pos,textColor,muted);
            Text("Entry: "+pos.str("openPrice","—")+"   SL: "+pos.str("stopLoss","—")+"   TP: "+pos.str("takeProfit","—"),
                fontSize=11.sp,color=muted)}
        }
        Text("Trade execution and position closing remain managed by your authorized MT5 infrastructure.",fontSize=12.sp,color=muted)
    }
}

@Composable
private fun BotPage(bots:List<JSONObject>,accounts:List<JSONObject>,executions:List<JSONObject>,panel:Color,textColor:Color,muted:Color,
    onConnect:()->Unit,onControl:(JSONObject)->Unit,onEngine:()->Unit,
    onStrategy:(JSONObject,String)->Unit,onPreview:(JSONObject)->Unit) {
    PageScroll {
        Spacer(Modifier.height(3.dp))
        Text("EliteBot",fontSize=27.sp,fontWeight=FontWeight.Bold,color=textColor)
        Text("YOUR TRADING BOT",color=Gold,letterSpacing=1.8.sp,fontSize=11.sp,fontWeight=FontWeight.Bold)
        OutlinedButton(onClick=onEngine,modifier=Modifier.fillMaxWidth(),colors=ButtonDefaults.outlinedButtonColors(contentColor=Gold)) {
            Icon(Icons.Default.Memory,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Open native Elite Engine")
        }
        Spacer(Modifier.height(3.dp))
        if(bots.isEmpty())EliteCard(panel){EmptyLine("Bot unavailable","No bot configuration was reported by the server.")}
        else bots.forEach { bot ->
            EliteCard(panel) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(bot.str("name","EliteBot"),fontSize=17.sp,fontWeight=FontWeight.SemiBold,color=textColor)
                        Text(bot.str("symbol","—") + " · " +
                            (if(bot.str("strategy")=="scalping-m1")"M1 Fast Scalper · EMA 5/13" else labelStatus(bot.str("strategy","trend"))),
                            color=muted,fontSize=12.sp)
                    }
                    StatusPill(bot.str("status","unknown"))
                }
                HorizontalDivider(color=textColor.copy(alpha=.08f))
                Row(Modifier.fillMaxWidth()) {
                    Metric("Risk / trade",bot.optDouble("risk_percent",Double.NaN).let {if(it.isFinite()) it.toString()+"%" else "—"},Modifier.weight(1f))
                    Metric("MT5 account",accounts.find {it.str("id")==bot.str("account_id")}?.str("login","Unassigned") ?: "Unassigned",Modifier.weight(1f))
                }
                Text("Execution status is confirmed by the server, not inferred from your phone.",fontSize=11.sp,color=muted)
                if(bot.str("engineMessage").contains("minimum broker lot",ignoreCase=true))
                    Surface(color=Down.copy(alpha=.12f),shape=RoundedCornerShape(12.dp)) {
                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                            Text("Risk check blocked trading",color=Down,fontSize=13.sp,fontWeight=FontWeight.SemiBold)
                            Text("Your broker minimum position size exceeds the current per-trade risk budget. Tap Preview signal & risk for a read-only broker-based estimate.",
                                fontSize=12.sp,color=textColor)
                        }
                    }
                if(bot.str("engineMessage").isNotBlank())
                    Text(bot.str("engineMessage"),fontSize=12.sp,color=muted)
                var strategyMenuExpanded by remember(bot.str("id")) { mutableStateOf(false) }
                val presets=listOf(
                    "scalping-m1" to "1-Min Scalper · M1",
                    "scalping-s15" to "15-Second Scalper · S15",
                    "scalping" to "Scalping · M5",
                    "trend" to "Trend · M15",
                    "breakout" to "Breakout · M15"
                )
                val strategyLabel=presets.firstOrNull {it.first==bot.str("strategy")}?.second ?: "Choose strategy"
                Box(Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick={strategyMenuExpanded=true},
                        enabled=bot.str("status")=="stopped",
                        modifier=Modifier.fillMaxWidth(),
                        shape=RoundedCornerShape(14.dp)
                    ) {
                        Icon(Icons.Default.Tune,contentDescription=null)
                        Spacer(Modifier.width(8.dp))
                        Text("Strategy: "+strategyLabel,modifier=Modifier.weight(1f),maxLines=1)
                        Icon(Icons.Default.ArrowDropDown,contentDescription="Open strategy list")
                    }
                    DropdownMenu(expanded=strategyMenuExpanded,onDismissRequest={strategyMenuExpanded=false}) {
                        presets.forEach { (key,label) ->
                            DropdownMenuItem(
                                text={Column {
                                    Text(label,fontWeight=if(bot.str("strategy")==key)FontWeight.Bold else FontWeight.Normal)
                                    if(key=="scalping-m1")Text("EMA 5/13 · DEMO only · closed 1m candles",
                                        fontSize=11.sp,color=Muted)
                                }},
                                onClick={
                                    strategyMenuExpanded=false
                                    if(key!=bot.str("strategy"))onStrategy(bot,key)
                                },
                                leadingIcon={if(key==bot.str("strategy")) {
                                    Icon(Icons.Default.Check,contentDescription=null,tint=Up)
                                }}
                            )
                        }
                    }
                }
                if(bot.str("status")!="stopped")
                    Text("Pause the bot to change its strategy.",fontSize=11.sp,color=muted)
                OutlinedButton(onClick={onPreview(bot)},modifier=Modifier.fillMaxWidth(),
                    enabled=bot.str("strategy")!="scalpin-ss-ex5",
                    shape=RoundedCornerShape(14.dp)){
                    Icon(Icons.Default.FactCheck,contentDescription=null)
                    Spacer(Modifier.width(8.dp))
                    Text("Preview signal & risk")
                }
                Button(onClick={onControl(bot)},modifier=Modifier.fillMaxWidth().height(50.dp),
                    colors=ButtonDefaults.buttonColors(containerColor=if(bot.str("status")=="running")Down else Blue),
                    shape=RoundedCornerShape(14.dp)){
                    Icon(if(bot.str("status")=="running") Icons.Default.StopCircle else Icons.Default.PlayArrow,
                        contentDescription=null,modifier=Modifier.size(20.dp))
                    Spacer(Modifier.width(7.dp))
                    Text(if(bot.str("status")=="running") "Stop bot" else "Request bot start",fontWeight=FontWeight.SemiBold)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("MT5 DEMO executions",fontSize=18.sp,fontWeight=FontWeight.Bold,color=textColor)
        Text("Only actual server-side broker receipts are shown. Previews and paper signals are not trades.",fontSize=11.sp,color=muted)
        if(executions.isEmpty()) EliteCard(panel) {
            Text("No broker-confirmed DEMO orders yet.",fontSize=13.sp,color=muted)
            Text("Check MetaApi, Elite Engine heartbeat and closed M1 candles. No execution is guaranteed.",fontSize=11.sp,color=muted)
        }
        else executions.take(10).forEach { receipt ->
            EliteCard(panel) {
                val status=receipt.str("status")
                val description=when(status){
                    "confirmed"->"Broker confirmed"
                    "unknown"->"UNKNOWN · reconcile in MT5"
                    "reserved"->"Pending confirmation"
                    else->"Cancelled"
                }
                Text(description,fontWeight=FontWeight.SemiBold,
                    color=if(status=="confirmed")Color(0xFF34D399) else muted)
                Text(receipt.str("symbol","—")+" · "+receipt.str("side","—").uppercase()+
                    " · "+receipt.str("volume","—")+" lots",fontSize=12.sp,color=muted)
                if(receipt.str("brokerOrderId").isNotBlank())
                    Text("Broker order #"+receipt.str("brokerOrderId"),fontSize=11.sp,color=muted)
                Text(receipt.str("createdAt",""),fontSize=10.sp,color=muted)
            }
        }
        OutlinedButton(onClick=onConnect,modifier=Modifier.fillMaxWidth().height(51.dp),shape=RoundedCornerShape(16.dp)) {
            Icon(Icons.Default.AddCircleOutline,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Connect another MT5 account")
        }
    }
}

@Composable
private fun AccountPage(user:JSONObject?,panel:Color,textColor:Color,muted:Color,light:Boolean,
    onNavigate:(String)->Unit,onTheme:()->Unit,onCheckUpdates:()->Unit,onSignOut:()->Unit) {
    PageScroll {
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            Box(Modifier.size(60.dp).clip(CircleShape).background(Blue.copy(alpha=.25f)),contentAlignment=Alignment.Center) {
                Text(user?.str("name","E")?.take(1)?.uppercase() ?: "E",color=Blue,fontSize=25.sp,fontWeight=FontWeight.Bold)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(user?.str("name","Trader") ?: "Trader",fontSize=21.sp,fontWeight=FontWeight.Bold,color=textColor)
                Text(user?.str("email") ?: "",fontSize=12.sp,color=muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                Spacer(Modifier.height(4.dp))
                StatusPill(if(user?.optBoolean("active")==true)"approved" else "pending")
            }
        }
        Spacer(Modifier.height(12.dp))
        SectionTitle("Payments & subscription")
        EliteCard(panel){
            AccountRow(Icons.Default.AccountBalanceWallet,"Subscription","Activate EliteBot or view your plan",onClick={onNavigate("Billing")})
            AccountRow(Icons.Default.Payments,"Payment methods","USDT instructions and verified wallet",onClick={onNavigate("Payment Methods")})
            AccountRow(Icons.Default.ReceiptLong,"Payment history","Invoices and verified transactions",onClick={onNavigate("Payment History")})
        }
        SectionTitle("Trading")
        EliteCard(panel){
            AccountRow(Icons.Default.AccountBalanceWallet,"MT5 accounts","Connections and broker status",onClick={onNavigate("MT5")})
            AccountRow(Icons.Default.AutoGraph,"ClaudeBot","Independent read-only trading signal analysis",onClick={onNavigate("ClaudeBot")})
            AccountRow(Icons.Default.AutoGraph,"Claude Pro Bot","Automatic signal analysis and MT5 demo controls",onClick={onNavigate("Claude Pro Bot")})
            AccountRow(Icons.Default.AutoGraph,"Gold SMC Scalper","Read-only XAUUSD liquidity and structure research",onClick={onNavigate("Gold SMC Scalper")})
            AccountRow(Icons.Default.Memory,"Elite Engine","Supervised Android demo worker",onClick={onNavigate("Elite Engine")})
            AccountRow(Icons.Default.Cable,"EliteBridge","Broker connections and future independent MT5 bridge",onClick={onNavigate("EliteBridge")})
            AccountRow(Icons.Default.History,"Activity","Subscription and recent records",onClick={onNavigate("Activity")})
        }
        SectionTitle("App updates & support")
        EliteCard(panel) {
            AccountRow(Icons.Default.SystemUpdate,"Check for updates",
                "Install new versions without deleting your signed app",onClick=onCheckUpdates)
        }
        SectionTitle("Preferences & support")
        EliteCard(panel){
            AccountRow(Icons.Default.Settings,"Settings","Appearance and device preferences",onClick={onNavigate("Settings")})
            AccountRow(Icons.Default.SupportAgent,"Support","Your private support inbox",onClick={onNavigate("Support")})
        }
        if(user?.str("role")=="admin") {
            SectionTitle("Administration")
            EliteCard(panel){AccountRow(Icons.Default.AdminPanelSettings,"Administrator","Authorized workspace",onClick={onNavigate("Admin")})}
        }
        OutlinedButton(onClick=onSignOut,modifier=Modifier.fillMaxWidth().height(53.dp),shape=RoundedCornerShape(15.dp),
            colors=ButtonDefaults.outlinedButtonColors(contentColor=Down)){
            Icon(Icons.Default.Logout,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Sign out")
        }
        Text("EliteTrade · Secure native Android experience",color=muted,fontSize=11.sp,modifier=Modifier.align(Alignment.CenterHorizontally))
    }
}
@Composable private fun AccountRow(icon:ImageVector,title:String,subtitle:String,onClick:()->Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min=58.dp).clip(RoundedCornerShape(12.dp))
        .clickable(onClick=onClick).padding(vertical=7.dp),verticalAlignment=Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(Blue.copy(alpha=.12f)),contentAlignment=Alignment.Center) {
            Icon(icon,contentDescription=null,tint=Blue,modifier=Modifier.size(19.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title,fontWeight=FontWeight.SemiBold,fontSize=14.sp)
            Text(subtitle,color=Muted,fontSize=11.sp)
        }
        Icon(Icons.Default.ChevronRight,contentDescription=null,tint=Muted,modifier=Modifier.size(19.dp))
    }
}
@Composable
private fun AccountsPage(accounts:List<JSONObject>,panel:Color,textColor:Color,muted:Color,onConnect:()->Unit) {
    PageScroll {
        Spacer(Modifier.height(8.dp))
        Text("MT5 connections",fontWeight=FontWeight.Bold,fontSize=23.sp,color=textColor)
        if(accounts.isEmpty())EliteCard(panel){EmptyLine("No accounts connected","Add your broker details for review and verification.")}
        accounts.forEach { a ->
            EliteCard(panel) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(a.str("broker","Broker"),fontSize=16.sp,fontWeight=FontWeight.Bold,color=textColor)
                        Text(a.str("login")+" · "+a.str("server"),fontSize=12.sp,color=muted)
                    }
                    StatusPill(a.str("status","pending"))
                }
                if(!a.isNull("note") && a.str("note").isNotBlank()) Text(a.str("note"),fontSize=12.sp,color=muted)
            }
        }
        Button(onClick=onConnect,modifier=Modifier.fillMaxWidth().height(50.dp),
            colors=ButtonDefaults.buttonColors(containerColor=Blue)) {Text("Connect MT5")}
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ConnectMt5Sheet(onDismiss:()->Unit,onSave:(String,String,String,String)->Unit) {
    var broker by remember {mutableStateOf("")}
    var login by remember {mutableStateOf("")}
    var server by remember {mutableStateOf("")}
    var password by remember {mutableStateOf("")}
    ModalBottomSheet(onDismissRequest=onDismiss,containerColor=Surface,contentColor=Ink) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
            .padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Connect MetaTrader 5",fontWeight=FontWeight.Bold,fontSize=22.sp)
            Text("Your credentials will be submitted securely for administrator and gateway review.",color=Muted,fontSize=12.sp)
            OutlinedTextField(value=broker,onValueChange={broker=it},label={Text("Broker")},modifier=Modifier.fillMaxWidth(),singleLine=true)
            OutlinedTextField(value=login,onValueChange={login=it.filter(Char::isDigit)},label={Text("MT5 login number")},
                modifier=Modifier.fillMaxWidth(),singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
            OutlinedTextField(value=server,onValueChange={server=it},label={Text("Exact broker server")},
                modifier=Modifier.fillMaxWidth(),singleLine=true)
            OutlinedTextField(value=password,onValueChange={password=it},label={Text("MT5 password")},modifier=Modifier.fillMaxWidth(),
                visualTransformation=PasswordVisualTransformation(),singleLine=true)
            Button(onClick={onSave(broker,login,server,password)},enabled=broker.length>=2&&login.isNotBlank()&&server.length>=2&&password.isNotBlank(),
                modifier=Modifier.fillMaxWidth().height(50.dp),colors=ButtonDefaults.buttonColors(containerColor=Blue)){
                Text("Save for verification")
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun ActivityPage(payments:JSONArray,panel:Color,textColor:Color,muted:Color) {
    PageScroll {
        Spacer(Modifier.height(8.dp))
        Text("Activity",fontSize=23.sp,fontWeight=FontWeight.Bold,color=textColor)
        val rows=payments.objects()
        if(rows.isEmpty()) EliteCard(panel){EmptyLine("No recent payment activity","Recorded subscription and payment events will appear here.")}
        rows.forEach {p->
            EliteCard(panel){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Column(Modifier.weight(1f)) {
                        Text(labelStatus(p.str("kind","Payment")),fontWeight=FontWeight.SemiBold)
                        Text(p.str("reference","—"),color=muted,fontSize=12.sp)
                    }
                    StatusPill(p.str("status","pending"))
                }
            }
        }
    }
}

@Composable
private fun SettingsPage(light:Boolean,panel:Color,textColor:Color,onTheme:()->Unit,
    onSupport:()->Unit,onCheckUpdates:()->Unit){
    PageScroll {
        Spacer(Modifier.height(8.dp))
        Text("Settings",color=textColor,fontSize=23.sp,fontWeight=FontWeight.Bold)
        EliteCard(panel) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Icon(Icons.Default.DarkMode,contentDescription=null,tint=Blue)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)){
                    Text("Light appearance",fontWeight=FontWeight.SemiBold)
                    Text("Choose your preferred workspace theme",fontSize=11.sp,color=Muted)
                }
                Switch(checked=light,onCheckedChange={onTheme()})
            }
            AccountRow(Icons.Default.SystemUpdate,"App updates","Check the official signed release",onClick=onCheckUpdates)
            AccountRow(Icons.Default.SupportAgent,"Help & support","Message the EliteTrade team",onClick=onSupport)
            AccountRow(Icons.Default.Language,"Language","English",onClick={})
        }
        Text("System notifications and security controls require verified native services.",fontSize=12.sp,color=Muted)
    }
}

@Composable
private fun SupportPage(data:JSONObject?,selectedId:String,thread:JSONObject?,panel:Color,textColor:Color,muted:Color,
    onOpen:(String)->Unit,onBack:()->Unit,onCreate:()->Unit,onSend:(String)->Unit,busy:Boolean) {
    var draft by remember(selectedId) {mutableStateOf("")}
    if(selectedId.isNotBlank()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically) {
                IconButton(onClick=onBack) {Icon(Icons.Default.ArrowBack,contentDescription="Back to conversations")}
                Column(Modifier.weight(1f)) {
                    Text("EliteTrade support",fontWeight=FontWeight.Bold,fontSize=16.sp)
                    Text("Private conversation",color=muted,fontSize=11.sp)
                }
                Icon(Icons.Default.Security,contentDescription=null,tint=Up,modifier=Modifier.size(19.dp))
            }
            HorizontalDivider(color=muted.copy(alpha=.12f))
            val msgs=thread?.optJSONArray("messages")?.objects().orEmpty()
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal=15.dp),
                verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(vertical=14.dp)) {
                if(msgs.isEmpty()) item {Text("Your conversation begins here. Never share passwords or MT5 secrets.",color=muted,fontSize=13.sp)}
                items(msgs) { m ->
                    val mine=m.str("sender")!="admin"
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=if(mine)Arrangement.End else Arrangement.Start) {
                        Surface(shape=RoundedCornerShape(17.dp),color=if(mine)Blue.copy(alpha=.22f) else panel,
                            modifier=Modifier.widthIn(max=300.dp)) {
                            Column(Modifier.padding(13.dp)) {
                                Text(m.str("body",""),color=textColor,fontSize=14.sp,lineHeight=20.sp)
                                Spacer(Modifier.height(4.dp))
                                Text(if(mine)"You" else "Support team",fontSize=10.sp,color=muted)
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().imePadding().padding(10.dp),verticalAlignment=Alignment.Bottom,
                horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(draft,{draft=it.take(20000)},modifier=Modifier.weight(1f),
                    placeholder={Text("Write a message...")},minLines=1,maxLines=5,shape=RoundedCornerShape(22.dp))
                IconButton(onClick={onSend(draft);draft=""},enabled=draft.isNotBlank()&&!busy,
                    modifier=Modifier.size(52.dp).clip(CircleShape).background(Blue)) {
                    Icon(Icons.Default.Send,contentDescription="Send message",tint=Color.White)
                }
            }
        }
    } else {
        PageScroll {
            Spacer(Modifier.height(8.dp))
            Text("Conversations",fontSize=23.sp,fontWeight=FontWeight.Bold,color=textColor)
            Text("Personal, secure account support.",color=muted,fontSize=13.sp)
            Button(onClick=onCreate,enabled=!busy,colors=ButtonDefaults.buttonColors(containerColor=Blue),
                modifier=Modifier.fillMaxWidth().height(50.dp)){
                Icon(Icons.Default.Add,contentDescription=null)
                Spacer(Modifier.width(8.dp))
                Text("New conversation")
            }
            val list=data?.optJSONArray("conversations")?.objects().orEmpty()
            if(list.isEmpty()) EliteCard(panel){EmptyLine("No conversations yet","Start a conversation whenever you need help with EliteTrade.")}
            list.forEach {chat ->
                Surface(color=panel,shape=RoundedCornerShape(18.dp),modifier=Modifier.fillMaxWidth().clickable{onOpen(chat.str("id"))}) {
                    Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically) {
                        Icon(Icons.Default.ChatBubbleOutline,contentDescription=null,tint=Blue,modifier=Modifier.size(24.dp))
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(chat.str("subject",chat.str("category","Support conversation")),fontWeight=FontWeight.SemiBold)
                            Text("Private support thread",color=muted,fontSize=11.sp)
                        }
                        StatusPill(chat.str("status","open"))
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminPage(data:JSONObject?,panel:Color,textColor:Color,muted:Color,onReview:(JSONObject,Boolean)->Unit) {
    PageScroll {
        Spacer(Modifier.height(8.dp))
        Text("Administration",color=textColor,fontSize=24.sp,fontWeight=FontWeight.Bold)
        Text("Authorized operations · Server-verified data",color=muted,fontSize=12.sp)
        if(data==null) EliteCard(panel) {EmptyLine("Loading administrator data","Only verified administrators can see this workspace.")}
        else {
            val users=data.optJSONArray("users")?.objects().orEmpty()
            val payments=data.optJSONArray("payments")?.objects().orEmpty()
            val accounts=data.optJSONArray("accounts")?.objects().orEmpty()
            EliteCard(panel) {
                Row(Modifier.fillMaxWidth()){
                    Metric("Customers",users.size.toString(),Modifier.weight(1f))
                    Metric("Payment reviews",payments.count{it.str("status")=="pending"}.toString(),Modifier.weight(1f))
                    Metric("MT5 reviews",accounts.count{it.str("status")=="pending"}.toString(),Modifier.weight(1f))
                }
            }
            SectionTitle("Payments & billing")
            EliteCard(panel) {
                val pending=payments.filter{it.str("status")=="pending"}
                Row(Modifier.fillMaxWidth()){
                    Metric("Payments",payments.size.toString(),Modifier.weight(1f))
                    Metric("Awaiting review",pending.size.toString(),Modifier.weight(1f))
                }
                Text("Blockchain verification: " + if(data.optJSONObject("crypto")?.optBoolean("ready")==true)"Available" else "Unavailable",
                    fontSize=12.sp,color=muted)
            }
            val methods=data.optJSONArray("methods")?.objects().orEmpty()
            methods.forEach { method ->
                EliteCard(panel) {
                    Text(method.str("name","Payment method"),fontWeight=FontWeight.Bold)
                    Text(method.str("network",""),fontSize=12.sp,color=muted)
                    Text(if(method.optBoolean("enabled"))"Enabled" else "Disabled",fontSize=12.sp,color=muted)
                }
            }
            payments.filter{it.str("status")=="pending"}.take(12).forEach { payment ->
                EliteCard(panel) {
                    Text(payment.str("email","Customer"),fontWeight=FontWeight.SemiBold,fontSize=13.sp)
                    Text(payment.str("reference"),fontSize=12.sp,color=muted)
                    Text("Review only against verified payment evidence",fontSize=11.sp,color=muted)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        OutlinedButton(onClick={onReview(payment,false)},modifier=Modifier.weight(1f)){Text("Reject")}
                        Button(onClick={onReview(payment,true)},modifier=Modifier.weight(1f)){Text("Approve")}
                    }
                }
            }
            SectionTitle("Recent members")
            users.take(12).forEach {user->
                EliteCard(panel) {
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(user.str("name","Member"),fontWeight=FontWeight.SemiBold,maxLines=1)
                            Text(user.str("email"),color=muted,fontSize=12.sp,maxLines=1)
                        }
                        StatusPill(if(user.optBoolean("active")) "approved" else "pending")
                    }
                }
            }
            Text("Administrative changes remain subject to existing server authorization and review controls.",fontSize=11.sp,color=muted)
        }
    }
}
