package com.elitetrade.android

import android.app.Activity
import android.app.DownloadManager
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale

data class EliteUpdate(val versionCode: Long, val versionName: String, val downloadUrl: String,
                       val sha256: String, val sizeBytes: Long, val notes: String)

/** Checks only official GitHub releases and requires an Android-approved, same-signer install. */
class EliteUpdateManager(private val activity: Activity) {
    companion object {
        const val LATEST = "https://api.github.com/repos/Mahiruni/Elitetrade/releases/latest"
        private const val MAX_APK_BYTES = 100L * 1024 * 1024
    }
    private val downloader = activity.getSystemService(DownloadManager::class.java)
    private var readyFile: File? = null

    fun isDebug() = BuildConfig.DEBUG

    @Suppress("DEPRECATION")
    private fun packageInfo(path: String? = null): PackageInfo? {
        val pm = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        return if (path == null) pm.getPackageInfo(activity.packageName, flags) else pm.getPackageArchiveInfo(path, flags)
    }
    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> =
        (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners?.toList().orEmpty()
         else info.signatures?.toList().orEmpty()).map { it.toCharsString() }.toSet()

    suspend fun check(): EliteUpdate? = withContext(Dispatchers.IO) {
        // CI debug APKs have a distinct package and ephemeral signing certificate.
        if (isDebug()) return@withContext null
        val conn = URL(LATEST).openConnection() as HttpURLConnection
        conn.connectTimeout = 12000; conn.readTimeout = 12000
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.setRequestProperty("User-Agent", "EliteTrade-Android-Updater")
        try {
            if (conn.responseCode == 404) return@withContext null
            if (conn.responseCode != 200) throw IllegalStateException("Update server is temporarily unavailable.")
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText().take(180000) })
            if (json.optBoolean("draft") || json.optBoolean("prerelease")) return@withContext null
            val match = Regex("^android-v([0-9]+)[.]([0-9]+)[.]([0-9]+)$").matchEntire(json.optString("tag_name"))
                ?: return@withContext null
            val code = (match.groupValues[3].toLongOrNull() ?: return@withContext null) + 200000L
            if (code <= (packageInfo()?.let(::version) ?: 0)) return@withContext null
            val assets = json.optJSONArray("assets") ?: return@withContext null
            val asset = (0 until assets.length()).mapNotNull(assets::optJSONObject)
                .firstOrNull { it.optString("name") == "elitetrade-release.apk" } ?: return@withContext null
            val uri = Uri.parse(asset.optString("browser_download_url"))
            val sha = asset.optString("digest").removePrefix("sha256:").lowercase(Locale.ROOT)
            val bytes = asset.optLong("size", 0L)
            if (uri.scheme != "https" || uri.host != "github.com" ||
                !uri.path.orEmpty().startsWith("/Mahiruni/Elitetrade/releases/download/") ||
                !uri.path.orEmpty().endsWith("/elitetrade-release.apk") ||
                !sha.matches(Regex("[a-f0-9]{64}")) || bytes !in 1..MAX_APK_BYTES) return@withContext null
            EliteUpdate(code, match.groupValues.drop(1).joinToString("."),
                uri.toString(), sha, bytes, json.optString("body").take(480))
        } finally { conn.disconnect() }
    }

    suspend fun download(update: EliteUpdate, onProgress: (Int) -> Unit) = withContext(Dispatchers.IO) {
        if (isDebug()) throw IllegalStateException("Install the signed release edition to enable future in-place updates.")
        val folder = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw IllegalStateException("App download storage is unavailable.")
        val name = "elitetrade-update-" + update.versionCode + ".apk"
        val file = File(folder, name)
        if (file.exists()) file.delete()
        val request = DownloadManager.Request(Uri.parse(update.downloadUrl))
            .setTitle("EliteTrade " + update.versionName)
            .setDescription("Official signed Android update")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name)
        val id = downloader.enqueue(request)
        try {
            while (true) {
                delay(750)
                var progress = 0
                val status = downloader.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
                    if (!cursor.moveToFirst()) throw IllegalStateException("Download was interrupted.")
                    val st = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    val done = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    if (total > 0) progress = ((done * 100) / total).coerceIn(0L, 100L).toInt()
                    st
                }
                withContext(Dispatchers.Main) { onProgress(progress) }
                if (status == DownloadManager.STATUS_SUCCESSFUL) break
                if (status == DownloadManager.STATUS_FAILED)
                    throw IllegalStateException("Download failed. Check your internet connection.")
            }
            if (!file.isFile || file.length() != update.sizeBytes)
                throw IllegalStateException("APK file size does not match the official release.")
            val md = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buf = ByteArray(65536)
                while (true) {
                    val count = input.read(buf)
                    if (count == -1) break
                    md.update(buf, 0, count)
                }
            }
            val sum = md.digest().joinToString("") { "%02x".format(it) }
            if (sum != update.sha256) throw IllegalStateException("APK download integrity check failed.")
            val current = packageInfo() ?: throw IllegalStateException("Unable to validate the installed package.")
            val incoming = packageInfo(file.absolutePath)
                ?: throw IllegalStateException("Downloaded update is not a valid APK.")
            if (incoming.packageName != activity.packageName ||
                version(incoming) <= version(current) ||
                signatures(current).isEmpty() || signatures(current) != signatures(incoming))
                throw IllegalStateException("The APK app ID, version or signing certificate does not match.")
            readyFile = file
            withContext(Dispatchers.Main) { presentInstaller() }
        } catch(e: Exception) {
            readyFile = null
            file.delete()
            throw e
        }
    }

    /** Android still requires the user's installation approval. */
    fun presentInstaller() {
        val file = readyFile?.takeIf { it.exists() } ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.packageName)))
            return
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
        val install = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        install.clipData = ClipData.newUri(activity.contentResolver, "EliteTrade update", uri)
        // Do not reopen the installer each time the user returns to the app.
        readyFile = null
        activity.startActivity(install)
    }
    fun resumePendingInstaller() {
        if (readyFile != null &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()))
            presentInstaller()
    }
}
