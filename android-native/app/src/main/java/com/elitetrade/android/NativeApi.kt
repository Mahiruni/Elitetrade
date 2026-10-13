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
    fun save(value: String, name: String = "refresh") {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val data = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            prefs.edit().putString(name, Base64.encodeToString(data, Base64.NO_WRAP)).apply()
        } catch (_: Exception) { prefs.edit().remove(name).apply() }
    }
    fun read(name: String = "refresh"): String? {
        return try {
            val stored = prefs.getString(name, null) ?: return null
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            if (raw.size < 29) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0,12)))
            String(cipher.doFinal(raw.copyOfRange(12,raw.size)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }
    fun clear(name: String = "refresh") { prefs.edit().remove(name).apply() }
}

/** Server-side authorization always wins. Native UI must never infer MT5 execution success. */
class EliteApi(context: Context) {
    private val origin = BuildConfig.WEB_ORIGIN
    private val vault = RefreshTokenVault(context.applicationContext)
    // The live production API authenticates using the Supabase bearer token,
    // not the legacy elite_session cookie. This device cookie is a second,
    // server-issued proof and is encrypted with Android Keystore at rest.
    private var deviceCookie: String? = vault.read("device")?.takeIf {
        it.matches(Regex("__Host-elite_device=[A-Za-z0-9_-]{43}"))
    }
    var needsDeviceVerification: Boolean = false
        private set
    var needsMfa: Boolean = false
        private set
    var deviceEmail: String = ""
        private set
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
            if (accessToken.isNotEmpty()) con.setRequestProperty("Authorization", "Bearer " + accessToken)
            deviceCookie?.let { con.setRequestProperty("Cookie", it) }
            if (method != "GET") con.setRequestProperty("Origin", origin)
        }
        try {
            if (body != null) {
                con.doOutput = true
                con.setRequestProperty("Content-Type", "application/json")
                con.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = con.responseCode
            if (!authApi) {
                val issued = con.headerFields.entries.firstOrNull { it.key?.equals("Set-Cookie", true) == true }
                    ?.value?.firstOrNull { it.startsWith("__Host-elite_device=") }
                    ?.substringBefore(';')
                if (issued != null && issued.matches(Regex("__Host-elite_device=[A-Za-z0-9_-]{43}"))) {
                    deviceCookie = issued
                    vault.save(issued, "device")
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

    /** Returns true only after production verifies both Auth and this device. */
    private fun acceptSession(result: JSONObject): Boolean {
        accessToken = result.optString("access_token")
        refreshToken = result.optString("refresh_token")
        if (accessToken.isBlank()) throw ApiProblem("Email confirmation may be required.")
        val session = server("/api/auth/supabase-session", "POST",
            JSONObject().put("accessToken", accessToken))
        needsMfa = session.optBoolean("requiresMfa")
        needsDeviceVerification = session.optBoolean("requiresDeviceVerification")
        deviceEmail = session.optString("deviceEmail")
        user = session.optJSONObject("user")
        if (needsMfa) {
            user = null
            throw ApiProblem("Authenticator verification is required. Sign in on the EliteTrade website to complete two-factor authentication.")
        }
        if (needsDeviceVerification) {
            user = null
            return false
        }
        if (user == null) throw ApiProblem("Account verification was unsuccessful. Please sign in again.")
        if (refreshToken.isNotBlank()) vault.save(refreshToken)
        return true
    }

    suspend fun signIn(email: String, password: String): Boolean = withContext(Dispatchers.IO) {
        val result = auth("token?grant_type=password", JSONObject().put("email",email.trim()).put("password",password))
        acceptSession(result)
    }

    suspend fun signUp(name: String, email: String, password: String): Boolean = withContext(Dispatchers.IO) {
        val redirect = java.net.URLEncoder.encode(origin + "/login", "UTF-8")
        val result = auth("signup?redirect_to=" + redirect,
            JSONObject().put("email",email.trim()).put("password",password)
                .put("data",JSONObject().put("full_name",name.trim())))
        if (!result.has("access_token") || result.isNull("access_token")) false
        else acceptSession(result)
    }

    /**
     * Requests a confirmation only for a pending signup. Supabase deliberately returns a
     * generic success for unknown/already-confirmed accounts to prevent account enumeration.
     */
    suspend fun resendConfirmation(email: String) = withContext(Dispatchers.IO) {
        val address = email.trim()
        if (!address.contains("@") || address.length > 254) throw ApiProblem("Enter a valid email address.")
        val redirect = java.net.URLEncoder.encode(origin + "/login", "UTF-8")
        auth("resend?redirect_to=" + redirect,
            JSONObject().put("type", "signup").put("email", address))
        Unit
    }

    suspend fun requestDeviceVerification() = withContext(Dispatchers.IO) {
        if (!needsDeviceVerification || accessToken.isBlank()) throw ApiProblem("Sign in first to verify this device.")
        server("/api/auth/device/email", "POST", JSONObject().put("next", "/dashboard"))
        Unit
    }

    suspend fun confirmDeviceCode(code: String): Boolean = withContext(Dispatchers.IO) {
        if (!needsDeviceVerification || accessToken.isBlank()) throw ApiProblem("Sign in before verifying this device.")
        if (!code.matches(Regex("[0-9]{8}"))) throw ApiProblem("Enter the eight-digit code from your email.")
        val result = server("/api/auth/device/verify", "POST", JSONObject().put("code", code))
        val session = result.optJSONObject("session") ?: throw ApiProblem("The verification response was incomplete.")
        acceptSession(session)
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
        } catch (e: Exception) {
            // Expired/invalid refresh tokens are discarded; transient backend errors
            // do not erase the user's locally protected authentication material.
            if (e.message?.contains("refresh", true) == true ||
                e.message?.contains("invalid", true) == true) vault.clear()
            false
        }
    }

    suspend fun accounts(): JSONArray = withContext(Dispatchers.IO) { server("/api/accounts").optJSONArray("accounts") ?: JSONArray() }
    suspend fun bots(): JSONArray = withContext(Dispatchers.IO) { server("/api/bots").optJSONArray("bots") ?: JSONArray() }
    suspend fun payments(): JSONArray = withContext(Dispatchers.IO) { server("/api/payments").optJSONArray("payments") ?: JSONArray() }
    /** The production service is the source of truth for prices, wallet, network and invoice status. */
    suspend fun paymentMethods(): JSONObject = withContext(Dispatchers.IO) { server("/api/payment-methods") }
    suspend fun cryptoInvoices(): JSONObject = withContext(Dispatchers.IO) { server("/api/crypto-invoices") }
    suspend fun createCryptoInvoice(methodId: String): JSONObject = withContext(Dispatchers.IO) {
        if (!methodId.matches(Regex("[a-fA-F0-9-]{36}"))) throw ApiProblem("Select a valid payment method.")
        server("/api/crypto-invoices", "POST", JSONObject().put("methodId", methodId)).optJSONObject("invoice")
            ?: throw ApiProblem("The payment invoice was not returned. Try again.")
    }
    suspend fun refreshMember(): JSONObject = withContext(Dispatchers.IO) {
        val data = server("/api/me")
        user = data.optJSONObject("user") ?: throw ApiProblem("Your session must be verified before accessing billing.")
        user ?: JSONObject()
    }
    suspend fun reviewPayment(id: String, approved: Boolean, note: String): JSONObject = withContext(Dispatchers.IO) {
        if (user?.optString("role") != "admin") throw ApiProblem("Administrator access required.")
        server("/api/admin/payments/" + safeId(id) + "/review", "POST",
            JSONObject().put("status", if (approved) "approved" else "rejected").put("note", note))
    }
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
        accessToken = ""; refreshToken = ""; user = null
        needsDeviceVerification = false; needsMfa = false; deviceEmail = ""
        deviceCookie = null; vault.clear(); vault.clear("device")
    }
}
