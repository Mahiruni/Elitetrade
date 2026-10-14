package com.elitetrade.android

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Only reviewed, bundled assets enter this WebView. Bearer tokens never enter JavaScript. */
@Composable
fun ClaudeProBotPage(api: EliteApi, onNavigate: (String) -> Unit) {
    AndroidView(
        modifier=Modifier.fillMaxSize(),
        factory={ context -> TrustedClaudeView(context,api,onNavigate) },
        onRelease={ view -> view.release() }
    )
}

@SuppressLint("SetJavaScriptEnabled")
private class TrustedClaudeView(context: Context, private val api: EliteApi,
                               private val onNavigate: (String) -> Unit): WebView(context) {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
    private val assetHost="appassets.androidplatform.net"
    private val index="https://$assetHost/claude-pro/index.html"
    private val owner=context as? LifecycleOwner
    private val observer=LifecycleEventObserver { _, event ->
        if(event==Lifecycle.Event.ON_STOP) {
            evaluateJavascript("window.dispatchEvent(new Event('claude-pro-paused'));",null)
            onPause()
        } else if(event==Lifecycle.Event.ON_START) onResume()
    }
    private val files=mapOf(
        "/claude-pro/index.html" to Pair("index.html","text/html"),
        "/claude-pro/claude-pro-bot.js" to Pair("claude-pro-bot.js","text/javascript"),
        "/claude-pro/claude-pro-bot.css" to Pair("claude-pro-bot.css","text/css"),
        "/fonts/inter-latin.woff2" to Pair("inter-latin.woff2","font/woff2"),
        "/fonts/dm-sans.woff" to Pair("dm-sans.woff","font/woff"),
        "/fonts/instrument-serif.woff" to Pair("instrument-serif.woff","font/woff")
    )
    init {
        setBackgroundColor(android.graphics.Color.rgb(13,15,18))
        settings.javaScriptEnabled=true
        settings.domStorageEnabled=true
        settings.allowFileAccess=false
        settings.allowContentAccess=false
        settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.javaScriptCanOpenWindowsAutomatically=false
        addJavascriptInterface(Bridge(),"ClaudeProNative")
        webViewClient=object:WebViewClient() {
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
                val resource=if(request.url.scheme=="https" && request.url.host==assetHost && request.method=="GET")files[request.url.path] else null
                if(resource==null)return WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),ByteArrayInputStream(ByteArray(0)))
                val headers=mapOf(
                    "Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
                    "X-Content-Type-Options" to "nosniff"
                )
                return try {
                    WebResourceResponse(resource.second,if(resource.second.startsWith("font/"))null else "UTF-8",200,"OK",headers,context.assets.open("claude-pro/"+resource.first))
                } catch(_:Exception) {
                    WebResourceResponse("text/plain","UTF-8",404,"Missing asset",emptyMap(),ByteArrayInputStream(ByteArray(0)))
                }
            }
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                if(request.url.toString()==index)return false
                if(!request.isForMainFrame)return true
                if(request.url.scheme=="https" && request.url.host==assetHost) {
                    val destination=mapOf("/trade" to "Trade","/mt5" to "MT5","/bots" to "Bot","/settings" to "Settings")[request.url.path]
                    if(destination!=null)post{onNavigate(destination)}
                }
                return true
            }
        }
        owner?.lifecycle?.addObserver(observer)
        loadUrl(index)
    }
    private inner class Bridge {
        @JavascriptInterface
        fun bootstrap():String=api.claudeProBootstrap()

        @JavascriptInterface
        fun openBroker() { post {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://pocketoption.com/en/"))) }
        } }

        @JavascriptInterface
        fun request(id:String,path:String,method:String,body:String) {
            if(!id.matches(Regex("[0-9]{1,9}")) || path.length>160 || body.length>2000)return
            scope.launch {
                val response=try {
                    val data=when {
                        path=="/accounts" && method=="GET" -> JSONObject().put("accounts",api.accounts())
                        path=="/bots" && method=="GET" -> api.claudeProBots()
                        method=="POST" && path.matches(Regex("/bots/[A-Za-z0-9_-]{1,100}/preview")) -> api.previewBot(path.split('/')[2])
                        method=="POST" && path.matches(Regex("/bots/[A-Za-z0-9_-]{1,100}/control")) -> {
                            if(JSONObject(api.claudeProBootstrap()).optJSONObject("config")?.optString("connectionMode")!="account-data")throw ApiProblem("Only the existing demo worker can be controlled here.")
                            val running=JSONObject(body).opt("running") as? Boolean ?: throw ApiProblem("Choose start or stop.")
                            api.controlBot(path.split('/')[2],running)
                        }
                        else -> throw ApiProblem("This native request is not allowed.")
                    }
                    JSONObject().put("data",data)
                } catch(error:Exception) {
                    if(error is CancellationException)throw error
                    JSONObject().put("error",error.message ?: "Native request failed.")
                }
                evaluateJavascript("window.__claudeNativeReply?.("+JSONObject.quote(id)+","+JSONObject.quote(response.toString())+");",null)
            }
        }
    }
    fun release() {
        owner?.lifecycle?.removeObserver(observer)
        scope.cancel()
        removeJavascriptInterface("ClaudeProNative")
        stopLoading()
        destroy()
    }
}
