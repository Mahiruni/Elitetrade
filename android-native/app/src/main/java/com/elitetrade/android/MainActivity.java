package com.elitetrade.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.graphics.Insets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.SslError;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Hardened native Android host for the existing HTTPS EliteTrade application.
 * The trading engine, credentials, authentication and authorization remain server-side.
 * Does not fabricate offline balances or execute trades on the phone.
 */
public final class MainActivity extends Activity {
    private static final int REQUEST_FILE = 2149;
    private static final int BACKGROUND = Color.rgb(16, 24, 34);
    private WebView web;
    private LinearLayout connectionError;
    private ValueCallback<Uri[]> fileCallback;
    private String allowedHost;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Uri origin = Uri.parse(BuildConfig.WEB_ORIGIN);
        if (!"https".equals(origin.getScheme()) || origin.getHost() == null) {
            throw new IllegalStateException("Android builds require a configured HTTPS EliteTrade origin");
        }
        allowedHost = origin.getHost();

        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        getWindow().getDecorView().setSystemUiVisibility(0); // white system clock/battery on dark protection

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            // Android 15/16 enforce edge-to-edge; protect status, cutout, gesture, and IME regions.
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets safe = windowInsets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                Insets keyboard = windowInsets.getInsets(WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        } else {
            root.setFitsSystemWindows(true);
        }

        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android system content picker
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (!req.isForMainFrame()) return false;
                Uri url = req.getUrl();
                if (isTrusted(url)) return false;
                if (isExternalSafe(url)) launchExternal(url);
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (isTrusted(Uri.parse(url))) connectionError.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) connectionError.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); // never bypass TLS/certificate problems for a financial application
                connectionError.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                         FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent picker = params.createIntent();
                    picker.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(picker, REQUEST_FILE);
                    return true;
                } catch (ActivityNotFoundException exception) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No file picker installed", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            Uri uri = Uri.parse(url);
            if (isTrusted(uri) || isExternalSafe(uri)) launchExternal(uri);
        });
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        connectionError = buildConnectionError();
        root.addView(connectionError, new FrameLayout.LayoutParams(-1,-1));
        connectionError.setVisibility(View.GONE);
        setContentView(root);
        web.loadUrl(BuildConfig.WEB_ORIGIN + "/");
    }

    private boolean isTrusted(Uri url) {
        int port = url.getPort();
        return "https".equalsIgnoreCase(url.getScheme())
                && allowedHost.equalsIgnoreCase(url.getHost())
                && (port == -1 || port == 443);
    }

    private boolean isExternalSafe(Uri url) {
        String scheme = url.getScheme();
        return "https".equalsIgnoreCase(scheme) ||
                "mailto".equalsIgnoreCase(scheme) ||
                "tel".equalsIgnoreCase(scheme);
    }

    private void launchExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private LinearLayout buildConnectionError() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        page.setPadding(dp(26), dp(22), dp(26), dp(22));
        page.setBackgroundColor(BACKGROUND);
        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(23);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(null, 1);
        page.addView(title);
        TextView description = new TextView(this);
        description.setText(R.string.offline_message);
        description.setTextColor(Color.rgb(173, 186, 204));
        description.setTextSize(15);
        description.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams descParams = new LinearLayout.LayoutParams(-1,-2);
        descParams.topMargin = dp(14);
        page.addView(description, descParams);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> {
            connectionError.setVisibility(View.GONE);
            web.loadUrl(BuildConfig.WEB_ORIGIN + "/");
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-2,-2);
        retryParams.topMargin = dp(24);
        page.addView(retry, retryParams);
        return page;
    }

    private int dp(float value) { return (int)(value * getResources().getDisplayMetrics().density + .5f); }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
            fileCallback = null;
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback=null; }
        if (web != null) { web.destroy(); web=null; }
        super.onDestroy();
    }
}
