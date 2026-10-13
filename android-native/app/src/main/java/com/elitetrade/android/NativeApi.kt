package com.elitetrade.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ApiProblem(message: String) : IOException(message)

/** Private Android Keystore storage. Never uses world-readable preferences or logging. */
private class RefreshTokenVault(context: Context) {
    private val prefs = context.getSharedPreferences("elite-secure-v2", Context.MODE_PRIVATE)
    private val alias = "elite-auth-refresh-v2"
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return generator.generateKey()
    }
    fun save(value: String) {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val data = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            prefs.edit().putString("refresh", Base64.encodeToString(data, Base64.NO_WRAP)).apply()
        } catch (_: Exception) { prefs.edit().remove("refresh").apply() }
    }
    fun read(): String? {
        return try {
            val stored = prefs.getString("refresh", null) ?: return null
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            if (raw.size < 29) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0,12)))
            String(cipher.doFinal(raw.copyOfRange(12,raw.size)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }
    fun clear() { prefs.edit().remove("refresh").apply() }
}

/** Server-side authorization always wins. Native UI must never infer MT5 execution success. */
class EliteApi(context: Context) {
    private val origin = BuildConfig.WEB_ORIGIN
    private val vault = RefreshTokenVault(context.applicationContext)
    private var cookie: String? = null
    private var csrf = ""
    private var supabaseUrl = ""
    private var publishableKey = ""
    private var accessToken = ""
    private var refreshToken = ""
    var user: JSONObject? = null
        private set

