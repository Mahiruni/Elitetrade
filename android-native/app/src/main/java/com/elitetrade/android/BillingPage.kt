package com.elitetrade.android

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val billingBlue = Color(0xFF528BF9)
private val billingGold = Color(0xFFD8B16A)
private val billingMuted = Color(0xFF9EADC3)
private val billingWarn = Color(0xFFFFB76B)
private fun JSONObject.label(key: String, fallback: String = "") = optString(key, fallback).ifBlank { fallback }
private fun dollars(cents: Long): String = "$" + String.format(Locale.US, "%,.2f", cents / 100.0)
private fun formatDate(raw: Any?): String {
    val n = when (raw) { is Number -> raw.toLong(); is String -> raw.toLongOrNull() ?: 0L; else -> 0L }
    if (n <= 0) return "—"
    return SimpleDateFormat("dd MMM yyyy · HH:mm", Locale.US).format(Date(n))
}
private fun billingQr(address: String): Bitmap? = try {
    if (address.isBlank()) null else {
        val pixels = QRCodeWriter().encode(address, BarcodeFormat.QR_CODE, 260, 260, mapOf(EncodeHintType.MARGIN to 2))
        Bitmap.createBitmap(pixels.width, pixels.height, Bitmap.Config.ARGB_8888).also { bitmap ->
            for (y in 0 until pixels.height) for (x in 0 until pixels.width) {
                bitmap.setPixel(x, y, if (pixels[x,y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
    }
} catch (_: Exception) { null }

@Composable
private fun BillingPanel(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        tonalElevation = 2.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}
@Composable
private fun BillingButton(label: String, enabled: Boolean = true, primary: Boolean = true, action: () -> Unit) {
    if (primary) Button(
        onClick=action, enabled=enabled,
        modifier=Modifier.fillMaxWidth().heightIn(min=52.dp),
        shape=RoundedCornerShape(14.dp),
        colors=ButtonDefaults.buttonColors(containerColor=billingBlue,contentColor=Color.White)
    ){Text(label,fontWeight=FontWeight.SemiBold)}
    else OutlinedButton(
        onClick=action, enabled=enabled, modifier=Modifier.fillMaxWidth().heightIn(min=50.dp),
        shape=RoundedCornerShape(14.dp)
    ){Text(label,fontWeight=FontWeight.Medium)}
}
@Composable
private fun BillingTag(label: String, positive: Boolean = false) {
    Surface(shape=RoundedCornerShape(20.dp),color=(if(positive) Color(0xFF0F7F64) else billingBlue).copy(alpha=.16f)){
        Text(label,color=if(positive)Color(0xFF36D4A4) else billingBlue,
            fontSize=12.sp,fontWeight=FontWeight.Bold,modifier=Modifier.padding(horizontal=11.dp,vertical=6.dp))
    }
}

/** Production-driven checkout: no mocked amounts, transaction hashes or wallet addresses. */
@Composable
internal fun EliteBillingPage(
    section: String,
    methodsData: JSONObject?,
    invoiceData: JSONObject?,
    payments: JSONArray,
    active: Boolean,
    busy: Boolean,
    error: String,
    onNavigate: (String) -> Unit,
    onCreateInvoice: (String) -> Unit,
    onRefresh: () -> Unit,
    onSupport: () -> Unit
) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val methods = remember(methodsData) {
        methodsData?.optJSONArray("methods")?.let { a -> (0 until a.length()).mapNotNull(a::optJSONObject) } ?: emptyList()
    }
    val invoices = remember(invoiceData) {
        invoiceData?.optJSONArray("invoices")?.let { a -> (0 until a.length()).mapNotNull(a::optJSONObject) } ?: emptyList()
    }
    val now = System.currentTimeMillis()
    val pending = invoices.firstOrNull { it.label("status")=="pending" && it.optLong("expires_at",0)>now }
    val latest = pending ?: invoices.firstOrNull()
    val automatic = methods.firstOrNull { it.optBoolean("automatic") && it.label("network").equals("TRC20",true) }
    val planPrice = methodsData?.optLong("priceCents",0) ?: 0L
    val healthReady = invoiceData?.optJSONObject("crypto")?.optBoolean("ready") == true
    val colorText = MaterialTheme.colorScheme.onBackground
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val screen = when(section) {
        "Payment Methods" -> "Payment methods"
        "Payment History" -> "Payment history"
        else -> "Payments & subscription"
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=17.dp,vertical=14.dp),
        verticalArrangement=Arrangement.spacedBy(16.dp)
    ) {
        Text(screen,fontSize=25.sp,fontWeight=FontWeight.Bold,color=colorText)
        Text("Clear, secure payment and billing for EliteBot.",fontSize=13.sp,color=muted)
        if (error.isNotBlank()) BillingPanel { Text(error,color=MaterialTheme.colorScheme.error,fontSize=13.sp) }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(),color=billingGold)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){
            listOf("Billing","Payment Methods","Payment History").forEach { page ->
                FilterChip(
                    selected=(if(section=="Billing")"Billing" else section)==page,
                    onClick={onNavigate(page)},
                    label={Text(if(page=="Payment Methods")"Methods" else if(page=="Payment History")"History" else "Plan",fontSize=12.sp)}
                )
            }
        }
        when(section) {
            "Payment History" -> {
                if(methodsData==null) Text("Loading billing records…",color=muted)
                val rows = (0 until payments.length()).mapNotNull(payments::optJSONObject)
                if(rows.isEmpty() && invoices.isEmpty()) BillingPanel {
                    Text("No payments yet",fontWeight=FontWeight.Bold)
                    Text("Your real invoices and reviewed transactions will appear here.",color=muted,fontSize=13.sp)
                }
                invoices.forEach { invoice ->
                    BillingPanel {
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                            Text("USDT invoice",fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
                            BillingTag(invoice.label("status","unknown"),invoice.label("status") in listOf("confirmed","paid","approved"))
                        }
                        Text(invoice.label("amount","—") + " USDT · TRC20",fontSize=16.sp,fontWeight=FontWeight.Bold)
                        Text("Issued " + formatDate(invoice.opt("created_at")),fontSize=12.sp,color=muted)
                        val tx = invoice.label("txid")
                        if(tx.matches(Regex("[0-9a-fA-F]{64}"))) {
                            TextButton(onClick={
                                context.startActivity(Intent(Intent.ACTION_VIEW,
                                    Uri.parse("https://tronscan.org/#/transaction/" + tx)))
                            }) {Text("View verified transaction ↗")}
                        }
                    }
                }
                rows.forEach { p ->
                    BillingPanel {
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                            Text(p.label("kind","Payment").replaceFirstChar{it.uppercase()},fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
                            BillingTag(p.label("status","pending"),p.label("status")=="approved")
                        }
                        Text(dollars(p.optLong("amount_cents")),fontSize=18.sp,fontWeight=FontWeight.SemiBold)
                        Text(formatDate(p.opt("created_at")),color=muted,fontSize=12.sp)
                        SelectionContainer { Text("Reference: "+p.label("reference","—"),fontSize=12.sp,color=muted) }
                        if(p.label("note").isNotBlank()) Text(p.label("note"),fontSize=12.sp,color=muted)
                    }
                }
            }
            "Payment Methods" -> {
                if(methods.isEmpty()) BillingPanel { Text("No enabled payment method",fontWeight=FontWeight.Bold);Text("Contact support for current payment availability.",color=muted,fontSize=13.sp) }
                methods.forEach { method ->
                    BillingPanel {
                        Row(verticalAlignment=Alignment.CenterVertically){
                            Icon(Icons.Default.AccountBalanceWallet,contentDescription=null,tint=billingGold)
                            Spacer(Modifier.width(10.dp))
                            Text(method.label("name","Payment method"),fontWeight=FontWeight.Bold,fontSize=17.sp)
                        }
                        Text("Network: " + method.label("network","See instructions"),fontSize=13.sp,color=muted)
                        SelectionContainer { Text(method.label("details"),fontFamily=FontFamily.Monospace,fontSize=13.sp,lineHeight=21.sp) }
                        BillingButton("Copy payment details",primary=false){clipboard.setText(AnnotatedString(method.label("details")))}
                        Text(method.label("instructions"),color=muted,fontSize=12.sp)
                        if(method.label("network").equals("TRC20",true)) {
                            Text("Send USDT using the TRON (TRC20) network only. Sending assets through another network may result in permanent loss.",
                                color=billingWarn,fontSize=12.sp,fontWeight=FontWeight.SemiBold)
                        }
                        if(method.optBoolean("automatic") && !active) BillingButton("Activate EliteBot · Create invoice"){onNavigate("Billing")}
                    }
                }
            }
            else -> {
                BillingPanel {
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("ELITEBOT · LIFETIME",fontWeight=FontWeight.Bold,letterSpacing=1.sp,color=billingGold,fontSize=11.sp)
                            Text(if(active)"Subscription active" else "Activate your EliteBot",fontSize=20.sp,fontWeight=FontWeight.Bold)
                        }
                        BillingTag(if(active)"Active" else "Not activated",active)
                    }
                    if(planPrice>0L) Text(dollars(planPrice),fontSize=32.sp,fontWeight=FontWeight.Bold)
                    else Text("Fetching current price…",color=muted)
                    Text("One-time access payment. MT5 account management and EliteBot trading controls require activation.",
                        color=muted,fontSize=13.sp)
                    if(active) BillingButton("View payment history",primary=false){onNavigate("Payment History")}
                    else BillingButton("View payment methods",primary=false){onNavigate("Payment Methods")}
                    Text("The trading strategy ebook is a separate product and is not included in this payment.",
                        fontSize=12.sp,color=muted)
                }
                if(!active){
                    BillingPanel {
                        Text("Pay with USDT · TRC20",fontSize=18.sp,fontWeight=FontWeight.Bold)
                        if(automatic==null) {
                            Text("Automatic USDT checkout is not available. Review enabled payment methods or contact support.",color=muted,fontSize=13.sp)
                            BillingButton("Payment methods",primary=false){onNavigate("Payment Methods")}
                        } else if(pending!=null) {
                            Text("Invoice amount · send exactly",fontSize=12.sp,color=muted)
                            Text(pending.label("amount","—") + " USDT",fontSize=28.sp,fontWeight=FontWeight.Bold)
                            Text("Exact amount identifies your invoice. Network fees must be paid separately.",color=muted,fontSize=12.sp)
                            BillingButton("Copy exact amount",primary=false){
                                clipboard.setText(AnnotatedString(pending.label("amount")))
                            }
                            Text("Receiving wallet · TRON (TRC20)",fontSize=12.sp,color=muted)
                            SelectionContainer{
                                Text(pending.label("destination"),fontSize=13.sp,fontFamily=FontFamily.Monospace,lineHeight=21.sp)
                            }
                            BillingButton("Copy wallet address",primary=false){
                                clipboard.setText(AnnotatedString(pending.label("destination")))
                            }
                            val address=pending.label("destination")
                            val bitmap = remember(address) { billingQr(address) }
                            if(bitmap!=null) {
                                Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){
                                    Image(bitmap=bitmap.asImageBitmap(), contentDescription="QR code for the invoice wallet address",
                                        modifier=Modifier.size(220.dp).clip(RoundedCornerShape(14.dp)))
                                }
                            }
                            Text("TRC20 only · Do not use Ethereum or another network.",color=billingWarn,
                                fontSize=12.sp,fontWeight=FontWeight.Bold)
                            Text("Invoice expires: " + formatDate(pending.opt("expires_at")),fontSize=12.sp,color=muted)
                            Text(if(healthReady) "Awaiting blockchain verification. This screen refreshes when you return."
                                 else "Blockchain verification is temporarily unavailable. Keep your invoice and contact support before paying again.",
                                color=muted,fontSize=13.sp)
                            BillingButton("I've sent payment · Check status",primary=false,action=onRefresh)
                        } else {
                            if(latest!=null) Text("Your previous invoice is " + latest.label("status","closed") +
                                ". If you paid already, contact support before creating another.",
                                color=billingWarn,fontSize=12.sp)
                            Text("Create an invoice to obtain the exact payment amount. Activation occurs only after genuine blockchain confirmation.",
                                color=muted,fontSize=13.sp)
                            BillingButton(
                                "Create USDT payment invoice",
                                enabled=!busy && healthReady && planPrice>0L,
                                action={onCreateInvoice(automatic.label("id"))}
                            )
                            if(!healthReady) Text("Automatic verification is not available. Please contact support.",color=billingWarn,fontSize=12.sp)
                        }
                    }
                }
                BillingButton("Payment history",primary=false){onNavigate("Payment History")}
            }
        }
        BillingButton("Refresh payment status",primary=false,enabled=!busy,action=onRefresh)
        TextButton(onClick=onSupport,modifier=Modifier.align(Alignment.CenterHorizontally)){
            Icon(Icons.Default.SupportAgent,contentDescription=null)
            Spacer(Modifier.width(8.dp))
            Text("Contact payment support")
        }
        Spacer(Modifier.height(16.dp))
    }
}
