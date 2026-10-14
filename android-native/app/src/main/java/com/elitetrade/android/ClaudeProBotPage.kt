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
                               privat¶»§q«^