    private fun request(url: String, method: String = "GET", body: JSONObject? = null,
                        authApi: Boolean = false): JSONObject {
        val parsed = URL(url)
        if (parsed.protocol != "https") throw ApiProblem("A secure connection is required.")
        val con = (parsed.openConnection() as HttpURLConnection)
        con.requestMethod = method
        con.connectTimeout = 20000
        con.readTimeout = 20000
        con.instanceFollowRedirects = false
        con.setRequestProperty("Accept", "application/json")
        con.setRequestProperty("Cache-Control", "no-store")
        if (authApi) {
            con.setRequestProperty("apikey", publishableKey)
            con.setRequestProperty("Authorization", "Bearer " + (if (accessToken.isEmpty()) publishableKey else accessToken))
        } else {
            cookie?.let { con.setRequestProperty("Cookie", it) }
            if (method != "GET") {
                con.setRequestProperty("Origin", origin)
                if (csrf.isNotEmpty()) con.setRequestProperty("x-csrf-token", csrf)
            }
        }
        try {
            if (body != null) {
                con.doOutput = true
                con.setRequestProperty("Content-Type", "application/json")
                con.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = con.responseCode
            if (!authApi) {
                val raw = con.headerFields.entries.firstOrNull { it.key?.equals("Set-Cookie", true) == true }
                    ?.value?.firstOrNull { it.startsWith("elite_session=") }
                if (raw != null) {
                    val first = raw.substringBefore(';')
                    cookie = if (first == "elite_session=") null else first
                }
            }
            val data = (if (status in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText().take(1000000) } ?: "{}"
            val result = try { JSONObject(data) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) {
                throw ApiProblem(result.optString("error").ifBlank {
                    result.optString("msg").ifBlank {
                        result.optString("message").ifBlank { "The request was not completed (" + status + ")." }
                    }
                })
            }
            return result
        } finally { con.disconnect() }
    }

    private fun server(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        require(path.startsWith("/api/") && !path.contains(".."))
        return request(origin + path, method, body)
    }

    suspend fun config(): JSONObject = withContext(Dispatchers.IO) {
        val result = server("/api/config")
        val candidate = result.optString("supabaseUrl")
        if (!candidate.startsWith("https://")) throw ApiProblem("Sign-in is not configured on this server.")
        supabaseUrl = candidate.removeSuffix("/")
        publishableKey = result.optString("supabasePublishableKey")
        if (publishableKey.isBlank()) throw ApiProblem("Sign-in is unavailable. Contact support.")
        result
    }

    private fun auth(path: String, body: JSONObject): JSONObject {
        if (supabaseUrl.isEmpty()) throw ApiProblem("Sign-in is not configured.")
        return request(supabaseUrl + "/auth/v1/" + path, "POST", body, true)
    }

    private fun acceptSession(result: JSONObject) {
        accessToken = result.optString("access_token")
        refreshToken = result.optString("refresh_token")
        if (accessToken.isBlank()) throw ApiProblem("Email confirmation may be required.")
        val session = server("/api/auth/supabase-session", "POST", JSONObject().put("accessToken", accessToken))
        cookie ?: throw ApiProblem("Secure session could not be established.")
        csrf = session.optString("csrf")
        user = session.optJSONObject("user") ?: throw ApiProblem("Account verification was unsuccessful.")
        if (refreshToken.isNotBlank()) vault.save(refreshToken)
    }

    suspend fun signIn(email: String, password: String): JSONObject = withContext(Dispatchers.IO) {
        val auth = auth("token?grant_type=password", JSONObject().put("email",email.trim()).put("password",password))
        acceptSession(auth)
        user ?: JSONObject()
    }

    suspend fun signUp(name: String, email: String, password: String): Boolean = withContext(Dispatchers.IO) {
        val redirect = java.net.URLEncoder.encode(origin + "/login", "UTF-8")
        val result = auth("signup?redirect_to=" + redirect,
            JSONObject().put("email",email.trim()).put("password",password)
                .put("data",JSONObject().put("full_name",name.trim())))
        if (!result.has("access_token") || result.isNull("access_token")) false
        else { acceptSession(result); true }
    }

    suspend fun recoverPassword(email: String) = withContext(Dispatchers.IO) {
        val redirect = java.net.URLEncoder.encode(origin + "/login", "UTF-8")
        auth("recover", JSONObject().put("email",email.trim()).put("redirect_to",origin + "/login"))
        Unit
    }

    suspend fun restore(): Boolean = withContext(Dispatchers.IO) {
        try {
            val saved = vault.read() ?: return@withContext false
            val token = auth("token?grant_type=refresh_token", JSONObject().put("refresh_token",saved))
            acceptSession(token)
            true
        } catch (_: Exception) { vault.clear(); false }
    }

    suspend fun accounts(): JSONArray = withContext(Dispatchers.IO) { server("/api/accounts").optJSONArray("accounts") ?: JSONArray() }
    suspend fun bots(): JSONArray = withContext(Dispatchers.IO) { server("/api/bots").optJSONArray("bots") ?: JSONArray() }
    suspend fun payments(): JSONArray = withContext(Dispatchers.IO) { server("/api/payments").optJSONArray("payments") ?: JSONArray() }
    suspend fun admin(): JSONObject = withContext(Dispatchers.IO) {
        if (user?.optString("role") != "admin") throw ApiProblem("Administrator access is required.")
        server("/api/admin/overview")
    }
    suspend fun support(): JSONObject = withContext(Dispatchers.IO) { server("/api/support/workspace") }
    suspend fun supportThread(id: String): JSONObject = withContext(Dispatchers.IO) {
        server("/api/support/workspace/" + safeId(id))
    }
    suspend fun supportCreate(): JSONObject = withContext(Dispatchers.IO) { server("/api/support/workspace","POST",JSONObject()) }
    suspend fun supportSend(id: String, message: String): JSONObject = withContext(Dispatchers.IO) {
        server("/api/support/workspace/" + safeId(id) + "/send","POST",
            JSONObject().put("message",message).put("clientId",java.util.UUID.randomUUID().toString())
                .put("attachments",JSONArray()))
    }
    private fun safeId(value: String): String {
        if (!value.matches(Regex("[a-f0-9-]{36}",RegexOption.IGNORE_CASE))) throw ApiProblem("Invalid record.")
        return value
    }
    suspend fun connectMt5(broker: String, login: String, serverName: String, password: String): JSONObject = withContext(Dispatchers.IO) {
        server("/api/accounts","POST",JSONObject().put("broker",broker).put("login",login)
            .put("server",serverName).put("password",password))
    }
    suspend fun controlBot(botId: String, running: Boolean): JSONObject = withContext(Dispatchers.IO) {
        server("/api/bots/" + safeId(botId) + "/control","POST",JSONObject().put("running",running))
    }
    suspend fun updateProfile(name: String): JSONObject = withContext(Dispatchers.IO) {
        val result=server("/api/profile","PATCH",JSONObject().put("name",name))
        user = result.optJSONObject("user") ?: user
        result
    }
    suspend fun signOut() = withContext(Dispatchers.IO) {
        try { server("/api/auth/logout","POST",JSONObject()) } catch (_: Exception) {}
        try {
            if (accessToken.isNotBlank()) request(supabaseUrl + "/auth/v1/logout", "POST", JSONObject(), true)
        } catch (_: Exception) {}
        accessToken = ""; refreshToken = ""; user = null; cookie = null; csrf = ""; vault.clear()
    }
}
