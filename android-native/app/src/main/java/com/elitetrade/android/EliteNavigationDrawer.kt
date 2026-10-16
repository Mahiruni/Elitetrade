package com.elitetrade.android

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

// Navigation destinations map exclusively to existing NativeActivity screens.
// Admin visibility is presentation-only: backend authorization remains mandatory.
private data class DrawerDestination(val title:String,val screen:String,val icon:ImageVector)
private val overviewDestinations = listOf(
    DrawerDestination("Home","Home",Icons.Default.Home),
    DrawerDestination("Markets","Markets",Icons.Default.TrendingUp),
    DrawerDestination("Trade","Trade",Icons.Default.ShowChart),
    DrawerDestination("Activity","Activity",Icons.Default.History)
)
private val botDestinations = listOf(
    DrawerDestination("EliteBot","Bot",Icons.Default.SmartToy),
    DrawerDestination("EliteEnginePro","Elite Engine",Icons.Default.Memory),
    DrawerDestination("EliteBridge","EliteBridge",Icons.Default.Cable),
    DrawerDestination("ClaudeBot","ClaudeBot",Icons.Default.AutoGraph),
    DrawerDestination("Claude Pro Bot","Claude Pro Bot",Icons.Default.Psychology),
    DrawerDestination("Gold SMC Scalper","Gold SMC Scalper",Icons.Default.ShowChart)
)
private val billingDestinations = listOf(
    DrawerDestination("Subscription","Billing",Icons.Default.WorkspacePremium),
    DrawerDestination("Payment Methods","Payment Methods",Icons.Default.Payments),
    DrawerDestination("Payment History","Payment History",Icons.Default.ReceiptLong)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EliteTradeNavigationDrawer(
    user:JSONObject?,
    selected:String,
    light:Boolean,
    onClose:()->Unit,
    onNavigate:(String)->Unit,
    onSignOut:()->Unit
) {
    val ink=if(light) Color(0xFF142238) else Color.White
    val muted=if(light) Color(0xFF617188) else Color(0xFF9CA3AF)
    val surface=if(light) Color.White else Color(0xFF0A0A0A)
    val line=if(light) Color(0xFFE5EAF1) else Color(0xFF272727)
    val blue=if(light) Color(0xFF295FC3) else Color(0xFF528BF9)
    val activeAccess=user?.optBoolean("active")==true || user?.optString("role")=="admin"
    val isAdmin=user?.optString("role")=="admin"
    var botsExpanded by rememberSaveable { mutableStateOf(selected in botDestinations.map { it.screen }) }
    var billingExpanded by rememberSaveable { mutableStateOf(selected in billingDestinations.map { it.screen }) }
    LaunchedEffect(selected) {
        if(selected in botDestinations.map { it.screen }) botsExpanded=true
        if(selected in billingDestinations.map { it.screen }) billingExpanded=true
    }
    ModalDrawerSheet(
        modifier=Modifier.fillMaxWidth(0.87f).widthIn(max=320.dp).fillMaxHeight(),
        drawerShape=RoundedCornerShape(topEnd=26.dp,bottomEnd=26.dp),
        drawerContainerColor=surface,
        drawerContentColor=ink,
        drawerTonalElevation=0.dp,
        windowInsets=WindowInsets(0,0,0,0)
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start=18.dp,end=10.dp,top=18.dp,bottom=8.dp),
                verticalAlignment=Alignment.CenterVertically) {
                Box(Modifier.size(43.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFF111318)),
                    contentAlignment=Alignment.Center) {
                    Text("EB",fontSize=17.sp,fontWeight=FontWeight.Black,color=Color(0xFFD8B16A))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("EliteTrade",fontWeight=FontWeight.ExtraBold,fontSize=18.sp,color=ink)
                    Text("YOUR TRADING WORKSPACE",fontSize=9.sp,letterSpacing=1.15.sp,color=muted)
                }
                IconButton(onClick=onClose,modifier=Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close,contentDescription="Close navigation drawer",tint=ink)
                }
            }
            Surface(color=if(light)Color(0xFFF5F7FA) else Color(0xFF141414),
                shape=RoundedCornerShape(16.dp),
                modifier=Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=10.dp)) {
                Row(Modifier.padding(13.dp),verticalAlignment=Alignment.CenterVertically) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(blue.copy(alpha=.14f)),
                        contentAlignment=Alignment.Center) {
                        Text((user?.optString("name").orEmpty().ifBlank { "T" }).take(1).uppercase(),
                            fontWeight=FontWeight.Bold,color=blue,fontSize=17.sp)
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(user?.optString("name").orEmpty().ifBlank { "Trader" },
                            fontWeight=FontWeight.SemiBold,fontSize=14.sp,color=ink,
                            maxLines=1,overflow=TextOverflow.Ellipsis)
                        Text(user?.optString("email").orEmpty(),fontSize=11.sp,color=muted,
                            maxLines=1,overflow=TextOverflow.Ellipsis)
                        Spacer(Modifier.height(5.dp))
                        Row(verticalAlignment=Alignment.CenterVertically) {
                            Box(Modifier.size(6.dp).clip(CircleShape)
                                .background(if(activeAccess)Color(0xFF21B68D) else Color(0xFFD8B16A)))
                            Spacer(Modifier.width(6.dp))
                            Text(if(activeAccess)"Access active" else "Subscription inactive",
                                fontSize=10.sp,color=muted)
                        }
                    }
                }
            }
            HorizontalDivider(color=line,modifier=Modifier.padding(horizontal=17.dp))
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
                .padding(start=13.dp,end=13.dp,top=13.dp,bottom=8.dp),
                verticalArrangement=Arrangement.spacedBy(2.dp)) {
                DrawerSection("OVERVIEW",muted)
                overviewDestinations.forEach {
                    DrawerNavigationItem(it,selected,ink,muted,blue,onNavigate)
                }
                Spacer(Modifier.height(12.dp))
                DrawerExpandableGroup(
                    title="BOTS & STRATEGIES",icon=Icons.Default.SmartToy,expanded=botsExpanded,
                    selected=selected in botDestinations.map { it.screen },
                    ink=ink,muted=muted,blue=blue,onToggle={botsExpanded=!botsExpanded}
                ) {
                    botDestinations.forEach {
                        DrawerNavigationItem(it,selected,ink,muted,blue,onNavigate,nested=true)
                    }
                }
                Spacer(Modifier.height(10.dp))
                DrawerSection("BROKER",muted)
                DrawerNavigationItem(DrawerDestination("MT5 Accounts","MT5",Icons.Default.AccountBalanceWallet),
                    selected,ink,muted,blue,onNavigate)
                Spacer(Modifier.height(8.dp))
                DrawerExpandableGroup(
                    title="BILLING & PAYMENTS",icon=Icons.Default.ReceiptLong,expanded=billingExpanded,
                    selected=selected in billingDestinations.map { it.screen },
                    ink=ink,muted=muted,blue=blue,onToggle={billingExpanded=!billingExpanded}
                ) {
                    billingDestinations.forEach {
                        DrawerNavigationItem(it,selected,ink,muted,blue,onNavigate,nested=true)
                    }
                }
                Spacer(Modifier.height(10.dp))
                DrawerSection("ACCOUNT & HELP",muted)
                DrawerNavigationItem(DrawerDestination("Settings","Settings",Icons.Default.Settings),
                    selected,ink,muted,blue,onNavigate)
                DrawerNavigationItem(DrawerDestination("Support","Support",Icons.Default.SupportAgent),
                    selected,ink,muted,blue,onNavigate)
                if(isAdmin) {
                    Spacer(Modifier.height(12.dp))
                    DrawerSection("ADMINISTRATION",muted)
                    DrawerNavigationItem(DrawerDestination("Administration","Admin",Icons.Default.AdminPanelSettings),
                        selected,ink,muted,blue,onNavigate)
                }
                Spacer(Modifier.height(12.dp))
            }
            // The account actions stay visible even when the groups overflow.
            HorizontalDivider(color=line)
            Column(Modifier.fillMaxWidth().padding(horizontal=13.dp,vertical=9.dp),
                verticalArrangement=Arrangement.spacedBy(3.dp)) {
                DrawerNavigationItem(DrawerDestination("My Account","Account",Icons.Default.PersonOutline),
                    selected,ink,muted,blue,onNavigate)
                Row(Modifier.fillMaxWidth().heightIn(min=50.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .clickable(onClick=onSignOut).padding(horizontal=13.dp),
                    verticalAlignment=Alignment.CenterVertically) {
                    Icon(Icons.Default.Logout,contentDescription=null,tint=Color(0xFFE76972),
                        modifier=Modifier.size(21.dp))
                    Spacer(Modifier.width(14.dp))
                    Text("Sign Out",fontSize=14.sp,fontWeight=FontWeight.SemiBold,
                        color=if(light)Color(0xFFC02B3A) else Color(0xFFF38B92))
                }
            }
        }
    }
}

@Composable
private fun DrawerSection(title:String,muted:Color) {
    Text(title,modifier=Modifier.padding(start=14.dp,top=5.dp,bottom=7.dp),
        fontWeight=FontWeight.Bold,fontSize=10.sp,letterSpacing=1.15.sp,color=muted)
}

@Composable
private fun DrawerNavigationItem(
    destination:DrawerDestination,
    selected:String,
    ink:Color,
    muted:Color,
    blue:Color,
    onNavigate:(String)->Unit,
    nested:Boolean=false
) {
    val active=destination.screen==selected
    Row(Modifier.fillMaxWidth().heightIn(min=50.dp)
        .clip(RoundedCornerShape(13.dp))
        .background(if(active)blue.copy(alpha=.13f) else Color.Transparent)
        .clickable {onNavigate(destination.screen)}
        .padding(start=if(nested)21.dp else 13.dp,end=12.dp),
        verticalAlignment=Alignment.CenterVertically) {
        Icon(destination.icon,contentDescription=null,
            tint=if(active)blue else muted,modifier=Modifier.size(21.dp))
        Spacer(Modifier.width(13.dp))
        Text(destination.title,modifier=Modifier.weight(1f),
            color=if(active)blue else ink,fontSize=14.sp,
            fontWeight=if(active)FontWeight.Bold else FontWeight.Medium,
            maxLines=1,overflow=TextOverflow.Ellipsis)
        if(active) Box(Modifier.size(6.dp).clip(CircleShape).background(blue))
    }
}

@Composable
private fun DrawerExpandableGroup(
    title:String,
    icon:ImageVector,
    expanded:Boolean,
    selected:Boolean,
    ink:Color,
    muted:Color,
    blue:Color,
    onToggle:()->Unit,
    content:@Composable ()->Unit
) {
    val rotation by animateFloatAsState(if(expanded)180f else 0f,
        animationSpec=tween(190),label="Expand navigation group")
    Row(Modifier.fillMaxWidth().heightIn(min=51.dp)
        .clip(RoundedCornerShape(13.dp))
        .background(if(selected)blue.copy(alpha=.08f) else Color.Transparent)
        .clickable(onClick=onToggle)
        .semantics { stateDescription=if(expanded)"Expanded" else "Collapsed" }
        .padding(horizontal=13.dp),verticalAlignment=Alignment.CenterVertically) {
        Icon(icon,contentDescription=null,tint=if(selected)blue else ink,
            modifier=Modifier.size(21.dp))
        Spacer(Modifier.width(13.dp))
        Text(title,modifier=Modifier.weight(1f),fontSize=12.sp,
            fontWeight=FontWeight.SemiBold,color=if(selected)blue else ink,
            letterSpacing=.15.sp,maxLines=1)
        Icon(Icons.Default.KeyboardArrowDown,contentDescription=null,tint=muted,
            modifier=Modifier.size(19.dp).rotate(rotation))
    }
    AnimatedVisibility(visible=expanded) {
        Column(Modifier.fillMaxWidth().padding(top=3.dp,bottom=5.dp),
            verticalArrangement=Arrangement.spacedBy(1.dp)) {content()}
    }
}
