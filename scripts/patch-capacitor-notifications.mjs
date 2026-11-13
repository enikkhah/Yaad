import fs from 'fs';
import path from 'path';

const pluginRoot = path.resolve(
  process.cwd(),
  'node_modules/@capacitor/local-notifications'
);

const pluginDir = path.join(
  pluginRoot,
  'android/src/main/kotlin/com/capacitorjs/plugins/localnotifications'
);

if (!fs.existsSync(pluginDir)) {
  console.log('[patch-capacitor-notifications] Plugin directory not found, skipping patch.');
  process.exit(0);
}

// Read and log plugin version for diagnostics
let pluginVersion = 'unknown';
try {
  const pkgJsonPath = path.join(pluginRoot, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    pluginVersion = pkg.version || 'unknown';
  }
} catch {
  // ignore
}

const requiredFiles = [
  'NotificationAction.kt',
  'NotificationStorage.kt',
  'LocalNotificationManager.kt',
  'TimedNotificationPublisher.kt',
  'NotificationChannelManager.kt',
  'NotificationDismissReceiver.kt',
  'LocalNotificationRestoreReceiver.kt',
  'LocalNotificationsPlugin.kt',
];

for (const file of requiredFiles) {
  const fullPath = path.join(pluginDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(
      `[patch-capacitor-notifications] ERROR: Missing expected file "${file}" in @capacitor/local-notifications@${pluginVersion} (${fullPath}).`
    );
    process.exit(1);
  }
}

/**
 * Safely applies a patch to a file's content or verifies that the patch is already applied (idempotent).
 * Supports upgrading from an earlier patch revision via optional legacyAnchors.
 * Exits with code 1 if neither the original anchor nor the patched marker is found.
 */
function applyPatchOrVerify(content, fileName, stepName, origAnchor, replacement, patchedMarker, legacyAnchors = []) {
  if (content.includes(patchedMarker)) {
    return content;
  }
  if (content.includes(origAnchor)) {
    return content.replace(origAnchor, replacement);
  }
  for (const legacyAnchor of legacyAnchors) {
    if (content.includes(legacyAnchor)) {
      return content.replace(legacyAnchor, replacement);
    }
  }
  console.error(
    `[patch-capacitor-notifications] ERROR in ${fileName} (${stepName}): Expected code anchor not found in @capacitor/local-notifications@${pluginVersion}.`
  );
  process.exit(1);
}

// 1. Patch NotificationAction.kt to support foreground boolean property (default false for background action buttons)
const notificationActionContent = `package com.capacitorjs.plugins.localnotifications

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import org.json.JSONObject

/**
 * Action types that will be registered for the notifications.
 */
class NotificationAction {

    var id: String? = null
    var title: String? = null
    private var input: Boolean? = null
    private var foreground: Boolean? = null

    constructor()

    constructor(id: String?, title: String?, input: Boolean?, foreground: Boolean? = false) {
        this.id = id
        this.title = title
        this.input = input
        this.foreground = foreground
    }

    fun isInput(): Boolean = input == true

    fun setInput(input: Boolean?) {
        this.input = input
    }

    fun isForeground(): Boolean = foreground == true

    fun setForeground(foreground: Boolean?) {
        this.foreground = foreground
    }

    companion object {
        fun buildTypes(types: JSArray): Map<String, Array<NotificationAction>>? {
            val actionTypeMap = HashMap<String, Array<NotificationAction>>()
            try {
                val objects = types.toList<JSONObject>()
                for (obj in objects) {
                    val jsObject = JSObject.fromJSONObject(obj)
                    val actionGroupId = jsObject.getString("id") ?: return null
                    val actions = jsObject.getJSONArray("actions")
                    if (actions != null) {
                        val typesArray = Array(actions.length()) { i ->
                            val action = JSObject.fromJSONObject(actions.getJSONObject(i))
                            val fg = if (action.has("foreground")) action.getBoolean("foreground", false) ?: false else false
                            NotificationAction(
                                action.getString("id"),
                                action.getString("title"),
                                action.getBool("input"),
                                fg
                            )
                        }
                        actionTypeMap[actionGroupId] = typesArray
                    }
                }
            } catch (e: Exception) {
                Logger.error(Logger.tags("LN"), "Error when building action types", e)
            }
            return actionTypeMap
        }
    }
}
`;

// 2. Patch NotificationStorage.kt to persist foreground flag for action buttons
const notificationStoragePath = path.join(pluginDir, 'NotificationStorage.kt');
let notificationStorageContent = fs.readFileSync(notificationStoragePath, 'utf8');

notificationStorageContent = applyPatchOrVerify(
  notificationStorageContent,
  'NotificationStorage.kt',
  'persist foreground$i',
  `editor.putBoolean("input$i", notificationActions[i].isInput())`,
  `editor.putBoolean("input$i", notificationActions[i].isInput())\n                editor.putBoolean("foreground$i", notificationActions[i].isForeground())`,
  `editor.putBoolean("foreground$i", notificationActions[i].isForeground())`
);

notificationStorageContent = applyPatchOrVerify(
  notificationStorageContent,
  'NotificationStorage.kt',
  'read foreground$i',
  `val input = storage.getBoolean("input$i", false)\n            NotificationAction(id, title, input)`,
  `val input = storage.getBoolean("input$i", false)\n            val foreground = storage.getBoolean("foreground$i", false)\n            NotificationAction(id, title, input, foreground)`,
  `val foreground = storage.getBoolean("foreground$i", false)`
);

// 3. Patch LocalNotificationManager.kt:
// - Do NOT auto-dismiss notification on body tap (DEFAULT_PRESS_ACTION) when ongoing/persistent
// - Ensure USAGE_ALARM on default and custom sound channels
// - Apply VISIBILITY_PUBLIC, CATEGORY_ALARM, PRIORITY_MAX, and 10-minute safety timeout (setTimeoutAfter)
// - Apply FLAG_ONGOING_EVENT, FLAG_NO_CLEAR, and FLAG_INSISTENT when ongoing == true or autoCancel == false
// - Use PendingIntent.getBroadcast for background action buttons so app never opens on action button click
// - Distinguish swipe deleteIntent ("swipe_dismiss") from explicit "dismiss" button
const managerPath = path.join(pluginDir, 'LocalNotificationManager.kt');
let managerContent = fs.readFileSync(managerPath, 'utf8');

const origHandleAction = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        if (isSafeToForget(existing)) {
            notificationStorage.deleteNotification(notificationId.toString())
        }
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        dismissVisibleNotification(notificationId)`;

const patchedHandleAction = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, Edit, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
            cancelMuteTimerForNotification(notificationId)
            YaadAlarmPopupActivity.dismissIfMatching(notificationId)
        } else {
            cancelMuteTimerForNotification(notificationId)
            YaadAlarmPopupActivity.dismissIfMatching(notificationId)
            LocalNotificationsPlugin.stopActiveMediaPlayer()
            try {
                val savedJson = notificationStorage.getSavedNotificationAsJSObject(notificationId.toString())
                if (savedJson != null && savedJson.optString("channelId", "") != "yaad_channel_v3_silent") {
                    val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
                    muteIntent.putExtra(NOTIFICATION_INTENT_KEY, notificationId)
                    muteIntent.putExtra(ACTION_INTENT_KEY, "mute_after_1m")
                    muteIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, savedJson.toString())
                    context.sendBroadcast(muteIntent)
                }
            } catch (e: Exception) {
            }
        }`;

const legacyHandleActionV1 = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
        }`;

const legacyHandleActionV2 = `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, Edit, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
            cancelMuteTimerForNotification(notificationId)
            YaadAlarmPopupActivity.dismissIfMatching(notificationId)
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'handleNotificationActionPerformed persistent body tap',
  origHandleAction,
  patchedHandleAction,
  'muteIntent.putExtra(ACTION_INTENT_KEY, "mute_after_1m")',
  [
    legacyHandleActionV1,
    legacyHandleActionV2,
    `        val existing = notificationStorage.getSavedNotification(notificationId.toString())
        val dataJson = JSObject()

        val results = RemoteInput.getResultsFromIntent(data)
        if (results != null) {
            val input = results.getCharSequence(REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        val menuAction = data.getStringExtra(ACTION_INTENT_KEY)

        // Do NOT dismiss or delete persistent/ongoing notification when user taps the notification body ("tap"):
        // Notification must stay in status bar until user explicitly taps Done, Snooze, Edit, or Dismiss!
        val isBodyTapOnPersistent = (menuAction == DEFAULT_PRESS_ACTION || menuAction == null) &&
            (existing?.ongoing == true || existing?.autoCancel == false)
        if (!isBodyTapOnPersistent) {
            if (isSafeToForget(existing)) {
                notificationStorage.deleteNotification(notificationId.toString())
            }
            dismissVisibleNotification(notificationId)
            cancelMuteTimerForNotification(notificationId)
        }`,
  ]
);

const origRequestFallback = `        try {
            val notificationJsonString = data.getStringExtra(NOTIFICATION_OBJ_INTENT_KEY)
            if (notificationJsonString != null) {
                request = JSObject(notificationJsonString)
            }
        } catch (e: JSONException) {
        }
        dataJson.put("notification", request)`;

const patchedRequestFallback = `        try {
            val notificationJsonString = data.getStringExtra(NOTIFICATION_OBJ_INTENT_KEY)
            if (notificationJsonString != null) {
                request = JSObject(notificationJsonString)
            }
        } catch (e: JSONException) {
        }
        if (request == null && existing?.source != null) {
            try {
                request = JSObject(existing.source)
            } catch (e: JSONException) {
            }
        }
        dataJson.put("notification", request)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'handleNotificationActionPerformed fallback to existing.source',
  origRequestFallback,
  patchedRequestFallback,
  'if (request == null && existing?.source != null)'
);

// Ensure LocalNotificationManager.kt uses AudioAttributes.USAGE_NOTIFICATION so alarm volume is controlled by Phone Notification Volume
if (managerContent.includes('.setUsage(AudioAttributes.USAGE_ALARM)')) {
  managerContent = managerContent.replaceAll(
    '.setUsage(AudioAttributes.USAGE_ALARM)',
    '.setUsage(AudioAttributes.USAGE_NOTIFICATION)'
  );
}
if (!managerContent.includes('.setUsage(AudioAttributes.USAGE_NOTIFICATION)')) {
  console.error(
    `[patch-capacitor-notifications] ERROR in LocalNotificationManager.kt: AudioAttributes.USAGE_NOTIFICATION could not be configured.`
  );
  process.exit(1);
}

const origBuildFlags = `        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        mBuilder.setOnlyAlertOnce(true)

        mBuilder.setSmallIcon(localNotification.resolveSmallIcon(context, getDefaultSmallIcon(context)))
        mBuilder.setLargeIcon(localNotification.resolveLargeIcon(context))`;

const legacyBuildFlagsV4 = `        val isSilentChannel = channelId == "yaad_channel_v3_silent" || channelId == "yaad_channel_v2_silent"
        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        // Do NOT call setSilent(true) so the notification remains pinned at the TOP of the dropdown shade (Alerting section) after 1 minute
        if (isSilentChannel) {
            mBuilder.setOnlyAlertOnce(true)
            mBuilder.setDefaults(0)
            mBuilder.setSound(null)
        } else {
            mBuilder.setOnlyAlertOnce(!localNotification.ongoing)
        }
        if (localNotification.ongoing) {
            mBuilder.setCategory(NotificationCompat.CATEGORY_ALARM)
            mBuilder.setPriority(NotificationCompat.PRIORITY_MAX)
            mBuilder.setSortKey("0000_yaad_pinned")
        }
        try {
            val appDrawable = context.packageManager.getApplicationIcon(context.applicationInfo)
            val w = if (appDrawable.intrinsicWidth > 0) appDrawable.intrinsicWidth else 192
            val h = if (appDrawable.intrinsicHeight > 0) appDrawable.intrinsicHeight else 192
            val appBitmap = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(appBitmap)
            appDrawable.setBounds(0, 0, canvas.width, canvas.height)
            appDrawable.draw(canvas)
            mBuilder.setSmallIcon(androidx.core.graphics.drawable.IconCompat.createWithBitmap(appBitmap))
            mBuilder.setLargeIcon(appBitmap)
        } catch (e: Exception) {
        }

        mBuilder.setSmallIcon(localNotification.resolveSmallIcon(context, getDefaultSmallIcon(context)))
        mBuilder.setLargeIcon(localNotification.resolveLargeIcon(context))`;

const legacyBuildFlagsV5 = `        val isSilentChannel = channelId == "yaad_channel_v3_silent" || channelId == "yaad_channel_v2_silent"
        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        // Do NOT call setSilent(true) so the notification remains pinned at the TOP of the dropdown shade (Alerting section) after 1 minute
        if (isSilentChannel) {
            mBuilder.setOnlyAlertOnce(true)
            mBuilder.setDefaults(0)
            mBuilder.setSound(null)
        } else {
            mBuilder.setOnlyAlertOnce(!localNotification.ongoing)
        }
        if (localNotification.ongoing) {
            mBuilder.setCategory(NotificationCompat.CATEGORY_ALARM)
            mBuilder.setPriority(NotificationCompat.PRIORITY_MAX)
            mBuilder.setSortKey("0000_yaad_pinned")
        }

        mBuilder.setSmallIcon(localNotification.resolveSmallIcon(context, getDefaultSmallIcon(context)))
        mBuilder.setLargeIcon(localNotification.resolveLargeIcon(context))
        try {
            val appDrawable = context.packageManager.getApplicationIcon(context.applicationInfo)
            val w = if (appDrawable.intrinsicWidth > 0) appDrawable.intrinsicWidth else 192
            val h = if (appDrawable.intrinsicHeight > 0) appDrawable.intrinsicHeight else 192
            val appBitmap = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(appBitmap)
            appDrawable.setBounds(0, 0, canvas.width, canvas.height)
            appDrawable.draw(canvas)
            mBuilder.setSmallIcon(androidx.core.graphics.drawable.IconCompat.createWithBitmap(appBitmap))
            mBuilder.setLargeIcon(appBitmap)
        } catch (e: Exception) {
            if (context.applicationInfo.icon != 0) {
                mBuilder.setSmallIcon(context.applicationInfo.icon)
            }
        }`;

const patchedBuildFlags = `        val isSilentChannel = channelId == "yaad_channel_v3_silent" || channelId == "yaad_channel_v2_silent"
        mBuilder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        // Hide duplicate Android header timestamp because notification body already displays the reminder time
        mBuilder.setShowWhen(false)
        // Make notification subject (title) font distinctly larger and bolder than the rest of the notification text
        try {
            val rawTitle = localNotification.title ?: ""
            if (rawTitle.isNotEmpty()) {
                val styledTitle = android.text.SpannableString(rawTitle)
                styledTitle.setSpan(
                    android.text.style.StyleSpan(android.graphics.Typeface.BOLD),
                    0,
                    rawTitle.length,
                    android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                styledTitle.setSpan(
                    android.text.style.RelativeSizeSpan(1.22f),
                    0,
                    rawTitle.length,
                    android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                mBuilder.setContentTitle(styledTitle)
                val rawBody = localNotification.body ?: ""
                if (rawBody.isNotEmpty()) {
                    val styledBody = android.text.SpannableString(rawBody)
                    styledBody.setSpan(
                        android.text.style.RelativeSizeSpan(0.92f),
                        0,
                        rawBody.length,
                        android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                    )
                    mBuilder.setContentText(styledBody)
                    mBuilder.setStyle(
                        NotificationCompat.BigTextStyle()
                            .setBigContentTitle(styledTitle)
                            .bigText(styledBody)
                    )
                }
            }
        } catch (e: Exception) {
        }
        // Do NOT call setSilent(true) so the notification remains pinned at the TOP of the dropdown shade (Alerting section) after 1 minute
        if (isSilentChannel) {
            mBuilder.setOnlyAlertOnce(true)
            mBuilder.setDefaults(0)
            mBuilder.setSound(null)
        } else {
            mBuilder.setOnlyAlertOnce(!localNotification.ongoing)
        }
        if (localNotification.ongoing) {
            mBuilder.setCategory(NotificationCompat.CATEGORY_ALARM)
            mBuilder.setPriority(NotificationCompat.PRIORITY_MAX)
            mBuilder.setSortKey("0000_yaad_pinned")
        }

        // Only set SmallIcon using transparent ic_stat_notification drawable; NEVER set LargeIcon
        // so there is only ONE transparent app logo and no second left logo with a white background
        val notifIconResId = context.resources.getIdentifier("ic_stat_notification", "drawable", context.packageName)
        if (notifIconResId != 0) {
            mBuilder.setSmallIcon(notifIconResId)
        } else {
            mBuilder.setSmallIcon(localNotification.resolveSmallIcon(context, getDefaultSmallIcon(context)))
        }
        mBuilder.setLargeIcon(null as android.graphics.Bitmap?)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'buildNotification visibility, category, priority, single transparent app icon, distinct title font, and top-pinned silent channel handling',
  origBuildFlags,
  patchedBuildFlags,
  'mBuilder.setLargeIcon(null as android.graphics.Bitmap?)',
  [legacyBuildFlagsV4, legacyBuildFlagsV5]
);

const origBuildNotif = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()`;

const legacyBuildNotifV1 = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_INSISTENT
        }`;

const legacyBuildNotifV2 = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_INSISTENT
        }`;

const legacyBuildNotifV3 = `        createActionIntents(localNotification, mBuilder)
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }`;

const patchedBuildNotif = `        createActionIntents(localNotification, mBuilder)
        if (!isSilentChannel && (localNotification.ongoing || !localNotification.autoCancel)) {
            localNotification.id?.let { notifId ->
                val fullScreenIntent = Intent(context, YaadAlarmPopupActivity::class.java)
                fullScreenIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                fullScreenIntent.putExtra(NOTIFICATION_INTENT_KEY, notifId)
                fullScreenIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                fullScreenIntent.putExtra("yaad_wake_screen_once", true)
                var fsFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    fsFlags = fsFlags or PendingIntent.FLAG_MUTABLE
                }
                val fullScreenPendingIntent = YaadAlarmPopupActivity.createBalAllowedActivityPendingIntent(
                    context,
                    notifId + 700000,
                    fullScreenIntent,
                    fsFlags
                )
                mBuilder.setFullScreenIntent(fullScreenPendingIntent, true)
            }
        }
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }`;

const legacyBuildNotifV5 = `        createActionIntents(localNotification, mBuilder)
        if (!isSilentChannel && (localNotification.ongoing || !localNotification.autoCancel)) {
            localNotification.id?.let { notifId ->
                val fullScreenIntent = Intent(context, YaadAlarmPopupActivity::class.java)
                fullScreenIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                fullScreenIntent.putExtra(NOTIFICATION_INTENT_KEY, notifId)
                fullScreenIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                fullScreenIntent.putExtra("yaad_wake_screen_once", true)
                var fsFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    fsFlags = fsFlags or PendingIntent.FLAG_MUTABLE
                }
                val fullScreenPendingIntent = PendingIntent.getActivity(
                    context,
                    notifId + 700000,
                    fullScreenIntent,
                    fsFlags
                )
                mBuilder.setFullScreenIntent(fullScreenPendingIntent, true)
            }
        }
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }`;

const legacyBuildNotifV4 = `        createActionIntents(localNotification, mBuilder)
        if (!isSilentChannel && (localNotification.ongoing || !localNotification.autoCancel)) {
            localNotification.id?.let { notifId ->
                val fullScreenIntent = Intent(context, YaadAlarmPopupActivity::class.java)
                fullScreenIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                fullScreenIntent.putExtra(NOTIFICATION_INTENT_KEY, notifId)
                fullScreenIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                var fsFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    fsFlags = fsFlags or PendingIntent.FLAG_MUTABLE
                }
                val fullScreenPendingIntent = PendingIntent.getActivity(
                    context,
                    notifId + 700000,
                    fullScreenIntent,
                    fsFlags
                )
                mBuilder.setFullScreenIntent(fullScreenPendingIntent, true)
            }
        }
        val buildNotification = mBuilder.build()
        if (localNotification.ongoing || !localNotification.autoCancel) {
            buildNotification.flags = buildNotification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                (if (isSilentChannel) Notification.FLAG_ONLY_ALERT_ONCE else Notification.FLAG_INSISTENT)
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'buildNotification fullScreenIntent, FLAG_INSISTENT and silent mode',
  origBuildNotif,
  patchedBuildNotif,
  'YaadAlarmPopupActivity.createBalAllowedActivityPendingIntent(',
  [legacyBuildNotifV5, legacyBuildNotifV4, legacyBuildNotifV2, legacyBuildNotifV3, legacyBuildNotifV1]
);

const origImmediateNotify = `            try {
                val notificationJson = JSObject(localNotification.source ?: "{}")
                LocalNotificationsPlugin.fireReceived(notificationJson)
            } catch (e: JSONException) {
            }
            localNotification.id?.let { notificationManager.notify(it, buildNotification) }`;

const legacyImmediateNotifyV1 = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            localNotification.id?.let {
                notificationManager.notify(it, buildNotification)
                if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                    scheduleMuteAfterOneMinute(it, localNotification.source)
                }
            }`;

const legacyImmediateNotifyV2 = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            localNotification.id?.let {
                notificationManager.notify(it, buildNotification)
                if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                    scheduleMuteAfterOneMinute(it, localNotification.source)
                    YaadAlarmPopupActivity.launch(context, it, localNotification.source)
                }
            }`;

const legacyImmediateNotifyV3 = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            if (isSilentChannel || !LocalNotificationsPlugin.isAppInForeground(context)) {
                localNotification.id?.let {
                    notificationManager.notify(it, buildNotification)
                    if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                        scheduleMuteAfterOneMinute(it, localNotification.source)
                        YaadAlarmPopupActivity.launch(context, it, localNotification.source)
                    }
                }
            }`;

const legacyImmediateNotifyV4 = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            localNotification.id?.let {
                notificationManager.notify(it, buildNotification)
                if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                    scheduleMuteAfterOneMinute(it, localNotification.source)
                    if (!LocalNotificationsPlugin.isAppInForeground(context)) {
                        YaadAlarmPopupActivity.launch(context, it, localNotification.source)
                    }
                }
            }`;

const patchedImmediateNotify = `            if (!isSilentChannel) {
                try {
                    val notificationJson = JSObject(localNotification.source ?: "{}")
                    LocalNotificationsPlugin.fireReceived(notificationJson)
                } catch (e: JSONException) {
                }
            }
            localNotification.id?.let {
                notificationManager.notify(it, buildNotification)
                if (!isSilentChannel && (buildNotification.flags and Notification.FLAG_INSISTENT) != 0) {
                    scheduleMuteAfterOneMinute(it, localNotification.source)
                    if (!LocalNotificationsPlugin.isAppInForeground(context)) {
                        YaadAlarmPopupActivity.launch(context, it, localNotification.source, wakeScreenOnce = true)
                    }
                }
            }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'scheduleMuteAfterOneMinute and YaadAlarmPopupActivity on immediate notify',
  origImmediateNotify,
  patchedImmediateNotify,
  'YaadAlarmPopupActivity.launch(context, it, localNotification.source, wakeScreenOnce = true)',
  [legacyImmediateNotifyV4, legacyImmediateNotifyV1, legacyImmediateNotifyV2, legacyImmediateNotifyV3]
);

const origOpenIntent = `        // Open intent
        val intent = buildIntent(localNotification, DEFAULT_PRESS_ACTION)
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getActivity(context, id, intent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

const legacyNoopOpenIntent = `        // Open intent: use a no-op Broadcast so tapping the notification body does NOT open the app
        // (Only the explicit "edit" action button should open the app)
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val bodyTapIntent = Intent(context, NotificationDismissReceiver::class.java)
        bodyTapIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
        bodyTapIntent.putExtra(ACTION_INTENT_KEY, "body_tap_noop")
        val pendingIntent = PendingIntent.getBroadcast(context, id, bodyTapIntent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

const legacyOpenIntentV2 = `        // Open intent: tapping the notification body opens the app directly to the Reminders Timeline (DEFAULT_PRESS_ACTION = "tap")
        val intent = buildIntent(localNotification, DEFAULT_PRESS_ACTION)
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getActivity(context, id, intent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

const patchedOpenIntent = `        // Open intent: tapping the notification body reopens YaadAlarmPopupActivity full-screen card (if minimized) or opens Reminders Timeline
        val intent = if (localNotification.ongoing || !localNotification.autoCancel) {
            Intent(context, YaadAlarmPopupActivity::class.java).apply {
                this.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                putExtra(NOTIFICATION_INTENT_KEY, id)
                putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
            }
        } else {
            buildIntent(localNotification, DEFAULT_PRESS_ACTION)
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getActivity(context, id, intent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents body tap reopens YaadAlarmPopupActivity or Reminders Timeline',
  origOpenIntent,
  patchedOpenIntent,
  '// Open intent: tapping the notification body reopens YaadAlarmPopupActivity full-screen card',
  [legacyOpenIntentV2, legacyNoopOpenIntent]
);

const targetActionLoop = `        // Build action types
        val actionTypeId = localNotification.actionTypeId
        if (actionTypeId != null) {
            val actionGroup = storage.getActionGroup(actionTypeId)
            for (notificationAction in actionGroup) {
                val actionIntent = buildIntent(localNotification, notificationAction.id)
                val actionPendingIntent = PendingIntent.getActivity(
                    context,
                    id + (notificationAction.id?.hashCode() ?: 0),
                    actionIntent,
                    flags
                )
                val actionBuilder = NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.title,
                    actionPendingIntent
                )
                if (notificationAction.isInput()) {
                    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(notificationAction.title).build()
                    actionBuilder.addRemoteInput(remoteInput)
                }
                mBuilder.addAction(actionBuilder.build())
            }
        }`;

const legacyActionLoopV1 = `        // Build action types (use PendingIntent.getBroadcast when foreground is false so app never opens on button click)
        val actionTypeId = localNotification.actionTypeId
        if (actionTypeId != null) {
            val actionGroup = storage.getActionGroup(actionTypeId)
            for (notificationAction in actionGroup) {
                val isForegroundAction = notificationAction.isForeground() &&
                    notificationAction.id != "done" &&
                    notificationAction.id != "snooze" &&
                    notificationAction.id != "stop" &&
                    notificationAction.id != "dismiss" &&
                    notificationAction.id != "complete"

                val actionPendingIntent = if (isForegroundAction) {
                    val actionIntent = buildIntent(localNotification, notificationAction.id)
                    PendingIntent.getActivity(
                        context,
                        id + (notificationAction.id?.hashCode() ?: 0),
                        actionIntent,
                        flags
                    )
                } else {
                    val broadcastIntent = Intent(context, NotificationDismissReceiver::class.java)
                    broadcastIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
                    broadcastIntent.putExtra(ACTION_INTENT_KEY, notificationAction.id)
                    broadcastIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                    PendingIntent.getBroadcast(
                        context,
                        id + (notificationAction.id?.hashCode() ?: 0),
                        broadcastIntent,
                        flags
                    )
                }
                val actionBuilder = NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.title,
                    actionPendingIntent
                )
                if (!isForegroundAction) {
                    actionBuilder.setShowsUserInterface(false)
                }
                if (notificationAction.isInput()) {
                    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(notificationAction.title).build()
                    actionBuilder.addRemoteInput(remoteInput)
                }
                mBuilder.addAction(actionBuilder.build())
            }
        }`;

const replacementActionLoop = `        // Build action types (ONLY "edit" or explicit foreground actions use PendingIntent.getActivity to open the app)
        val actionTypeId = localNotification.actionTypeId
        if (actionTypeId != null) {
            val actionGroup = storage.getActionGroup(actionTypeId)
            for (notificationAction in actionGroup) {
                val isForegroundAction = (notificationAction.id == "edit" || notificationAction.isForeground()) &&
                    notificationAction.id != "done" &&
                    notificationAction.id != "snooze" &&
                    notificationAction.id != "stop" &&
                    notificationAction.id != "dismiss" &&
                    notificationAction.id != "complete"

                val actionPendingIntent = if (isForegroundAction) {
                    val actionIntent = buildIntent(localNotification, notificationAction.id)
                    PendingIntent.getActivity(
                        context,
                        id + (notificationAction.id?.hashCode() ?: 0),
                        actionIntent,
                        flags
                    )
                } else {
                    val broadcastIntent = Intent(context, NotificationDismissReceiver::class.java)
                    broadcastIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
                    broadcastIntent.putExtra(ACTION_INTENT_KEY, notificationAction.id)
                    broadcastIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                    PendingIntent.getBroadcast(
                        context,
                        id + (notificationAction.id?.hashCode() ?: 0),
                        broadcastIntent,
                        flags
                    )
                }
                val actionBuilder = NotificationCompat.Action.Builder(
                    R.drawable.ic_transparent,
                    notificationAction.title,
                    actionPendingIntent
                )
                actionBuilder.setShowsUserInterface(isForegroundAction)
                if (notificationAction.isInput()) {
                    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(notificationAction.title).build()
                    actionBuilder.addRemoteInput(remoteInput)
                }
                mBuilder.addAction(actionBuilder.build())
            }
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents foreground edit and background broadcast actions',
  targetActionLoop,
  replacementActionLoop,
  'actionBuilder.setShowsUserInterface(isForegroundAction)',
  [legacyActionLoopV1]
);

const origDeleteIntent = `        // Dismiss intent
        val dismissIntent = Intent(context, NotificationDismissReceiver::class.java)
        dismissIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        dismissIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
        dismissIntent.putExtra(ACTION_INTENT_KEY, "dismiss")`;

const patchedDeleteIntent = `        // Dismiss intent (when user swipes notification away in shade)
        val dismissIntent = Intent(context, NotificationDismissReceiver::class.java)
        dismissIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        dismissIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
        dismissIntent.putExtra(ACTION_INTENT_KEY, "swipe_dismiss")
        dismissIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents swipe_dismiss deleteIntent',
  origDeleteIntent,
  patchedDeleteIntent,
  'dismissIntent.putExtra(ACTION_INTENT_KEY, "swipe_dismiss")'
);

const origBuildIntentFlags = `        intent.action = Intent.ACTION_MAIN
        intent.addCategory(Intent.CATEGORY_LAUNCHER)
        intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP`;

const patchedBuildIntentFlags = `        intent.action = Intent.ACTION_MAIN
        intent.addCategory(Intent.CATEGORY_LAUNCHER)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'buildIntent FLAG_ACTIVITY_NEW_TASK for Edit action button',
  origBuildIntentFlags,
  patchedBuildIntentFlags,
  'intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP'
);

const origDismissVisible = `    private fun dismissVisibleNotification(notificationId: Int) {
        NotificationManagerCompat.from(context).cancel(notificationId)
    }`;

const patchedDismissVisible = `    private fun scheduleMuteAfterOneMinute(id: Int, sourceJson: String?) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            muteIntent.putExtra(NOTIFICATION_INTENT_KEY, id)
            muteIntent.putExtra(ACTION_INTENT_KEY, "mute_after_1m")
            if (sourceJson != null) {
                muteIntent.putExtra(NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pi = PendingIntent.getBroadcast(context, id + 500000, muteIntent, flags)
            val triggerAt = System.currentTimeMillis() + 60_000L
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } catch (e: Exception) {
            Logger.error(Logger.tags("LN"), "Failed to schedule 1m mute timer", e)
        }
    }

    private fun cancelMuteTimerForNotification(notificationId: Int) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            var flags = PendingIntent.FLAG_NO_CREATE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pi = PendingIntent.getBroadcast(context, notificationId + 500000, muteIntent, flags)
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
        } catch (e: Exception) {
        }
    }

    private fun dismissVisibleNotification(notificationId: Int) {
        cancelMuteTimerForNotification(notificationId)
        YaadAlarmPopupActivity.dismissIfMatching(notificationId)
        NotificationManagerCompat.from(context).cancel(notificationId)
    }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'scheduleMuteAfterOneMinute and cancelMuteTimerForNotification helpers',
  origDismissVisible,
  patchedDismissVisible,
  'private fun scheduleMuteAfterOneMinute(id: Int, sourceJson: String?)'
);

const origSetExactIfPossible = `        if (useExact) {
            if (schedule.allowWhileIdle()) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent)
            } else {
                alarmManager.setExact(AlarmManager.RTC, trigger, pendingIntent)
            }
        } else {
            if (schedule.allowWhileIdle()) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent)
            } else {
                alarmManager.set(AlarmManager.RTC, trigger, pendingIntent)
            }
        }`;

const patchedSetExactIfPossible = `        if (useExact) {
            try {
                val reqId = localNotification.id ?: 0
                val showIntent = Intent(context, YaadAlarmPopupActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                    putExtra(NOTIFICATION_INTENT_KEY, reqId)
                    putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.source)
                    putExtra("yaad_wake_screen_once", true)
                }
                var showFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    showFlags = showFlags or PendingIntent.FLAG_IMMUTABLE
                }
                val showPi = PendingIntent.getActivity(context, reqId + 800000, showIntent, showFlags)
                alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, showPi), pendingIntent)
            } catch (e: Exception) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent)
            }
        } else {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent)
        }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'setExactIfPossible AlarmManager.setAlarmClock for <2s wake from Doze & Killed state',
  origSetExactIfPossible,
  patchedSetExactIfPossible,
  'alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, showPi), pendingIntent)'
);

if (managerContent.includes('private const val DEFAULT_PRESS_ACTION = "tap"')) {
  managerContent = managerContent.replace(
    'private const val DEFAULT_PRESS_ACTION = "tap"',
    'const val DEFAULT_PRESS_ACTION = "tap"'
  );
}

// 4. Patch TimedNotificationPublisher.kt:
// - Respect actual ongoing / autoCancel flags without forcing non-ongoing notifications into insistent mode
// - Schedule 60-second mute timer (mute_after_1m) so insistent alarm rings for 1 minute and notification remains open afterward
// - Cancel any previous active notifications for the same reminderId before posting a repeat alarm so cards/sounds never stack
const publisherPath = path.join(pluginDir, 'TimedNotificationPublisher.kt');
const publisherContent = `package com.capacitorjs.plugins.localnotifications

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import java.text.SimpleDateFormat
import java.util.Date

/**
 * Creates a notification from a timer event. Registered as a broadcast receiver
 * in AndroidManifest.
 */
class TimedNotificationPublisher : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification: Notification? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(NOTIFICATION_KEY, Notification::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(NOTIFICATION_KEY)
        }
        if (notification == null) return

        notification.\`when\` = System.currentTimeMillis()

        val id = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (id == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "No valid id supplied", null)
        }
        val storage = NotificationStorage(context)
        val notificationJson = storage.getSavedNotificationAsJSObject(id.toString())
        if (notificationJson == null) {
            return
        }

        // Ignore stale notifications (> 90 seconds past due) or legacy repeat notifications
        try {
            val extraCheck = notificationJson.optJSONObject("extra")
            if (extraCheck?.optBoolean("isRepeat", false) == true) {
                storage.deleteNotification(id.toString())
                return
            }
            val scheduleObj = notificationJson.getJSObject("schedule")
            val atStr = scheduleObj?.getString("at")
            if (!atStr.isNullOrEmpty()) {
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                val atDate = sdf.parse(atStr)
                if (atDate != null && (System.currentTimeMillis() - atDate.time) > 90 * 1000L) {
                    storage.deleteNotification(id.toString())
                    return
                }
            }
        } catch (e: Exception) {
        }

        val isOngoing = if (notificationJson.has("ongoing")) {
            notificationJson.getBoolean("ongoing", false) ?: false
        } else {
            (notification.flags and Notification.FLAG_ONGOING_EVENT) != 0
        }
        val isAutoCancel = if (notificationJson != null && notificationJson.has("autoCancel")) {
            notificationJson.getBoolean("autoCancel", true) ?: true
        } else {
            (notification.flags and Notification.FLAG_AUTO_CANCEL) != 0
        }

        if (isOngoing || !isAutoCancel) {
            notification.flags = notification.flags or
                Notification.FLAG_ONGOING_EVENT or
                Notification.FLAG_NO_CLEAR or
                Notification.FLAG_INSISTENT
            if (id != Int.MIN_VALUE) {
                try {
                    val fullScreenIntent = Intent(context, YaadAlarmPopupActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                            Intent.FLAG_ACTIVITY_NO_USER_ACTION
                        putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, id)
                        putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, notificationJson.toString())
                        putExtra("yaad_wake_screen_once", true)
                    }
                    var fsFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        fsFlags = fsFlags or PendingIntent.FLAG_MUTABLE
                    }
                    notification.fullScreenIntent = YaadAlarmPopupActivity.createBalAllowedActivityPendingIntent(
                        context,
                        id + 700000,
                        fullScreenIntent,
                        fsFlags
                    )
                } catch (e: Exception) {
                }
            }
        }

        // Prevent stacking multiple insistent notifications & overlapping audio streams for the same reminder
        val reminderId = notificationJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
        if (reminderId.isNotEmpty() && id != Int.MIN_VALUE) {
            cancelPreviousActiveNotificationsForReminder(storage, notificationManager, id, reminderId)
        }

        // Bundling / Queuing for Simultaneous or Near-Simultaneous Timed Reminders (within +/- 60s window):
        // Prevents multiple full-screen intents from colliding and merges them into a single grouped full-screen alert
        val bundledReminderIdsJs = ArrayList<String>()
        if (reminderId.isNotEmpty() && id != Int.MIN_VALUE && notificationJson != null) {
            try {
                val extraObj = notificationJson.optJSONObject("extra") ?: JSObject()
                val isGeofence = extraObj.optBoolean("geofence", false)
                if (!isGeofence) {
                    val nowMs = System.currentTimeMillis()
                    val bundleArr = org.json.JSONArray()
                    val seenReminderIds = HashSet<String>()

                    fun appendCandidateToBundle(candId: Int, candJson: JSObject) {
                        val cExtra = candJson.optJSONObject("extra")
                        if (cExtra?.optBoolean("geofence", false) == true) return
                        val cRemId = cExtra?.optString("reminderId", "") ?: ""
                        val dedupKey = if (cRemId.isNotEmpty()) cRemId else "notif_\$candId"
                        if (seenReminderIds.contains(dedupKey)) return
                        seenReminderIds.add(dedupKey)
                        if (cRemId.isNotEmpty()) {
                            bundledReminderIdsJs.add(cRemId)
                        }
                        val item = org.json.JSONObject()
                        item.put("notificationId", candId)
                        item.put("reminderId", cRemId)
                        item.put("title", candJson.optString("title", ""))
                        item.put("body", candJson.optString("body", ""))
                        item.put("sourceJson", candJson.toString())
                        bundleArr.put(item)
                    }

                    appendCandidateToBundle(id, notificationJson)

                    // 1. Include any currently active timed reminders already displayed in status bar / full-screen popup
                    for (active in notificationManager.activeNotifications) {
                        if (active.id == id) continue
                        val activeJson = storage.getSavedNotificationAsJSObject(active.id.toString()) ?: continue
                        val activeExtra = activeJson.optJSONObject("extra")
                        if (activeExtra?.optBoolean("geofence", false) == true) continue
                        val activeRemId = activeExtra?.optString("reminderId", "") ?: ""
                        if (activeRemId.isNotEmpty() && activeRemId != reminderId) {
                            appendCandidateToBundle(active.id, activeJson)
                        }
                    }

                    // 2. Include any other saved timed reminders scheduled within +/- 45 seconds of now
                    val sdfIso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                    sdfIso.timeZone = java.util.TimeZone.getTimeZone("UTC")
                    for (savedIdStr in storage.getSavedNotificationIds()) {
                        val sId = savedIdStr.toIntOrNull() ?: continue
                        if (sId == id) continue
                        val sJson = storage.getSavedNotificationAsJSObject(savedIdStr) ?: continue
                        val sExtra = sJson.optJSONObject("extra")
                        if (sExtra?.optBoolean("geofence", false) == true) continue
                        if (sExtra?.optBoolean("isRepeat", false) == true) continue
                        val sRemId = sExtra?.optString("reminderId", "") ?: ""
                        if (sRemId.isEmpty() || sRemId == reminderId) continue
                        val atStr = sJson.optJSONObject("schedule")?.optString("at", "") ?: ""
                        val dueMs = if (atStr.isNotEmpty()) {
                            try { sdfIso.parse(atStr)?.time ?: 0L } catch (e: Exception) { 0L }
                        } else {
                            sExtra?.optLong("dueTimestamp", 0L) ?: 0L
                        }
                        if (dueMs > 0L && kotlin.math.abs(dueMs - nowMs) <= 45_000L) {
                            appendCandidateToBundle(sId, sJson)
                        }
                    }

                    if (bundleArr.length() >= 2) {
                        extraObj.put("bundledReminders", bundleArr)
                        notificationJson.put("extra", extraObj)
                    }
                }
            } catch (e: Exception) {
            }
        }

        val isInsistentAlarm = id != Int.MIN_VALUE && (notification.flags and Notification.FLAG_INSISTENT) != 0
        val appInForeground = LocalNotificationsPlugin.isAppInForeground(context)
        val inPhoneCall = YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(context)

        if (isInsistentAlarm && inPhoneCall) {
            // Phone is currently ringing or in an active call:
            // Do NOT play insistent alarm audio over the phone call and do NOT launch the full-screen activity on top of the dialer.
            // Post the status bar notification quietly and suspend the full-screen popup so it automatically launches when the call ends!
            notification.flags = notification.flags and Notification.FLAG_INSISTENT.inv()
            notification.fullScreenIntent = null
            LocalNotificationsPlugin.fireReceived(notificationJson)
            notificationManager.notify(id, notification)
            YaadAlarmPopupActivity.suspendTimedReminderForPhoneCall(
                context,
                id,
                notificationJson.toString(),
                60_000L,
                false
            )
            if (!rescheduleNotificationIfNeeded(context, intent, id)) {
                storage.deleteNotification(id.toString())
            }
            return
        }

        val wasScreenOffBeforeWake = !YaadAlarmPopupActivity.isScreenCurrentlyInteractive(context) ||
            YaadGeofenceService.isInScreenOffSession
        if (isInsistentAlarm && !appInForeground) {
            acquireScreenWakeLock(context, wasScreenOffBeforeWake)
            try {
                notificationManager.cancel(id)
            } catch (e: Exception) {
            }
        }

        // Always emit the Android notification so the out-of-app notification audio plays whether the app is open or closed;
        // launch the standalone native full-screen activity in < 1s when the app is NOT in the foreground,
        // and dispatch immediate JS event when the app IS in the foreground so the in-app full-screen modal opens in < 50ms.
        LocalNotificationsPlugin.fireReceived(notificationJson)
        if (appInForeground && reminderId.isNotEmpty()) {
            val safeRemId = reminderId.replace("'", "").replace("\\\\", "")
            val bundledJsArrayLiteral = bundledReminderIdsJs.joinToString(",") {
                "'" + it.replace("'", "").replace("\\\\", "") + "'"
            }
            LocalNotificationsPlugin.evaluateJsInWebView(
                "window.dispatchEvent(new CustomEvent('yaad:native-reminder-due', { detail: { reminderId: '\$safeRemId', notificationId: \$id, bundledReminderIds: [\$bundledJsArrayLiteral] } }));"
            )
        }
        notificationManager.notify(id, notification)
        if (isInsistentAlarm) {
            scheduleMuteAfterOneMinute(context, id, notificationJson.toString())
            if (!appInForeground) {
                YaadAlarmPopupActivity.launch(
                    context,
                    id,
                    notificationJson.toString(),
                    wakeScreenOnce = true,
                    forceScreenOffDuration = wasScreenOffBeforeWake
                )
            }
        }
        if (!rescheduleNotificationIfNeeded(context, intent, id)) {
            storage.deleteNotification(id.toString())
        }
    }

    private fun acquireScreenWakeLock(context: Context, wasScreenOff: Boolean = false) {
        try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                "yaad:timedReminderScreenWakeUp"
            )
            wl.setReferenceCounted(false)
            val durMs = if (wasScreenOff) YaadAlarmPopupActivity.SCREEN_OFF_KEEP_AWAKE_MS else YaadAlarmPopupActivity.SCREEN_ON_KEEP_AWAKE_MS
            wl.acquire(durMs)
        } catch (e: Exception) {
        }
    }

    private fun scheduleMuteAfterOneMinute(context: Context, id: Int, sourceJson: String?) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            muteIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, id)
            muteIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "mute_after_1m")
            if (sourceJson != null) {
                muteIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pi = PendingIntent.getBroadcast(context, id + 500000, muteIntent, flags)
            val triggerAt = System.currentTimeMillis() + 60_000L
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
            if (canExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        } catch (e: Exception) {
            Logger.error(Logger.tags("LN"), "Failed to schedule 1m mute timer in publisher", e)
        }
    }

    private fun cancelPreviousActiveNotificationsForReminder(
        storage: NotificationStorage,
        notificationManager: NotificationManager,
        currentId: Int,
        reminderId: String
    ) {
        try {
            val relatedIds = HashSet<Int>()
            var hash = 0
            for (i in 0 until reminderId.length) {
                hash = (hash * 31 + reminderId[i].code) and 0x7fffffff
            }
            val rawBaseId = if (hash == 0) 1 else hash
            val modBaseId = (hash % 600000000) + 1
            for (bId in listOf(rawBaseId, modBaseId)) {
                relatedIds.add(bId)
                for (index in 0 until 25) {
                    relatedIds.add(((bId.toLong() + 1000L + index.toLong() + 1L) % 600000000L).toInt() + 1)
                    relatedIds.add(((bId.toLong() + 1000L + index.toLong() + 1L) % 2147483647L).toInt())
                }
            }

            for (active in notificationManager.activeNotifications) {
                val activeId = active.id
                if (activeId == currentId) continue
                if (relatedIds.contains(activeId)) {
                    notificationManager.cancel(activeId)
                    continue
                }
                val savedJson = storage.getSavedNotificationAsJSObject(activeId.toString())
                val savedRemId = savedJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                if (savedRemId == reminderId) {
                    notificationManager.cancel(activeId)
                }
            }
        } catch (e: Exception) {
            Logger.error(Logger.tags("LN"), "Failed to cancel previous active notifications for reminder", e)
        }
    }

    private fun rescheduleNotificationIfNeeded(context: Context, intent: Intent, id: Int): Boolean {
        val dateString = intent.getStringExtra(CRON_KEY) ?: return false

        val date = DateMatch.fromMatchString(dateString)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val trigger = date.nextTrigger(Date())
        val clone = intent.clone() as Intent
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getBroadcast(context, id, clone, flags)
        val storedNotification = NotificationStorage(context).getSavedNotificationAsJSObject(id.toString())
        val wantsExact = storedNotification?.getBoolean("isExactNotification", true) ?: true
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
        if (wantsExact && canExact) {
            try {
                val showIntent = Intent(context, YaadAlarmPopupActivity::class.java).apply {
                    this.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                    putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, id)
                    putExtra("yaad_wake_screen_once", true)
                }
                var showFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    showFlags = showFlags or PendingIntent.FLAG_IMMUTABLE
                }
                val showPi = PendingIntent.getActivity(context, id + 800000, showIntent, showFlags)
                alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, showPi), pendingIntent)
            } catch (e: Exception) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent)
            }
        } else {
            if (wantsExact) {
                Logger.warn("Capacitor/LocalNotification", "Exact alarms not allowed in user settings.  Notification scheduled with non-exact alarm.")
            }
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pendingIntent)
        }
        val sdf = SimpleDateFormat("yyyy/MM/dd HH:mm:ss")
        Logger.debug(Logger.tags("LN"), "notification " + id + " will next fire at " + sdf.format(Date(trigger)))
        return true
    }

    companion object {
        const val NOTIFICATION_KEY = "NotificationPublisher.notification"
        const val CRON_KEY = "NotificationPublisher.cron"
    }
}
`;

// 5. Patch NotificationChannelManager.kt to use AudioAttributes.USAGE_NOTIFICATION so notification sound uses the Phone Notification volume stream
const channelManagerPath = path.join(pluginDir, 'NotificationChannelManager.kt');
let channelManagerContent = fs.readFileSync(channelManagerPath, 'utf8');
if (channelManagerContent.includes('.setUsage(AudioAttributes.USAGE_ALARM)')) {
  channelManagerContent = channelManagerContent.replaceAll(
    '.setUsage(AudioAttributes.USAGE_ALARM)',
    '.setUsage(AudioAttributes.USAGE_NOTIFICATION)'
  );
}
if (!channelManagerContent.includes('.setUsage(AudioAttributes.USAGE_NOTIFICATION)')) {
  console.error(
    `[patch-capacitor-notifications] ERROR in NotificationChannelManager.kt: AudioAttributes.USAGE_NOTIFICATION could not be configured.`
  );
  process.exit(1);
}

// 6. Patch NotificationDismissReceiver.kt:
// - Handle "body_tap_noop" (do nothing so tapping notification body never opens app or dismisses notification)
// - Handle "mute_after_1m" (stop insistent alarm audio after 60 seconds while keeping notification & action buttons pinned at top of shade and advancing reminder due time by +15m)
// - Re-post swiped ongoing notifications up to 3 times (preventing accidental swipe dismissal while allowing 4th-swipe emergency escape if ROM hides buttons)
// - Cancel all related notifications (active + scheduled) when an explicit action button is clicked
// - Record exact actionTimestamp and snoozedUntil timestamp so background Snooze syncs accurately when app opens later
const dismissReceiverContent = `package com.capacitorjs.plugins.localnotifications

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.getcapacitor.CapConfig
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import java.util.Date

/**
 * Receiver called when a notification is swiped, muted after 1 minute, or when a background action button (Done, Snooze, Dismiss/Stop) is clicked.
 */
class NotificationDismissReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val intExtra = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (intExtra == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "Invalid notification operation", null)
            return
        }

        val actionId = intent.getStringExtra(LocalNotificationManager.ACTION_INTENT_KEY) ?: "swipe_dismiss"
        if (actionId == "body_tap_noop") {
            return
        }

        val storage = NotificationStorage(context)
        val prefs = context.getSharedPreferences("YAAD_BG_NOTIFICATION_ACTIONS", Context.MODE_PRIVATE)
        val swipeKey = "swipe_count_\$intExtra"

        var requestJson: JSObject? = null
        val notificationJsonString = intent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY)
        if (notificationJsonString != null) {
            try {
                requestJson = JSObject(notificationJsonString)
            } catch (e: Exception) {
            }
        }
        if (requestJson == null) {
            requestJson = storage.getSavedNotificationAsJSObject(intExtra.toString())
        }
        val reminderId = requestJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""

        // After 1 minute of continuous alarm ringing without user reaction, or when user minimizes popup ('dismiss_popup_only'),
        // silence the alarm audio without saving schedule-less notifications to storage or scheduling spurious repeat alarms.
        if (actionId == "mute_after_1m" || actionId == "dismiss_popup_only") {
            if (actionId == "dismiss_popup_only") {
                YaadAlarmPopupActivity.dismissIfMatching(intExtra)
            } else {
                YaadAlarmPopupActivity.onReminderAudioMutedAfterOneMinute(intExtra)
            }
            LocalNotificationsPlugin.stopActiveMediaPlayer()
            return
        }

        // If user swiped the notification without clicking an action button (Done / Snooze / Edit):
        // Re-post it immediately if it is an ongoing/persistent notification (up to 3 times as safety guard).
        if (actionId == "swipe_dismiss") {
            val existing = storage.getSavedNotification(intExtra.toString())
            if (existing != null && !existing.cancelled && (existing.ongoing || !existing.autoCancel)) {
                val swipeCount = prefs.getInt(swipeKey, 0)
                if (swipeCount < 3) {
                    prefs.edit().putInt(swipeKey, swipeCount + 1).apply()
                    try {
                        val savedJson = storage.getSavedNotificationAsJSObject(intExtra.toString()) ?: requestJson
                        if (savedJson != null) {
                            val immediateJson = JSObject(savedJson.toString())
                            immediateJson.remove("schedule")
                            val localNotif = LocalNotification.buildNotificationFromJSObject(immediateJson)
                            val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                            manager.schedule(null, listOf(localNotif))
                        }
                    } catch (e: Exception) {
                        Logger.error(Logger.tags("LN"), "Failed to restore swiped ongoing notification", e)
                    }
                    return
                } else {
                    // Emergency escape after 4 consecutive swipes: clean up and stop alarm
                    prefs.edit().remove(swipeKey).apply()
                    YaadAlarmPopupActivity.dismissIfMatching(intExtra)
                    val notificationManager = NotificationManagerCompat.from(context)
                    cancelAllRelatedNotifications(context, storage, notificationManager, intExtra, reminderId)
                    return
                }
            }
            prefs.edit().remove(swipeKey).apply()
            if (LocalNotificationManager.isSafeToForget(existing)) {
                storage.deleteNotification(intExtra.toString())
            }
            return
        }

        // Explicit background action button clicked (done, complete, snooze, stop, dismiss) — NEVER launch MainActivity!
        prefs.edit().remove(swipeKey).apply()
        YaadAlarmPopupActivity.clearSuspendedPopupForNotification(context, intExtra)
        YaadAlarmPopupActivity.dismissIfMatching(intExtra)
        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.cancel(intExtra)

        // Cancel all repeating notifications, mute timers, and scheduled alarms associated with this reminder
        cancelAllRelatedNotifications(context, storage, notificationManager, intExtra, reminderId)

        val actionTimeMs = System.currentTimeMillis()
        val snoozedUntilMs = actionTimeMs + 15L * 60L * 1000L

        val dataJson = JSObject()
        val results = RemoteInput.getResultsFromIntent(intent)
        if (results != null) {
            val input = results.getCharSequence(LocalNotificationManager.REMOTE_INPUT_KEY)
            dataJson.put("inputValue", input?.toString())
        }
        dataJson.put("actionId", actionId)
        dataJson.put("actionTimestamp", actionTimeMs)
        if (actionId == "snooze") {
            dataJson.put("snoozedUntil", snoozedUntilMs)
        }
        if (requestJson != null) {
            dataJson.put("notification", requestJson)
        } else {
            val fallbackNotif = JSObject()
            fallbackNotif.put("id", intExtra)
            dataJson.put("notification", fallbackNotif)
        }

        val dispatched = LocalNotificationsPlugin.fireActionPerformed(dataJson)
        if (!dispatched) {
            // App WebView is not currently active: queue action for next app open
            LocalNotificationsPlugin.queueBackgroundAction(context, dataJson)

            // If user tapped Snooze while app was closed/backgrounded, natively schedule the snoozed notification for 15 minutes later
            if (actionId == "snooze" && requestJson != null) {
                try {
                    val snoozedJson = JSObject(requestJson.toString())
                    if (reminderId.isNotEmpty()) {
                        val baseId = computeBaseId(reminderId)
                        snoozedJson.put("id", baseId)
                    }
                    val origTitle = snoozedJson.getString("title") ?: ""
                    if (origTitle.startsWith("⏰ تکرار آلارم: ")) {
                        snoozedJson.put("title", origTitle.replaceFirst("⏰ تکرار آلارم: ", "🔔 یادآور: "))
                    }
                    // Ensure snoozed notification rings again on its original sound channel rather than silent channel
                    val currentChannel = snoozedJson.optString("channelId", "")
                    if (currentChannel == "yaad_channel_v2_silent") {
                        snoozedJson.put("channelId", "yaad_channel_v2_default")
                    }
                    val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                    sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                    val scheduleObj = JSObject()
                    scheduleObj.put("at", sdf.format(Date(snoozedUntilMs)))
                    scheduleObj.put("allowWhileIdle", true)
                    snoozedJson.put("schedule", scheduleObj)

                    val localNotif = LocalNotification.buildNotificationFromJSObject(snoozedJson)
                    val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                    manager.schedule(null, listOf(localNotif))
                    storage.appendNotifications(listOf(localNotif))
                } catch (e: Exception) {
                    Logger.error(Logger.tags("LN"), "Failed to schedule native background snooze", e)
                }
            }
        }
    }

    private fun computeBaseId(reminderId: String): Int {
        var hash = 0
        for (i in 0 until reminderId.length) {
            hash = (hash * 31 + reminderId[i].code) and 0x7fffffff
        }
        return (hash % 600000000) + 1
    }

    private fun cancelAllRelatedNotifications(
        context: Context,
        storage: NotificationStorage,
        notificationManager: NotificationManagerCompat,
        primaryId: Int,
        reminderId: String
    ) {
        val idsToCancel = HashSet<Int>()
        idsToCancel.add(primaryId)

        // Also compute deterministic baseId (both modulo 600M and raw legacy hash) and 25 repeat IDs if reminderId is present
        if (reminderId.isNotEmpty()) {
            var hash = 0
            for (i in 0 until reminderId.length) {
                hash = (hash * 31 + reminderId[i].code) and 0x7fffffff
            }
            val modBaseId = (hash % 600000000) + 1
            val rawBaseId = if (hash == 0) 1 else hash
            for (bId in listOf(modBaseId, rawBaseId)) {
                idsToCancel.add(bId)
                for (index in 0 until 25) {
                    idsToCancel.add(((bId.toLong() + 1000L + index.toLong() + 1L) % 600000000L).toInt() + 1)
                    idsToCancel.add(((bId.toLong() + 1000L + index.toLong() + 1L) % 2147483647L).toInt())
                }
            }
        }

        // Check all saved notifications in storage for matching reminderId
        for (savedIdStr in storage.getSavedNotificationIds()) {
            val savedId = savedIdStr.toIntOrNull() ?: continue
            val savedJson = storage.getSavedNotificationAsJSObject(savedIdStr)
            val savedRemId = savedJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
            if (reminderId.isNotEmpty() && savedRemId == reminderId) {
                idsToCancel.add(savedId)
            }
        }

        // Also check active status bar notifications
        try {
            val sysNotifManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (sysNotifManager != null && reminderId.isNotEmpty()) {
                for (active in sysNotifManager.activeNotifications) {
                    val savedJson = storage.getSavedNotificationAsJSObject(active.id.toString())
                    val savedRemId = savedJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                    if (savedRemId == reminderId) {
                        idsToCancel.add(active.id)
                    }
                }
            }
        } catch (e: Exception) {
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        var flags = PendingIntent.FLAG_NO_CREATE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }

        val prefs = context.getSharedPreferences("YAAD_BG_NOTIFICATION_ACTIONS", Context.MODE_PRIVATE)
        val prefsEditor = prefs.edit()

        for (id in idsToCancel) {
            notificationManager.cancel(id)
            prefsEditor.remove("swipe_count_\$id")
            val alarmIntent = Intent(context, TimedNotificationPublisher::class.java)
            val pi = PendingIntent.getBroadcast(context, id, alarmIntent, flags)
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
            val muteIntent = Intent(context, NotificationDismissReceiver::class.java)
            val mutePi = PendingIntent.getBroadcast(context, id + 500000, muteIntent, flags)
            if (mutePi != null) {
                alarmManager.cancel(mutePi)
                mutePi.cancel()
            }
            storage.deleteNotification(id.toString())
        }
        prefsEditor.apply()
    }
}
`;

// 6b. Patch LocalNotificationRestoreReceiver.kt to also restore YaadGeofenceService on boot / package update / service restart
// and reconcile scheduled reminder timestamps when the phone's timezone or clock changes (travel / DST stability)
const restoreReceiverPath = path.join(pluginDir, 'LocalNotificationRestoreReceiver.kt');
const restoreReceiverContent = `package com.capacitorjs.plugins.localnotifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.UserManager
import com.getcapacitor.CapConfig
import java.util.Date
import java.util.TimeZone

class LocalNotificationRestoreReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == YaadAlarmPopupActivity.ACTION_ALARM_CLOCK_LAUNCH_POPUP) {
            try {
                YaadAlarmPopupActivity.launchFromAlarmBroadcast(context.applicationContext, intent)
            } catch (e: Exception) {
            }
            return
        }
        try {
            YaadGeofenceService.ensureServiceState(context.applicationContext)
        } catch (e: Exception) {
        }
        if (intent.action == YaadGeofenceService.ACTION_RESTART_GEOFENCE_SERVICE) {
            return
        }

        val um = context.getSystemService(UserManager::class.java)
        if (um == null || !um.isUserUnlocked) return

        val isTimeOrTzChange =
            intent.action == Intent.ACTION_TIMEZONE_CHANGED ||
            intent.action == Intent.ACTION_TIME_CHANGED

        val storage = NotificationStorage(context)
        val ids = storage.getSavedNotificationIds()
        val currentTz = TimeZone.getDefault()

        val notifications = ArrayList<LocalNotification>(ids.size)
        val updatedNotifications = ArrayList<LocalNotification>()
        for (id in ids) {
            val notification = storage.getSavedNotification(id) ?: continue
            val savedJsObj = storage.getSavedNotificationAsJSObject(id)
            val extraObj = savedJsObj?.optJSONObject("extra")
            if (extraObj?.optBoolean("isRepeat", false) == true) {
                storage.deleteNotification(id)
                continue
            }

            val schedule = notification.schedule
            if (schedule == null) {
                // Never restore schedule-less notifications on boot/time change (prevents spurious ghost notifications!)
                storage.deleteNotification(id)
                continue
            }
            if (schedule.isPerpetual() && notification.cancelled) {
                storage.deleteNotification(id)
                continue
            }
            if (!schedule.isPerpetual() && notification.isTriggered()) {
                storage.deleteNotification(id)
                continue
            }
            var at = schedule.at
            if (at == null) {
                if (!schedule.isPerpetual()) {
                    storage.deleteNotification(id)
                    continue
                }
            } else {
                // Reconcile local wall-clock hour when user travels across timezones or DST changes
                if (savedJsObj != null && extraObj != null && extraObj.has("scheduledTzOffsetMinutes")) {
                    val savedOffsetMins = extraObj.optInt("scheduledTzOffsetMinutes", Int.MIN_VALUE)
                    if (savedOffsetMins != Int.MIN_VALUE) {
                        val currentOffsetMins = currentTz.getOffset(at.time) / 60000
                        val deltaMins = savedOffsetMins - currentOffsetMins
                        if (deltaMins != 0) {
                            val shiftedMs = at.time + (deltaMins.toLong() * 60_000L)
                            at = Date(shiftedMs)
                            schedule.at = at
                            notification.schedule = schedule
                            extraObj.put("scheduledTzOffsetMinutes", currentOffsetMins)
                            extraObj.put("scheduledTimeZone", currentTz.id)
                            savedJsObj.put("extra", extraObj)
                            val schedJsObj = savedJsObj.optJSONObject("schedule")
                            if (schedJsObj != null) {
                                val sdfUtc = java.text.SimpleDateFormat(LocalNotificationSchedule.JS_DATE_FORMAT, java.util.Locale.US)
                                sdfUtc.timeZone = TimeZone.getTimeZone("UTC")
                                schedJsObj.put("at", sdfUtc.format(at))
                                savedJsObj.put("schedule", schedJsObj)
                            }
                            notification.source = savedJsObj.toString()
                            updatedNotifications.add(notification)
                        }
                    }
                }

                // Never fire expired past notifications on boot or time change!
                if (at.before(Date())) {
                    storage.deleteNotification(id)
                    continue
                }
            }

            notifications.add(notification)
        }

        if (updatedNotifications.isNotEmpty()) {
            storage.appendNotifications(updatedNotifications)
        }

        val config = CapConfig.loadDefault(context)
        val localNotificationManager = LocalNotificationManager(storage, null, context, config)
        localNotificationManager.schedule(null, notifications)
    }
}
`;

// 7. Patch LocalNotificationsPlugin.kt to add:
// - Permission aliases (microphone, camera, location) & full Android OS permission checking (display, microphone, camera, location, storage)
// - Stale notification purge on load() before LegacyNotificationMigrator runs
// - Cold-start launch intent handling so tapping "Edit" button when app is closed still delivers localNotificationActionPerformed
// - fireActionPerformed, handleOnResume flush, and deduplicated background action queue
const pluginPath = path.join(pluginDir, 'LocalNotificationsPlugin.kt');
let pluginContent = fs.readFileSync(pluginPath, 'utf8');

const origPluginAnnotation = `@CapacitorPlugin(
    name = "LocalNotifications",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = LocalNotificationsPlugin.LOCAL_NOTIFICATIONS)
    ]
)`;

const patchedPluginAnnotation = `@CapacitorPlugin(
    name = "LocalNotifications",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = LocalNotificationsPlugin.LOCAL_NOTIFICATIONS),
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION], alias = "location")
    ]
)`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  '@CapacitorPlugin permissions aliases (microphone, camera, location)',
  origPluginAnnotation,
  patchedPluginAnnotation,
  'Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")'
);

const origPluginLoad = `        LegacyNotificationMigrator.run(context, notificationStorage, manager)
    }`;

const legacyPluginLoad = `        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV2 = `        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV3 = `        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV4 = `        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV5 = `        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV6 = `        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV7 = `        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV8 = `        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV9 = `        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private inner class YaadNativeAudioBridge(private val appContext: Context) {
        @android.webkit.JavascriptInterface
        fun setMicListeningMute(muted: Boolean) {
            setMicListeningMuteState(appContext, muted)
        }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
                try {
                    wv.removeJavascriptInterface("YaadNativeAudioBridge")
                } catch (e: Exception) {
                }
                wv.addJavascriptInterface(YaadNativeAudioBridge(context.applicationContext), "YaadNativeAudioBridge")
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
        setMicListeningMuteState(context, false)
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV10 = `        // YAAD clean foreground state & WebView configuration
        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV11 = `        // YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge
        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
                try {
                    wv.removeJavascriptInterface("YaadGeofenceBridge")
                } catch (e: Exception) {
                }
                wv.addJavascriptInterface(object {
                    @android.webkit.JavascriptInterface
                    fun syncGeofences(payloadJson: String) {
                        YaadGeofenceService.updateConfigAndSyncService(context.applicationContext, payloadJson)
                    }
                }, "YaadGeofenceBridge")
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
        YaadGeofenceService.ensureServiceState(context)
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV12 = `        // YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge v2
        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                wv.setBackgroundColor(android.graphics.Color.parseColor("#07070D"))
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
                try {
                    wv.removeJavascriptInterface("YaadGeofenceBridge")
                } catch (e: Exception) {
                }
                wv.addJavascriptInterface(YaadGeofenceService.JsBridge(context.applicationContext), "YaadGeofenceBridge")
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val savedJs = notificationStorage.getSavedNotificationAsJSObject(id.toString())
                if (savedJs?.optJSONObject("extra")?.optBoolean("isRepeat", false) == true) {
                    notificationStorage.deleteNotification(id.toString())
                    continue
                }
                val sched = n.schedule
                if (sched == null) {
                    notificationStorage.deleteNotification(id.toString())
                    continue
                }
                val atDate = sched.at
                if (atDate == null) {
                    if (!sched.isPerpetual()) {
                        notificationStorage.deleteNotification(id.toString())
                    }
                    continue
                }
                if (!sched.isPerpetual() && atDate.time < now) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
        YaadGeofenceService.ensureServiceState(context)
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const patchedPluginLoad = `        // YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge v3
        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                wv.setBackgroundColor(android.graphics.Color.parseColor("#07070D"))
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
                try {
                    wv.removeJavascriptInterface("YaadGeofenceBridge")
                } catch (e: Exception) {
                }
                wv.addJavascriptInterface(YaadGeofenceService.JsBridge(context.applicationContext), "YaadGeofenceBridge")
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val savedJs = notificationStorage.getSavedNotificationAsJSObject(id.toString())
                if (savedJs?.optJSONObject("extra")?.optBoolean("isRepeat", false) == true) {
                    notificationStorage.deleteNotification(id.toString())
                    continue
                }
                val sched = n.schedule
                if (sched == null) {
                    notificationStorage.deleteNotification(id.toString())
                    continue
                }
                val atDate = sched.at
                if (atDate == null) {
                    if (!sched.isPerpetual()) {
                        notificationStorage.deleteNotification(id.toString())
                    }
                    continue
                }
                if (!sched.isPerpetual() && atDate.time < now) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
        YaadGeofenceService.onAppForegrounded(context)
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
        YaadGeofenceService.onAppBackgrounded(context)
    }

    override fun handleOnStop() {
        super.handleOnStop()
        isAppInForegroundState = false
        YaadGeofenceService.onAppBackgrounded(context)
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

const legacyPluginLoadV12b = `        // YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge v2
        isAppInForegroundState = true
        configureWebViewForGoogleOAuth()
        purgeStaleOneShotNotifications()
        LegacyNotificationMigrator.run(context, notificationStorage, manager)
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
        activity?.intent?.let { handleOnNewIntent(it) }
    }

    private fun configureWebViewForGoogleOAuth() {
        try {
            activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
            val wv = bridge?.webView
            if (wv != null) {
                val ua = wv.settings.userAgentString ?: ""
                if (ua.contains("; wv") || ua.contains("Version/")) {
                    wv.settings.userAgentString = ua
                        .replace("; wv", "")
                        .replace(Regex("Version/\\\\d+\\\\.\\\\d+\\\\s*"), "")
                }
                wv.settings.javaScriptCanOpenWindowsAutomatically = true
                wv.settings.mediaPlaybackRequiresUserGesture = false
                try {
                    wv.removeJavascriptInterface("YaadGeofenceBridge")
                } catch (e: Exception) {
                }
                wv.addJavascriptInterface(YaadGeofenceService.JsBridge(context.applicationContext), "YaadGeofenceBridge")
            }
        } catch (e: Exception) {
        }
    }

    private fun purgeStaleOneShotNotifications() {
        try {
            val now = System.currentTimeMillis()
            for (n in notificationStorage.getSavedNotifications()) {
                val id = n.id ?: continue
                val sched = n.schedule ?: continue
                val atDate = sched.at ?: continue
                if (!sched.isPerpetual() && atDate.time < now - 60000L) {
                    notificationStorage.deleteNotification(id.toString())
                }
            }
        } catch (e: Exception) {
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isAppInForegroundState = true
        activity?.volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION
        flushQueuedBackgroundActions()
        YaadGeofenceService.ensureServiceState(context)
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isAppInForegroundState = false
        YaadGeofenceService.ensureServiceState(context)
    }

    private fun flushQueuedBackgroundActions() {
        try {
            val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(BG_ACTION_KEY, null) ?: return
            prefs.edit().remove(BG_ACTION_KEY).apply()
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val itemStr = arr.optString(i, null) ?: continue
                val itemJson = JSObject(itemStr)
                notifyListeners("localNotificationActionPerformed", itemJson, true)
            }
        } catch (e: Exception) {
        }
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'load configureWebViewForGoogleOAuth, foreground state tracking, STREAM_NOTIFICATION volume stream, mediaPlaybackRequiresUserGesture, purgeStaleOneShotNotifications, cold-start launch intent, handleOnResume flushQueuedBackgroundActions, and YaadGeofenceBridge',
  origPluginLoad,
  patchedPluginLoad,
  '// YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge v3',
  [legacyPluginLoadV12, legacyPluginLoadV12b, legacyPluginLoad, legacyPluginLoadV2, legacyPluginLoadV3, legacyPluginLoadV4, legacyPluginLoadV5, legacyPluginLoadV6, legacyPluginLoadV7, legacyPluginLoadV8, legacyPluginLoadV9, legacyPluginLoadV10, legacyPluginLoadV11]
);

const origHandleOnNewIntent = `    override fun handleOnNewIntent(data: Intent) {
        super.handleOnNewIntent(data)
        if (Intent.ACTION_MAIN != data.action) {
            return
        }
        val dataJson = manager.handleNotificationActionPerformed(data, notificationStorage)
        if (dataJson != null) {
            notifyListeners("localNotificationActionPerformed", dataJson, true)
        }
    }`;

const legacyHandleOnNewIntentV1 = `    override fun handleOnNewIntent(data: Intent) {
        super.handleOnNewIntent(data)
        if (Intent.ACTION_MAIN != data.action) {
            return
        }
        if (data.getBooleanExtra("yaad_handled_launch_intent", false)) {
            return
        }
        data.putExtra("yaad_handled_launch_intent", true)
        val dataJson = manager.handleNotificationActionPerformed(data, notificationStorage)
        if (dataJson != null) {
            notifyListeners("localNotificationActionPerformed", dataJson, true)
        }
    }`;

const patchedHandleOnNewIntent = `    override fun handleOnNewIntent(data: Intent) {
        super.handleOnNewIntent(data)
        val hasNotifExtra = data.hasExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY)
        if (Intent.ACTION_MAIN != data.action && !hasNotifExtra) {
            return
        }
        if (hasNotifExtra) {
            bridge?.webView?.post {
                try {
                    bridge?.webView?.evaluateJavascript("window.__yaadOpenedFromNotification = true;", null)
                } catch (e: Exception) {
                }
            }
        }
        if (data.getBooleanExtra("yaad_handled_launch_intent", false)) {
            return
        }
        data.putExtra("yaad_handled_launch_intent", true)
        val dataJson = manager.handleNotificationActionPerformed(data, notificationStorage)
        if (dataJson != null) {
            notifyListeners("localNotificationActionPerformed", dataJson, true)
        }
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'handleOnNewIntent deduplication guard and __yaadOpenedFromNotification flag',
  origHandleOnNewIntent,
  patchedHandleOnNewIntent,
  'window.__yaadOpenedFromNotification = true;',
  [legacyHandleOnNewIntentV1]
);

const origPermissionsBlock = `    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            val permissionsResultJSON = JSObject()
            permissionsResultJSON.put("display", getNotificationPermissionText())
            call.resolve(permissionsResultJSON)
        } else {
            super.checkPermissions(call)
        }
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            val permissionsResultJSON = JSObject()
            permissionsResultJSON.put("display", getNotificationPermissionText())
            call.resolve(permissionsResultJSON)
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

const patchedPermissionsBlock = `    private fun buildAllPermissionsJSON(): JSObject {
        val permissionsResultJSON = JSObject()
        val notifEnabled = manager.areNotificationsEnabled() && (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        )
        permissionsResultJSON.put("display", if (notifEnabled) "granted" else "denied")
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("microphone", if (micGranted) "granted" else "denied")

        val camGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("camera", if (camGranted) "granted" else "denied")

        val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("location", if (locGranted) "granted" else "denied")

        // Strict storage check: on Android 11+ (API 30+), creating backup folder in shared storage requires All Files Access
        val storageGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.os.Environment.isExternalStorageManager()
        } else {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        permissionsResultJSON.put("storage", if (storageGranted) "granted" else "denied")
        return permissionsResultJSON
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildAllPermissionsJSON())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")
        if (requested != null && requested.length() > 0) {
            val firstAlias = requested.optString(0, LOCAL_NOTIFICATIONS)
            if (firstAlias == "microphone" || firstAlias == "camera" || firstAlias == "location") {
                if (getPermissionState(firstAlias) == PermissionState.GRANTED) {
                    call.resolve(buildAllPermissionsJSON())
                } else {
                    requestPermissionForAlias(firstAlias, call, "permissionsCallback")
                }
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(buildAllPermissionsJSON())
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

const legacyPermissionsBlockV2 = `    private fun buildAllPermissionsJSON(): JSObject {
        val permissionsResultJSON = JSObject()
        permissionsResultJSON.put("display", getNotificationPermissionText())
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("microphone", if (micGranted) "granted" else "denied")

        val camGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("camera", if (camGranted) "granted" else "denied")

        val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("location", if (locGranted) "granted" else "denied")

        val storageGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.os.Environment.isExternalStorageManager() ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    androidx.core.content.ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.READ_MEDIA_IMAGES
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED)
        } else {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        permissionsResultJSON.put("storage", if (storageGranted) "granted" else "denied")
        return permissionsResultJSON
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildAllPermissionsJSON())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")
        if (requested != null && requested.length() > 0) {
            val firstAlias = requested.optString(0, LOCAL_NOTIFICATIONS)
            if (firstAlias == "microphone" || firstAlias == "camera" || firstAlias == "location") {
                if (getPermissionState(firstAlias) == PermissionState.GRANTED) {
                    call.resolve(buildAllPermissionsJSON())
                } else {
                    requestPermissionForAlias(firstAlias, call, "permissionsCallback")
                }
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(buildAllPermissionsJSON())
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

const legacyPermissionsBlockV1 = `    private fun buildAllPermissionsJSON(): JSObject {
        val permissionsResultJSON = JSObject()
        permissionsResultJSON.put("display", getNotificationPermissionText())
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("microphone", if (micGranted) "granted" else "denied")

        val camGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("camera", if (camGranted) "granted" else "denied")

        val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissionsResultJSON.put("location", if (locGranted) "granted" else "denied")

        val storageGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.os.Environment.isExternalStorageManager()
        } else {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        permissionsResultJSON.put("storage", if (storageGranted) "granted" else "denied")
        return permissionsResultJSON
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildAllPermissionsJSON())
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val requested = call.getArray("permissions")
        if (requested != null && requested.length() > 0) {
            val firstAlias = requested.optString(0, LOCAL_NOTIFICATIONS)
            if (firstAlias == "microphone" || firstAlias == "camera" || firstAlias == "location") {
                requestPermissionForAlias(firstAlias, call, "permissionsCallback")
                return
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(LOCAL_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(buildAllPermissionsJSON())
        } else {
            requestPermissionForAlias(LOCAL_NOTIFICATIONS, call, "permissionsCallback")
        }
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'checkPermissions and requestPermissions for all app permissions',
  origPermissionsBlock,
  patchedPermissionsBlock,
  '// Strict storage check: on Android 11+ (API 30+), creating backup folder in shared storage requires All Files Access',
  [legacyPermissionsBlockV1, legacyPermissionsBlockV2]
);

const origPermCallback = `    @PermissionCallback
    private fun permissionsCallback(call: PluginCall) {
        val permissionsResultJSON = JSObject()
        permissionsResultJSON.put("display", getNotificationPermissionText())
        call.resolve(permissionsResultJSON)
    }`;

const patchedPermCallback = `    @PermissionCallback
    private fun permissionsCallback(call: PluginCall) {
        // Resolve all native permissions status after dialog
        call.resolve(buildAllPermissionsJSON())
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'permissionsCallback returning buildAllPermissionsJSON',
  origPermCallback,
  patchedPermCallback,
  '// Resolve all native permissions status after dialog'
);

const origDispatchReceived = `    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }`;

const legacyDispatchReceived = `    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }

    internal fun dispatchActionPerformed(dataJson: JSObject) {
        notifyListeners("localNotificationActionPerformed", dataJson, true)
    }`;

const legacyDispatchReceivedV2 = `    @PluginMethod
    fun playNotificationSound(call: PluginCall) {
        val soundName = call.getString("sound", "digital_beep.wav") ?: "digital_beep.wav"
        val loop = call.getBoolean("loop", false) ?: false
        try {
            stopActiveMediaPlayer()
            val cleanName = soundName.substringBeforeLast(".")
            val resId = context.resources.getIdentifier(cleanName, "raw", context.packageName)
            val mp = android.media.MediaPlayer()
            val attrs = android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            mp.setAudioAttributes(attrs)
            if (resId != 0) {
                val afd = context.resources.openRawResourceFd(resId)
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            } else {
                val afd = context.assets.openFd("public/sounds/\$soundName")
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            }
            mp.isLooping = loop
            mp.setOnCompletionListener { player ->
                try {
                    player.release()
                } catch (e: Exception) {
                }
                if (activeMediaPlayer === player) {
                    activeMediaPlayer = null
                }
            }
            mp.prepare()
            mp.start()
            activeMediaPlayer = mp
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to play notification sound: \${e.message}")
        }
    }

    @PluginMethod
    fun stopNotificationSound(call: PluginCall) {
        stopActiveMediaPlayer()
        call.resolve()
    }

    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }

    internal fun dispatchActionPerformed(dataJson: JSObject) {
        notifyListeners("localNotificationActionPerformed", dataJson, true)
    }`;

const legacyDispatchReceivedV3 = `    @PluginMethod
    fun setMicListeningMute(call: PluginCall) {
        val muted = call.getBoolean("muted", false) ?: false
        setMicListeningMuteState(context, muted)
        call.resolve()
    }

    @PluginMethod
    fun playNotificationSound(call: PluginCall) {
        val soundName = call.getString("sound", "digital_beep.wav") ?: "digital_beep.wav"
        val loop = call.getBoolean("loop", false) ?: false
        try {
            setMicListeningMuteState(context, false)
            stopActiveMediaPlayer()
            val cleanName = soundName.substringBeforeLast(".")
            val resId = context.resources.getIdentifier(cleanName, "raw", context.packageName)
            val mp = android.media.MediaPlayer()
            val attrs = android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            mp.setAudioAttributes(attrs)
            if (resId != 0) {
                val afd = context.resources.openRawResourceFd(resId)
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            } else {
                val afd = context.assets.openFd("public/sounds/\$soundName")
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            }
            mp.isLooping = loop
            mp.setOnCompletionListener { player ->
                try {
                    player.release()
                } catch (e: Exception) {
                }
                if (activeMediaPlayer === player) {
                    activeMediaPlayer = null
                }
            }
            mp.prepare()
            mp.start()
            activeMediaPlayer = mp
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to play notification sound: \${e.message}")
        }
    }

    @PluginMethod
    fun stopNotificationSound(call: PluginCall) {
        stopActiveMediaPlayer()
        call.resolve()
    }

    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }

    internal fun dispatchActionPerformed(dataJson: JSObject) {
        notifyListeners("localNotificationActionPerformed", dataJson, true)
    }`;

const legacyDispatchReceivedV4 = `    @PluginMethod
    fun playNotificationSound(call: PluginCall) {
        val soundName = call.getString("sound", "digital_beep.wav") ?: "digital_beep.wav"
        val loop = call.getBoolean("loop", false) ?: false
        try {
            // Ensure no status-bar notification sound overlaps with in-app alarm sound
            try {
                androidx.core.app.NotificationManagerCompat.from(context).cancelAll()
            } catch (e: Exception) {
            }
            stopActiveMediaPlayer()
            val cleanName = soundName.substringBeforeLast(".")
            val resId = context.resources.getIdentifier(cleanName, "raw", context.packageName)
            val mp = android.media.MediaPlayer()
            val attrs = android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            mp.setAudioAttributes(attrs)
            if (resId != 0) {
                val afd = context.resources.openRawResourceFd(resId)
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            } else {
                val afd = context.assets.openFd("public/sounds/\$soundName")
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            }
            mp.isLooping = loop
            mp.setOnCompletionListener { player ->
                try {
                    player.release()
                } catch (e: Exception) {
                }
                if (activeMediaPlayer === player) {
                    activeMediaPlayer = null
                }
            }
            mp.prepare()
            mp.start()
            activeMediaPlayer = mp
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to play notification sound: \${e.message}")
        }
    }

    @PluginMethod
    fun stopNotificationSound(call: PluginCall) {
        stopActiveMediaPlayer()
        call.resolve()
    }

    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }

    internal fun dispatchActionPerformed(dataJson: JSObject) {
        notifyListeners("localNotificationActionPerformed", dataJson, true)
    }`;

const patchedDispatchReceived = `    @PluginMethod
    fun playNotificationSound(call: PluginCall) {
        val soundName = call.getString("sound", "digital_beep.wav") ?: "digital_beep.wav"
        val loop = call.getBoolean("loop", false) ?: false
        val volume = (call.getFloat("volume", 1.0f) ?: 1.0f).coerceIn(0f, 1f)
        try {
            if (loop) {
                // Ensure no status-bar notification sound overlaps with in-app alarm sound
                try {
                    androidx.core.app.NotificationManagerCompat.from(context).cancelAll()
                } catch (e: Exception) {
                }
            }
            stopActiveMediaPlayer()
            val cleanName = soundName.substringBeforeLast(".")
            val resId = context.resources.getIdentifier(cleanName, "raw", context.packageName)
            val mp = android.media.MediaPlayer()
            val am = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
            val notifVol = am?.getStreamVolume(android.media.AudioManager.STREAM_NOTIFICATION) ?: 1
            val useMediaStream = !loop || notifVol <= 0
            val attrs = android.media.AudioAttributes.Builder()
                .setUsage(if (useMediaStream) android.media.AudioAttributes.USAGE_MEDIA else android.media.AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(if (useMediaStream) android.media.AudioAttributes.CONTENT_TYPE_MUSIC else android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            mp.setAudioAttributes(attrs)
            if (resId != 0) {
                val afd = context.resources.openRawResourceFd(resId)
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            } else {
                val afd = try {
                    context.assets.openFd("public/\$soundName")
                } catch (e: Exception) {
                    context.assets.openFd("public/sounds/\$soundName")
                }
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            }
            mp.setVolume(volume, volume)
            mp.isLooping = loop
            mp.setOnCompletionListener { player ->
                try {
                    player.release()
                } catch (e: Exception) {
                }
                if (activeMediaPlayer === player) {
                    activeMediaPlayer = null
                }
            }
            mp.prepare()
            mp.start()
            activeMediaPlayer = mp
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to play notification sound: \${e.message}")
        }
    }

    @PluginMethod
    fun stopNotificationSound(call: PluginCall) {
        stopActiveMediaPlayer()
        call.resolve()
    }

    internal fun dispatchReceived(notification: JSObject?) {
        notifyListeners("localNotificationReceived", notification, true)
    }

    internal fun dispatchActionPerformed(dataJson: JSObject) {
        notifyListeners("localNotificationActionPerformed", dataJson, true)
    }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'playNotificationSound, stopNotificationSound, and dispatchActionPerformed',
  origDispatchReceived,
  patchedDispatchReceived,
  'val useMediaStream = !loop || notifVol <= 0',
  [legacyDispatchReceived, legacyDispatchReceivedV2, legacyDispatchReceivedV3, legacyDispatchReceivedV4]
);

const origCompanionFire = `        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }`;

const legacyCompanionFire = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            if (instance != null) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                arr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, arr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV2 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV3 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV4 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        private var isAppInForegroundState: Boolean = false

        fun isAppInForeground(context: Context): Boolean {
            if (!isAppInForegroundState) return false
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV5 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        private var isAppInForegroundState: Boolean = false
        private var isMicListeningMuted: Boolean = false

        @Synchronized
        fun setMicListeningMuteState(context: Context, muted: Boolean) {
            try {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return
                if (muted && !isMicListeningMuted) {
                    isMicListeningMuted = true
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        try {
                            am.adjustStreamVolume(
                                android.media.AudioManager.STREAM_NOTIFICATION,
                                android.media.AudioManager.ADJUST_MUTE,
                                0
                            )
                        } catch (e: Exception) {
                        }
                        try {
                            am.adjustStreamVolume(
                                android.media.AudioManager.STREAM_SYSTEM,
                                android.media.AudioManager.ADJUST_MUTE,
                                0
                            )
                        } catch (e: Exception) {
                        }
                        try {
                            am.adjustStreamVolume(
                                android.media.AudioManager.STREAM_MUSIC,
                                android.media.AudioManager.ADJUST_MUTE,
                                0
                            )
                        } catch (e: Exception) {
                        }
                    }
                } else if (!muted && isMicListeningMuted) {
                    isMicListeningMuted = false
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        try {
                            am.adjustStreamVolume(
                                android.media.AudioManager.STREAM_NOTIFICATION,
                                android.media.AudioManager.ADJUST_UNMUTE,
                                0
                            )
                        } catch (e: Exception) {
                        }
                        try {
                            am.adjustStreamVolume(
                                android.media.AudioManager.STREAM_SYSTEM,
                                android.media.AudioManager.ADJUST_UNMUTE,
                                0
                            )
                        } catch (e: Exception) {
                        }
                        try {
                            am.adjustStreamVolume(
                                android.media.AudioManager.STREAM_MUSIC,
                                android.media.AudioManager.ADJUST_UNMUTE,
                                0
                            )
                        } catch (e: Exception) {
                        }
                    }
                }
            } catch (e: Exception) {
            }
        }

        fun isAppInForeground(context: Context): Boolean {
            if (!isAppInForegroundState) return false
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV6 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        private var isAppInForegroundState: Boolean = false
        private var isMicListeningMuted: Boolean = false
        private val savedMicMuteStreamVolumes = HashMap<Int, Int>()
        private val micMuteTargetStreams = intArrayOf(
            android.media.AudioManager.STREAM_MUSIC,
            android.media.AudioManager.STREAM_NOTIFICATION,
            android.media.AudioManager.STREAM_SYSTEM,
            android.media.AudioManager.STREAM_RING,
            android.media.AudioManager.STREAM_DTMF
        )

        @Synchronized
        fun setMicListeningMuteState(context: Context, muted: Boolean) {
            try {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return
                if (muted) {
                    if (!isMicListeningMuted) {
                        isMicListeningMuted = true
                        savedMicMuteStreamVolumes.clear()
                        for (stream in micMuteTargetStreams) {
                            try {
                                val currentVol = am.getStreamVolume(stream)
                                savedMicMuteStreamVolumes[stream] = currentVol
                            } catch (e: Exception) {
                            }
                        }
                    }
                    for (stream in micMuteTargetStreams) {
                        try {
                            am.setStreamVolume(stream, 0, 0)
                        } catch (e: Exception) {
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            try {
                                am.adjustStreamVolume(
                                    stream,
                                    android.media.AudioManager.ADJUST_MUTE,
                                    0
                                )
                            } catch (e: Exception) {
                            }
                        }
                    }
                } else if (!muted && isMicListeningMuted) {
                    isMicListeningMuted = false
                    for (stream in micMuteTargetStreams) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            try {
                                am.adjustStreamVolume(
                                    stream,
                                    android.media.AudioManager.ADJUST_UNMUTE,
                                    0
                                )
                            } catch (e: Exception) {
                            }
                        }
                        try {
                            val savedVol = savedMicMuteStreamVolumes[stream]
                            if (savedVol != null && savedVol > 0) {
                                am.setStreamVolume(stream, savedVol, 0)
                            }
                        } catch (e: Exception) {
                        }
                    }
                    savedMicMuteStreamVolumes.clear()
                }
            } catch (e: Exception) {
            }
        }

        fun isAppInForeground(context: Context): Boolean {
            if (!isAppInForegroundState) return false
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV7 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        private var isAppInForegroundState: Boolean = false

        fun isAppInForeground(context: Context): Boolean {
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            if (!isAppInForegroundState && !act.hasWindowFocus()) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV8 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        private var isAppInForegroundState: Boolean = false

        fun isAppInForeground(context: Context): Boolean {
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            if (!isAppInForegroundState && !act.hasWindowFocus()) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun evaluateJsInWebView(jsCode: String) {
            try {
                val instance = getLocalNotificationsInstance() ?: return
                val wv = instance.bridge?.webView ?: return
                wv.post {
                    try {
                        wv.evaluateJavascript(jsCode, null)
                    } catch (e: Exception) {
                    }
                }
            } catch (e: Exception) {
            }
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const legacyCompanionFireV9 = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        @Volatile
        private var isAppInForegroundState: Boolean = false

        fun onAppTaskRemoved() {
            isAppInForegroundState = false
        }

        fun isAppInForeground(context: Context): Boolean {
            if (!isAppInForegroundState) return false
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun evaluateJsInWebView(jsCode: String) {
            try {
                val instance = getLocalNotificationsInstance() ?: return
                val wv = instance.bridge?.webView ?: return
                wv.post {
                    try {
                        wv.evaluateJavascript(jsCode, null)
                    } catch (e: Exception) {
                    }
                }
            } catch (e: Exception) {
            }
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

const patchedCompanionFire = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
        private const val BG_ACTION_KEY = "queued_actions"
        private var activeMediaPlayer: android.media.MediaPlayer? = null
        @Volatile
        private var isAppInForegroundState: Boolean = false

        fun onAppTaskRemoved() {
            isAppInForegroundState = false
        }

        fun isAppInForeground(context: Context): Boolean {
            if (!isAppInForegroundState) return false
            if (YaadAlarmPopupActivity.isShowingAnyPopup()) return false
            if (YaadGeofenceService.isScreenOffOrLockedStatic(context)) return false
            val instance = getLocalNotificationsInstance() ?: return false
            val act = instance.activity ?: return false
            if (act.isFinishing || act.isDestroyed) return false
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                if (pm != null && !pm.isInteractive) return false
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                if (km != null && km.isKeyguardLocked) return false
            } catch (e: Exception) {
            }
            return true
        }

        fun evaluateJsInWebView(jsCode: String) {
            try {
                val instance = getLocalNotificationsInstance() ?: return
                val wv = instance.bridge?.webView ?: return
                wv.post {
                    try {
                        wv.evaluateJavascript(jsCode, null)
                    } catch (e: Exception) {
                    }
                }
            } catch (e: Exception) {
            }
        }

        fun stopActiveMediaPlayer() {
            try {
                activeMediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.stop()
                    }
                    mp.release()
                }
            } catch (e: Exception) {
            } finally {
                activeMediaPlayer = null
            }
        }

        fun fireReceived(notification: JSObject?) {
            getLocalNotificationsInstance()?.dispatchReceived(notification)
        }

        fun fireActionPerformed(dataJson: JSObject): Boolean {
            val instance = getLocalNotificationsInstance()
            val act = instance?.activity
            if (instance != null && act != null && !act.isFinishing && !act.isDestroyed) {
                instance.dispatchActionPerformed(dataJson)
                return true
            }
            return false
        }

        fun queueBackgroundAction(context: Context, dataJson: JSObject) {
            try {
                val prefs = context.getSharedPreferences(BG_ACTION_PREFS, Context.MODE_PRIVATE)
                val existing = prefs.getString(BG_ACTION_KEY, "[]")
                val arr = JSONArray(existing)
                val newRemId = dataJson.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                val filteredArr = JSONArray()
                for (i in 0 until arr.length()) {
                    val itemStr = arr.optString(i, null) ?: continue
                    if (newRemId.isNotEmpty()) {
                        try {
                            val prevObj = JSObject(itemStr)
                            val prevRemId = prevObj.optJSONObject("notification")?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (prevRemId == newRemId) continue
                        } catch (e: Exception) {
                        }
                    }
                    filteredArr.put(itemStr)
                }
                filteredArr.put(dataJson.toString())
                prefs.edit().putString(BG_ACTION_KEY, filteredArr.toString()).apply()
            } catch (e: Exception) {
            }
        }`;

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'companion isAppInForeground, onAppTaskRemoved, evaluateJsInWebView, stopActiveMediaPlayer, fireActionPerformed, and deduplicated queueBackgroundAction',
  origCompanionFire,
  patchedCompanionFire,
  'if (YaadAlarmPopupActivity.isShowingAnyPopup()) return false',
  [legacyCompanionFireV9, legacyCompanionFireV8, legacyCompanionFire, legacyCompanionFireV2, legacyCompanionFireV3, legacyCompanionFireV4, legacyCompanionFireV5, legacyCompanionFireV6, legacyCompanionFireV7]
);

// 8. Create standalone YaadAlarmPopupActivity.kt (Out-of-app minimal theme-matched 1-minute notification card)
const popupActivityPath = path.join(pluginDir, 'YaadAlarmPopupActivity.kt');
const popupActivityContent = `package com.capacitorjs.plugins.localnotifications

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.CapConfig
import com.getcapacitor.JSObject
import java.lang.ref.WeakReference

/**
 * Standalone out-of-app minimal notification card that displays for 1 minute alongside the alarm
 * without opening the main YAAD app (unless the user explicitly clicks the "Edit" / "Open" button).
 * Supports both standard Reminders and distinct Submarine Radar Geofence alerts (with pulsing GPS logo).
 * Automatically yields to incoming/active phone calls and restores the full-screen alert after the call ends.
 */
class YaadAlarmPopupActivity : Activity() {

    private var notificationId: Int = Int.MIN_VALUE
    private var sourceJson: String? = null
    private var requestJson: JSObject? = null
    private var countDownTimer: CountDownTimer? = null
    private var remainingCountdownMillis: Long = 60_000L
    private var progressFillView: View? = null
    private var progressTrackView: FrameLayout? = null
    private var timerTextView: TextView? = null
    private var distanceBadgeTextView: TextView? = null
    private var livePolarRadarView: LivePolarRadarView? = null
    private var isPersian: Boolean = true
    private var isGeofencePopup: Boolean = false
    private var isSub10mArrival: Boolean = false
    private var geofenceItemId: String = ""
    private var targetLatitude: Double = Double.NaN
    private var targetLongitude: Double = Double.NaN
    private var cleanLocationTitle: String = ""
    private var sonarRingAnimator: ObjectAnimator? = null
    private var sonarOuterRingAnimator: ObjectAnimator? = null
    private var gpsPinPulseAnimator: ObjectAnimator? = null
    private var radarPulseAnimator: ValueAnimator? = null
    private var screenWakeLock: PowerManager.WakeLock? = null
    private var screenKeepAwakeDeadlineMs: Long = 0L
    private var lastKeepAwakeAppliedAtMs: Long = 0L
    private var launchedFromScreenOffMode: Boolean = false
    private val uiHandler = Handler(Looper.getMainLooper())
    private var hasContentViewSet: Boolean = false
    private var isYieldingForPhoneCall: Boolean = false
    private var isPhoneStateReceiverRegistered: Boolean = false
    private var audioModeListenerObj: Any? = null

    private val releaseScreenKeepAwakeRunnable = Runnable {
        expireScreenKeepAwakeWindowOnly()
    }

    private val phoneStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (action == TelephonyManager.ACTION_PHONE_STATE_CHANGED) {
                val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
                val isCallActiveNow = stateStr == TelephonyManager.EXTRA_STATE_RINGING ||
                    stateStr == TelephonyManager.EXTRA_STATE_OFFHOOK
                lastBroadcastCallActive = isCallActiveNow
                if (isCallActiveNow) {
                    suspendAndYieldForIncomingCall()
                }
            }
        }
    }

    private val activeCallWatchdogRunnable = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed || isYieldingForPhoneCall) return
            if (isPhoneCallActiveOrRinging(this@YaadAlarmPopupActivity)) {
                suspendAndYieldForIncomingCall()
                return
            }
            uiHandler.postDelayed(this, 250L)
        }
    }

    data class ThemePalette(
        val cardBg: Int,
        val cardBorder: Int,
        val titleColor: Int,
        val bodyColor: Int,
        val mutedColor: Int,
        val accentColor: Int,
        val doneBtnBg: Int,
        val doneBtnText: Int,
        val secondaryBtnBg: Int,
        val secondaryBtnBorder: Int,
        val secondaryBtnText: Int,
        val editBtnBg: Int,
        val editBtnBorder: Int,
        val editBtnText: Int
    )

    private data class NativePolarPoint(
        val distance: Int,
        val bearingDeg: Float
    )

    /**
     * Live Polar Trajectory Radar View matching the user's sketch:
     * - Top 'N' + Red Triangle ▲ North indicator
     * - Outer bright green geofence boundary circle with a top-left arc gap showing the radius ("5000 m")
     * - Central 5% target zone filled teal/cyan circle with bright green border + target name above it
     * - Live dotted trajectory trail with directional chevrons ('enter' in amber/gold, 'exit' in sky-blue)
     * - Moving pulsing golden Clock-Pin character icon at the user's live polar coordinate (d, θ)
     */
    private inner class LivePolarRadarView(
        context: Context,
        private var targetName: String,
        private var radiusMeters: Int,
        initialDist: Int,
        initialBearing: Float,
        private var radarMode: String,
        private var isVisualOnlyMode: Boolean
    ) : View(context) {

        private val trailPoints = ArrayList<NativePolarPoint>()
        var pulseProgress: Float = 0f
            set(value) {
                field = value
                invalidate()
            }

        private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.parseColor("#020806")
        }
        private val frameBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(1.4f).toFloat()
            color = Color.argb(95, 16, 185, 129)
        }
        private val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(1f).toFloat()
            color = Color.argb(34, 16, 185, 129)
        }
        private val boundaryPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(2.6f).toFloat()
            strokeCap = Paint.Cap.ROUND
            color = Color.parseColor("#22C55E")
        }
        private val centerFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.argb(210, 20, 184, 166)
        }
        private val centerStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(2.6f).toFloat()
            color = Color.parseColor("#22C55E")
        }
        private val northFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.parseColor("#EF4444")
        }
        private val northTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#EF4444")
            textAlign = Paint.Align.CENTER
            textSize = dp(13f).toFloat()
            typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        }
        private val radiusArcTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#4ADE80")
            textAlign = Paint.Align.CENTER
            textSize = dp(11.5f).toFloat()
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        }
        private val targetNamePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#C084FC")
            textAlign = Paint.Align.CENTER
            textSize = dp(11f).toFloat()
            typeface = Typeface.DEFAULT_BOLD
        }
        private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
        }
        private val chevronPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(2.1f).toFloat()
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val modeTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textAlign = Paint.Align.CENTER
            textSize = dp(11.5f).toFloat()
            typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        }
        private val pinBackdropPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.parseColor("#041512")
        }
        private val pinFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.parseColor("#FF8C00")
        }
        private val pinStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            color = Color.parseColor("#FF8C00")
        }
        private val wavePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(1.6f).toFloat()
            color = Color.parseColor("#FF8C00")
        }
        private val workPath = Path()
        private val arcRect = android.graphics.RectF()

        init {
            seedInitialTrail(initialDist, initialBearing)
        }

        private fun seedInitialTrail(dist: Int, bearing: Float) {
            trailPoints.clear()
            val safeR = radiusMeters.coerceAtLeast(20)
            val safeD = dist.coerceAtLeast(0)
            val isExit = radarMode == "exit" || radarMode == "both_exit"
            val anchorDist = if (isExit) (safeR * 0.03f).toInt().coerceAtLeast(2) else safeR
            val anchorBearing = if (isExit) (bearing + 195f) % 360f else (bearing + 332f) % 360f
            if (kotlin.math.abs(safeD - anchorDist) > (safeR * 0.06f).toInt().coerceAtLeast(5)) {
                val q1Dist = anchorDist + ((safeD - anchorDist) * 0.33f).toInt()
                val q2Dist = anchorDist + ((safeD - anchorDist) * 0.67f).toInt()
                val q1Bearing = if (isExit) (bearing + 340f) % 360f else (bearing + 342f) % 360f
                val q2Bearing = (bearing + 352f) % 360f
                trailPoints.add(NativePolarPoint(anchorDist, anchorBearing))
                trailPoints.add(NativePolarPoint(q1Dist, q1Bearing))
                trailPoints.add(NativePolarPoint(q2Dist, q2Bearing))
            }
            trailPoints.add(NativePolarPoint(safeD, bearing))
        }

        fun updateLiveState(
            newDist: Int,
            newRadius: Int,
            newBearing: Float,
            newMode: String,
            visualOnly: Boolean
        ) {
            val safeR = newRadius.coerceAtLeast(20)
            val safeD = newDist.coerceAtLeast(0)
            val modeChanged = (newMode == "exit" || newMode == "both_exit") != (radarMode == "exit" || radarMode == "both_exit")
            radiusMeters = safeR
            radarMode = newMode
            isVisualOnlyMode = visualOnly

            if (modeChanged || trailPoints.isEmpty()) {
                seedInitialTrail(safeD, newBearing)
                invalidate()
                return
            }

            val refOuterR = dp(150f).toFloat()
            val refCenterR = refOuterR * 0.145f
            val last = trailPoints.last()
            val lastPt = polarToPixel(last.distance, last.bearingDeg, 0f, 0f, refCenterR, refOuterR)
            val nextPt = polarToPixel(safeD, newBearing, 0f, 0f, refCenterR, refOuterR)
            val pixelStep = kotlin.math.hypot((nextPt.first - lastPt.first).toDouble(), (nextPt.second - lastPt.second).toDouble()).toFloat()

            if (pixelStep < dp(10f).toFloat()) {
                trailPoints[trailPoints.size - 1] = NativePolarPoint(safeD, newBearing)
            } else {
                trailPoints.add(NativePolarPoint(safeD, newBearing))
                while (trailPoints.size > 24) {
                    trailPoints.removeAt(0)
                }
            }
            invalidate()
        }

        private fun polarToPixel(
            distMeters: Int,
            bearingDeg: Float,
            cx: Float,
            cy: Float,
            centerR: Float,
            outerR: Float
        ): Pair<Float, Float> {
            val safeR = radiusMeters.coerceAtLeast(20).toFloat()
            val ratio = distMeters.coerceAtLeast(0).toFloat() / safeR
            val pixelR = when {
                ratio <= 0.05f -> (ratio / 0.05f) * (centerR * 0.45f)
                ratio <= 1.0f -> {
                    val t = (ratio - 0.05f) / 0.95f
                    centerR + t * (outerR - centerR)
                }
                else -> {
                    val extra = (ratio - 1.0f).coerceAtMost(0.08f)
                    outerR + (extra / 0.08f) * dp(5f).toFloat()
                }
            }
            val rad = Math.toRadians((bearingDeg - 90f).toDouble())
            val x = cx + (pixelR * kotlin.math.cos(rad)).toFloat()
            val y = cy + (pixelR * kotlin.math.sin(rad)).toFloat()
            return Pair(x, y)
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            val outerR = (w / 2f) - dp(6f).toFloat()
            val cx = w / 2f
            val cy = h - outerR - dp(6f).toFloat()
            val centerR = outerR * 0.145f

            // 0. Dark Radar Circle Background directly inside the Green Boundary Circle & Subtle Crosshairs
            canvas.drawCircle(cx, cy, outerR, bgPaint)
            canvas.drawCircle(cx, cy, (outerR + centerR) * 0.52f, guidePaint)
            canvas.drawLine(cx, cy - outerR, cx, cy + outerR, guidePaint)
            canvas.drawLine(cx - outerR, cy, cx + outerR, cy, guidePaint)

            // 1. North Indicator ('N' + Red Triangle ▲ directly above the green boundary circle)
            val northTopY = cy - outerR - dp(19f).toFloat()
            canvas.drawText("N", cx, northTopY, northTextPaint)
            workPath.reset()
            workPath.fillType = Path.FillType.WINDING
            val triTopY = northTopY + dp(2.5f).toFloat()
            val triBotY = triTopY + dp(12f).toFloat()
            val triHalfW = dp(7f).toFloat()
            workPath.moveTo(cx, triTopY)
            workPath.lineTo(cx - triHalfW, triBotY)
            workPath.lineTo(cx + triHalfW, triBotY)
            workPath.close()
            canvas.drawPath(workPath, northFillPaint)

            // 2. Outer Green Geofence Boundary Circle with Top-Left Arc Gap for Radius Label
            arcRect.set(cx - outerR, cy - outerR, cx + outerR, cy + outerR)
            canvas.drawArc(arcRect, 244f, 324f, false, boundaryPaint)

            val safeRadVal = radiusMeters.coerceAtLeast(20)
            val radLabel = if (isPersian) "\${toPersianDigits(safeRadVal.toString())} متر" else "\${safeRadVal} m"
            val midAngleRad = Math.toRadians(226.0)
            val lblX = cx + (outerR * kotlin.math.cos(midAngleRad)).toFloat()
            val lblY = cy + (outerR * kotlin.math.sin(midAngleRad)).toFloat()
            canvas.save()
            canvas.translate(lblX, lblY)
            canvas.rotate(-44f)
            canvas.drawText(radLabel, 0f, dp(4f).toFloat(), radiusArcTextPaint)
            canvas.restore()

            // 3. Central 5% Target Zone Circle + Target Name above it
            canvas.drawCircle(cx, cy, centerR, centerFillPaint)
            canvas.drawCircle(cx, cy, centerR, centerStrokePaint)
            val shortTitle = if (targetName.length > 20) targetName.take(20) + "…" else targetName
            canvas.drawText(shortTitle, cx, cy - centerR - dp(6f).toFloat(), targetNamePaint)

            // 4. Live Dotted Trajectory Trail + Directional Chevrons + Arc-Length Midpoint Label
            val isExit = radarMode == "exit" || radarMode == "both_exit"
            val trailColor = if (isExit) Color.parseColor("#38BDF8") else Color.parseColor("#FBBF24")
            dotPaint.color = trailColor
            chevronPaint.color = trailColor
            modeTextPaint.color = trailColor

            val xyList = trailPoints.map { polarToPixel(it.distance, it.bearingDeg, cx, cy, centerR, outerR) }
            if (xyList.size >= 2) {
                val dotSpacing = dp(7f).toFloat()
                val dotR = dp(1.7f).toFloat()
                var totalPathLen = 0f
                val segLengths = FloatArray(xyList.size - 1)
                for (i in 1 until xyList.size) {
                    val p0 = xyList[i - 1]
                    val p1 = xyList[i]
                    val dx = p1.first - p0.first
                    val dy = p1.second - p0.second
                    val segLen = kotlin.math.hypot(dx.toDouble(), dy.toDouble()).toFloat()
                    segLengths[i - 1] = segLen
                    totalPathLen += segLen
                    val steps = (segLen / dotSpacing).toInt().coerceAtLeast(1)
                    for (s in 0..steps) {
                        val t = s.toFloat() / steps.toFloat()
                        canvas.drawCircle(p0.first + dx * t, p0.second + dy * t, dotR, dotPaint)
                    }
                    if (segLen >= dp(18f).toFloat()) {
                        val mx = (p0.first + p1.first) * 0.5f
                        val my = (p0.second + p1.second) * 0.5f
                        val angDeg = Math.toDegrees(kotlin.math.atan2(dy.toDouble(), dx.toDouble())).toFloat()
                        canvas.save()
                        canvas.translate(mx, my)
                        canvas.rotate(angDeg)
                        val chSize = dp(4.2f).toFloat()
                        canvas.drawLine(-chSize, -chSize * 0.85f, chSize * 0.8f, 0f, chevronPaint)
                        canvas.drawLine(chSize * 0.8f, 0f, -chSize, chSize * 0.85f, chevronPaint)
                        canvas.restore()
                    }
                }

                var halfRem = totalPathLen * 0.5f
                var midPt = xyList[xyList.size / 2]
                for (idx in segLengths.indices) {
                    val sl = segLengths[idx]
                    if (halfRem <= sl && sl > 0f) {
                        val r = halfRem / sl
                        val a = xyList[idx]
                        val b = xyList[idx + 1]
                        midPt = Pair(a.first + (b.first - a.first) * r, a.second + (b.second - a.second) * r)
                        break
                    }
                    halfRem -= sl
                }

                var lx = midPt.first + (if (isExit) dp(20f).toFloat() else -dp(24f).toFloat())
                var ly = midPt.second - dp(10f).toFloat()
                val distFromCenter = kotlin.math.hypot((lx - cx).toDouble(), (ly - cy).toDouble()).toFloat()
                if (distFromCenter < centerR + dp(24f).toFloat()) {
                    lx = cx + (if (isExit) dp(48f).toFloat() else -dp(48f).toFloat())
                    ly = cy - dp(26f).toFloat()
                }
                canvas.drawText(
                    if (isExit) "exit" else "enter",
                    lx.coerceIn(cx - outerR + dp(20f).toFloat(), cx + outerR - dp(20f).toFloat()),
                    ly.coerceIn(cy - outerR + dp(20f).toFloat(), cy + outerR - dp(14f).toFloat()),
                    modeTextPaint
                )
            }

            // 5. Official YAAD App Logo (Brand Orange #FF8C00 Location-Clock Pin) at User's Live Position
            val userPt = if (xyList.isNotEmpty()) xyList.last() else Pair(cx, cy - outerR)
            val ux = userPt.first
            val uy = userPt.second

            canvas.save()
            canvas.translate(ux, uy)

            if (!isVisualOnlyMode) {
                val p = pulseProgress.coerceIn(0f, 1f)
                val waveR1 = dp(12f).toFloat() + p * dp(16f).toFloat()
                wavePaint.alpha = ((1f - p) * 215f).toInt().coerceIn(0, 255)
                canvas.drawCircle(0f, 0f, waveR1, wavePaint)

                val p2 = (p + 0.5f) % 1f
                val waveR2 = dp(12f).toFloat() + p2 * dp(16f).toFloat()
                wavePaint.alpha = ((1f - p2) * 185f).toInt().coerceIn(0, 255)
                canvas.drawCircle(0f, 0f, waveR2, wavePaint)

                val scale = 1f + 0.13f * kotlin.math.sin(p * Math.PI).toFloat()
                canvas.scale(scale, scale, 0f, 0f)
            }

            // Map official 1024x1024 YAAD logo geometry centered at (0, 0) with size 30dp
            val logoSize = dp(30f).toFloat()
            val s = logoSize / 1024f
            canvas.save()
            canvas.translate(-logoSize * 0.5f, -logoSize * 0.5f)

            // Dark interior backdrop so clock hands remain ultra-crisp
            workPath.reset()
            workPath.fillType = Path.FillType.WINDING
            workPath.moveTo(512f * s, 95f * s)
            workPath.cubicTo(675f * s, 95f * s, 812f * s, 225f * s, 812f * s, 393.2f * s)
            workPath.cubicTo(812f * s, 555f * s, 662f * s, 752f * s, 512f * s, 910f * s)
            workPath.cubicTo(362f * s, 752f * s, 212f * s, 555f * s, 212f * s, 393.2f * s)
            workPath.cubicTo(212f * s, 225f * s, 349f * s, 95f * s, 512f * s, 95f * s)
            workPath.close()
            canvas.drawPath(workPath, pinBackdropPaint)

            // Outer Teardrop Location Pin (Official YAAD #FF8C00 Even-Odd Path)
            workPath.reset()
            workPath.fillType = Path.FillType.EVEN_ODD
            workPath.moveTo(512f * s, 51.2f * s)
            workPath.cubicTo(700.9f * s, 51.2f * s, 854f * s, 204.3f * s, 854f * s, 393.2f * s)
            workPath.cubicTo(854f * s, 576.0f * s, 692.0f * s, 788.0f * s, 545.5f * s, 956.5f * s)
            workPath.cubicTo(527.8f * s, 976.8f * s, 496.2f * s, 976.8f * s, 478.5f * s, 956.5f * s)
            workPath.cubicTo(332.0f * s, 788.0f * s, 170f * s, 576.0f * s, 170f * s, 393.2f * s)
            workPath.cubicTo(170f * s, 204.3f * s, 323.1f * s, 51.2f * s, 512f * s, 51.2f * s)
            workPath.close()

            workPath.moveTo(512f * s, 135.2f * s)
            workPath.cubicTo(369.5f * s, 135.2f * s, 254f * s, 250.7f * s, 254f * s, 393.2f * s)
            workPath.cubicTo(254f * s, 538.0f * s, 388.0f * s, 722.0f * s, 512f * s, 863.0f * s)
            workPath.cubicTo(636.0f * s, 722.0f * s, 770f * s, 538.0f * s, 770f * s, 393.2f * s)
            workPath.cubicTo(770f * s, 250.7f * s, 654.5f * s, 135.2f * s, 512f * s, 135.2f * s)
            workPath.close()
            canvas.drawPath(workPath, pinFillPaint)

            // Integrated Clock Hands (Official YAAD #FF8C00)
            pinStrokePaint.strokeWidth = 72f * s
            canvas.drawLine(512f * s, 237f * s, 512f * s, 393.2f * s, pinStrokePaint)
            canvas.drawLine(512f * s, 393.2f * s, 625f * s, 458.5f * s, pinStrokePaint)

            canvas.restore()
            canvas.restore()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)

        val shouldWakeScreenOnce = intent?.getBooleanExtra("yaad_wake_screen_once", true) != false
        val fromScreenOff = (intent?.getBooleanExtra("yaad_launched_from_screen_off", false) == true) ||
            !isScreenCurrentlyInteractive(this)
        val requestedDurationMs = if (fromScreenOff) {
            SCREEN_OFF_KEEP_AWAKE_MS
        } else {
            (intent?.getLongExtra("yaad_keep_screen_on_duration_ms", SCREEN_ON_KEEP_AWAKE_MS) ?: SCREEN_ON_KEEP_AWAKE_MS)
                .coerceAtLeast(SCREEN_ON_KEEP_AWAKE_MS)
        }

        applyScreenKeepAwake(requestedDurationMs, shouldWakeScreenOnce, fromScreenOff)
        window.setDimAmount(0.82f)
        setFinishOnTouchOutside(false)
        volumeControlStream = AudioManager.STREAM_NOTIFICATION

        activeInstance = WeakReference(this)
        registerCallInterceptionListeners()
        bindFromIntent(intent)
        uiHandler.removeCallbacks(activeCallWatchdogRunnable)
        uiHandler.postDelayed(activeCallWatchdogRunnable, 200L)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            bindFromIntent(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        val remAwakeMs = screenKeepAwakeDeadlineMs - System.currentTimeMillis()
        if (remAwakeMs > 0L && !isFinishing && !isDestroyed && !isYieldingForPhoneCall) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    setShowWhenLocked(true)
                    setTurnScreenOn(true)
                }
                @Suppress("DEPRECATION")
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            } catch (e: Exception) {
            }
            if (screenWakeLock?.isHeld != true) {
                acquireScreenWakeLockForDuration(remAwakeMs)
            }
            uiHandler.removeCallbacks(releaseScreenKeepAwakeRunnable)
            uiHandler.postDelayed(releaseScreenKeepAwakeRunnable, remAwakeMs)
        }
    }

    override fun onPause() {
        super.onPause()
        val now = System.currentTimeMillis()
        // If another system UI (such as Android Incoming Call / InCallUI) just paused our lockscreen popup because a phone call started,
        // immediately suspend our alert and yield the lockscreen window so the user can answer/decline the call unimpeded!
        if (!isFinishing && !isDestroyed && !isYieldingForPhoneCall && isPhoneCallActiveOrRinging(this)) {
            suspendAndYieldForIncomingCall()
            return
        }
        if (isFinishing || isDestroyed || isYieldingForPhoneCall || now - lastKeepAwakeAppliedAtMs >= 2_500L) {
            releaseScreenWakeLock()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setTurnScreenOn(false)
            }
            @Suppress("DEPRECATION")
            window.clearFlags(
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }

    private fun registerCallInterceptionListeners() {
        if (!isPhoneStateReceiverRegistered) {
            try {
                val filter = IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(phoneStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
                } else {
                    registerReceiver(phoneStateReceiver, filter)
                }
                isPhoneStateReceiverRegistered = true
            } catch (e: Exception) {
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && audioModeListenerObj == null) {
            try {
                val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                if (am != null) {
                    val listener = AudioManager.OnModeChangedListener { mode ->
                        if (
                            mode == AudioManager.MODE_RINGTONE ||
                            mode == AudioManager.MODE_IN_CALL ||
                            mode == AudioManager.MODE_IN_COMMUNICATION ||
                            mode == AudioManager.MODE_CALL_SCREENING
                        ) {
                            runOnUiThread {
                                suspendAndYieldForIncomingCall()
                            }
                        }
                    }
                    am.addOnModeChangedListener(mainExecutor, listener)
                    audioModeListenerObj = listener
                }
            } catch (e: Exception) {
            }
        }
    }

    private fun unregisterCallInterceptionListeners() {
        uiHandler.removeCallbacks(activeCallWatchdogRunnable)
        if (isPhoneStateReceiverRegistered) {
            try {
                unregisterReceiver(phoneStateReceiver)
            } catch (e: Exception) {
            }
            isPhoneStateReceiverRegistered = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && audioModeListenerObj != null) {
            try {
                val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                val listener = audioModeListenerObj as? AudioManager.OnModeChangedListener
                if (am != null && listener != null) {
                    am.removeOnModeChangedListener(listener)
                }
            } catch (e: Exception) {
            }
            audioModeListenerObj = null
        }
    }

    /**
     * Immediately pauses the active full-screen alert (Geofence or Timed Reminder), stops its sound so the phone's ringtone
     * and call audio work normally, closes this lockscreen overlay so Android's native Incoming Call UI is 100% accessible,
     * and starts the post-call watcher to automatically bring the full-screen alert back once the call ends.
     */
    internal fun suspendAndYieldForIncomingCall() {
        if (isYieldingForPhoneCall || isFinishing || isDestroyed) return
        isYieldingForPhoneCall = true

        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()

        if (isGeofencePopup) {
            suspendGeofencePopupForPhoneCall(
                this,
                notificationId,
                sourceJson,
                geofenceItemId
            )
        } else if (notificationId != Int.MIN_VALUE) {
            suspendTimedReminderForPhoneCall(
                this,
                notificationId,
                sourceJson,
                remainingCountdownMillis.coerceIn(5_000L, 60_000L),
                isReminderAudioMuted
            )
            silenceActiveTimedNotificationForCall()
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(false)
                setTurnScreenOn(false)
            }
            @Suppress("DEPRECATION")
            window.clearFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DIM_BEHIND
            )
            window.setDimAmount(0f)
        } catch (e: Exception) {
        }

        finish()
        overridePendingTransition(0, 0)
    }

    private fun silenceActiveTimedNotificationForCall() {
        try {
            LocalNotificationsPlugin.stopActiveMediaPlayer()
            if (notificationId != Int.MIN_VALUE && requestJson != null) {
                val silentCopy = JSObject(requestJson.toString())
                silentCopy.remove("schedule")
                silentCopy.put("channelId", "yaad_channel_v2_silent")
                val localNotif = LocalNotification.buildNotificationFromJSObject(silentCopy)
                val storage = NotificationStorage(this)
                val manager = LocalNotificationManager(storage, null, this, CapConfig.loadDefault(this))
                manager.schedule(null, listOf(localNotif))
            }
        } catch (e: Exception) {
        }
    }

    private fun dp(value: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            resources.displayMetrics
        ).toInt()
    }

    private fun toPersianDigits(input: String): String {
        val persian = charArrayOf('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹')
        val sb = StringBuilder(input.length)
        for (ch in input) {
            if (ch in '0'..'9') {
                sb.append(persian[ch - '0'])
            } else {
                sb.append(ch)
            }
        }
        return sb.toString()
    }

    private fun resolvePalette(themeName: String): ThemePalette {
        return when (themeName) {
            "geofence-radar" -> ThemePalette(
                cardBg = Color.parseColor("#04231F"),
                cardBorder = Color.parseColor("#10B981"),
                titleColor = Color.parseColor("#ECFDF5"),
                bodyColor = Color.parseColor("#A7F3D0"),
                mutedColor = Color.parseColor("#6EE7B7"),
                accentColor = Color.parseColor("#10B981"),
                doneBtnBg = Color.parseColor("#10B981"),
                doneBtnText = Color.parseColor("#022C22"),
                secondaryBtnBg = Color.parseColor("#063B32"),
                secondaryBtnBorder = Color.parseColor("#059669"),
                secondaryBtnText = Color.parseColor("#D1FAE5"),
                editBtnBg = Color.parseColor("#052E28"),
                editBtnBorder = Color.parseColor("#14B8A6"),
                editBtnText = Color.parseColor("#5EEAD4")
            )
            "geofence-sub10m" -> ThemePalette(
                cardBg = Color.parseColor("#052B22"),
                cardBorder = Color.parseColor("#34D399"),
                titleColor = Color.parseColor("#FFFFFF"),
                bodyColor = Color.parseColor("#D1FAE5"),
                mutedColor = Color.parseColor("#6EE7B7"),
                accentColor = Color.parseColor("#34D399"),
                doneBtnBg = Color.parseColor("#10B981"),
                doneBtnText = Color.parseColor("#022C22"),
                secondaryBtnBg = Color.parseColor("#064E3B"),
                secondaryBtnBorder = Color.parseColor("#10B981"),
                secondaryBtnText = Color.parseColor("#ECFDF5"),
                editBtnBg = Color.parseColor("#042F2E"),
                editBtnBorder = Color.parseColor("#2DD4BF"),
                editBtnText = Color.parseColor("#5EEAD4")
            )
            "dark-slate" -> ThemePalette(
                cardBg = Color.parseColor("#11223D"),
                cardBorder = Color.parseColor("#FF8C00"),
                titleColor = Color.parseColor("#EFF6FF"),
                bodyColor = Color.parseColor("#BAE6FD"),
                mutedColor = Color.parseColor("#7DD3FC"),
                accentColor = Color.parseColor("#FF8C00"),
                doneBtnBg = Color.parseColor("#FF8C00"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#193154"),
                secondaryBtnBorder = Color.parseColor("#274875"),
                secondaryBtnText = Color.parseColor("#EFF6FF"),
                editBtnBg = Color.parseColor("#0E1F38"),
                editBtnBorder = Color.parseColor("#0EA5E9"),
                editBtnText = Color.parseColor("#38BDF8")
            )
            "system" -> {
                val isNight = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                if (isNight) {
                    ThemePalette(
                        cardBg = Color.parseColor("#1C2126"),
                        cardBorder = Color.parseColor("#FF8C00"),
                        titleColor = Color.parseColor("#F1F5F9"),
                        bodyColor = Color.parseColor("#CBD5E1"),
                        mutedColor = Color.parseColor("#94A3B8"),
                        accentColor = Color.parseColor("#FF8C00"),
                        doneBtnBg = Color.parseColor("#FF8C00"),
                        doneBtnText = Color.parseColor("#FFFFFF"),
                        secondaryBtnBg = Color.parseColor("#252C33"),
                        secondaryBtnBorder = Color.parseColor("#333D47"),
                        secondaryBtnText = Color.parseColor("#F1F5F9"),
                        editBtnBg = Color.parseColor("#191E23"),
                        editBtnBorder = Color.parseColor("#14B8A6"),
                        editBtnText = Color.parseColor("#2DD4BF")
                    )
                } else {
                    ThemePalette(
                        cardBg = Color.parseColor("#FFFFFF"),
                        cardBorder = Color.parseColor("#FF8C00"),
                        titleColor = Color.parseColor("#0F172A"),
                        bodyColor = Color.parseColor("#334155"),
                        mutedColor = Color.parseColor("#64748B"),
                        accentColor = Color.parseColor("#FF8C00"),
                        doneBtnBg = Color.parseColor("#FF8C00"),
                        doneBtnText = Color.parseColor("#FFFFFF"),
                        secondaryBtnBg = Color.parseColor("#F1F5F9"),
                        secondaryBtnBorder = Color.parseColor("#CBD5E1"),
                        secondaryBtnText = Color.parseColor("#0F172A"),
                        editBtnBg = Color.parseColor("#F0FDFA"),
                        editBtnBorder = Color.parseColor("#0D9488"),
                        editBtnText = Color.parseColor("#0F766E")
                    )
                }
            }
            "light-clean" -> ThemePalette(
                cardBg = Color.parseColor("#FFFFFF"),
                cardBorder = Color.parseColor("#FF8C00"),
                titleColor = Color.parseColor("#1C1917"),
                bodyColor = Color.parseColor("#44403C"),
                mutedColor = Color.parseColor("#78716C"),
                accentColor = Color.parseColor("#FF8C00"),
                doneBtnBg = Color.parseColor("#FF8C00"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#F5F5F4"),
                secondaryBtnBorder = Color.parseColor("#D6D3D1"),
                secondaryBtnText = Color.parseColor("#1C1917"),
                editBtnBg = Color.parseColor("#F0FDFA"),
                editBtnBorder = Color.parseColor("#0D9488"),
                editBtnText = Color.parseColor("#0F766E")
            )
            "jade_warm_light" -> ThemePalette(
                cardBg = Color.parseColor("#F7F6F0"),
                cardBorder = Color.parseColor("#FF8C00"),
                titleColor = Color.parseColor("#202A29"),
                bodyColor = Color.parseColor("#3D4B49"),
                mutedColor = Color.parseColor("#5C6B68"),
                accentColor = Color.parseColor("#FF8C00"),
                doneBtnBg = Color.parseColor("#FF8C00"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#EFEFE8"),
                secondaryBtnBorder = Color.parseColor("#DDE1DA"),
                secondaryBtnText = Color.parseColor("#202A29"),
                editBtnBg = Color.parseColor("#DDEFEA"),
                editBtnBorder = Color.parseColor("#168779"),
                editBtnText = Color.parseColor("#168779")
            )
            "midnight_blue_silver" -> ThemePalette(
                cardBg = Color.parseColor("#202B3A"),
                cardBorder = Color.parseColor("#FF8C00"),
                titleColor = Color.parseColor("#F0F3F7"),
                bodyColor = Color.parseColor("#C5D9EE"),
                mutedColor = Color.parseColor("#9CBCE0"),
                accentColor = Color.parseColor("#FF8C00"),
                doneBtnBg = Color.parseColor("#FF8C00"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#172130"),
                secondaryBtnBorder = Color.parseColor("#39475A"),
                secondaryBtnText = Color.parseColor("#F0F3F7"),
                editBtnBg = Color.parseColor("#293648"),
                editBtnBorder = Color.parseColor("#9CBCE0"),
                editBtnText = Color.parseColor("#C5D9EE")
            )
            "sketch-contrast" -> ThemePalette(
                cardBg = Color.parseColor("#09090B"),
                cardBorder = Color.parseColor("#FF8C00"),
                titleColor = Color.parseColor("#FFFFFF"),
                bodyColor = Color.parseColor("#D4D4D8"),
                mutedColor = Color.parseColor("#A1A1AA"),
                accentColor = Color.parseColor("#FF8C00"),
                doneBtnBg = Color.parseColor("#FF8C00"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#18181B"),
                secondaryBtnBorder = Color.parseColor("#2DD4BF"),
                secondaryBtnText = Color.parseColor("#5EEAD4"),
                editBtnBg = Color.parseColor("#18181B"),
                editBtnBorder = Color.parseColor("#FFFFFF"),
                editBtnText = Color.parseColor("#FFFFFF")
            )
            else -> ThemePalette(
                cardBg = Color.parseColor("#101222"),
                cardBorder = Color.parseColor("#FF8C00"),
                titleColor = Color.parseColor("#F3F4F8"),
                bodyColor = Color.parseColor("#C7CBF0"),
                mutedColor = Color.parseColor("#8A90BD"),
                accentColor = Color.parseColor("#FF8C00"),
                doneBtnBg = Color.parseColor("#FF8C00"),
                doneBtnText = Color.parseColor("#FFFFFF"),
                secondaryBtnBg = Color.parseColor("#191C33"),
                secondaryBtnBorder = Color.parseColor("#282C4A"),
                secondaryBtnText = Color.parseColor("#F3F4F8"),
                editBtnBg = Color.parseColor("#191C33"),
                editBtnBorder = Color.parseColor("#6366F1"),
                editBtnText = Color.parseColor("#818CF8")
            )
        }
    }

    private fun makeRoundedDrawable(bgColor: Int, borderColor: Int, strokeDp: Float, radiusDp: Float): GradientDrawable {
        val gd = GradientDrawable()
        gd.shape = GradientDrawable.RECTANGLE
        gd.setColor(bgColor)
        gd.cornerRadius = dp(radiusDp).toFloat()
        if (strokeDp > 0f) {
            gd.setStroke(dp(strokeDp), borderColor)
        }
        return gd
    }

    private fun makeOvalDrawable(bgColor: Int, borderColor: Int, strokeDp: Float): GradientDrawable {
        val gd = GradientDrawable()
        gd.shape = GradientDrawable.OVAL
        gd.setColor(bgColor)
        if (strokeDp > 0f) {
            gd.setStroke(dp(strokeDp), borderColor)
        }
        return gd
    }

    private fun formatDistanceLabel(distanceMeters: Int, sub10m: Boolean): String {
        val safeDist = distanceMeters.coerceAtLeast(0)
        val distText = if (isPersian) toPersianDigits(safeDist.toString()) else safeDist.toString()
        return if (isPersian) "\$distText متر" else "\$distText m"
    }

    private fun formatRadiusLabel(radiusMeters: Int): String {
        val safeRad = radiusMeters.coerceAtLeast(10)
        val radText = if (isPersian) toPersianDigits(safeRad.toString()) else safeRad.toString()
        return if (isPersian) "شعاع حصار: \$radText متر" else "Geofence Radius: \$radText m"
    }

    private fun bindFromIntent(data: Intent?) {
        if (data == null) {
            finish()
            return
        }
        notificationId = data.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        activeNotificationId = notificationId
        sourceJson = data.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY)

        val storage = NotificationStorage(this)
        if (sourceJson != null) {
            try {
                requestJson = JSObject(sourceJson)
            } catch (e: Exception) {
            }
        }
        if (requestJson == null && notificationId != Int.MIN_VALUE) {
            requestJson = storage.getSavedNotificationAsJSObject(notificationId.toString())
            if (sourceJson == null && requestJson != null) {
                sourceJson = requestJson.toString()
            }
        }

        val extraObj = requestJson?.optJSONObject("extra")
        val themeName = extraObj?.optString("theme", "dark-gold")?.takeIf { it.isNotEmpty() } ?: "dark-gold"
        val lang = extraObj?.optString("language", "fa")?.takeIf { it.isNotEmpty() } ?: "fa"
        isPersian = lang != "en"
        isGeofencePopup = extraObj?.optBoolean("geofence", false) == true
        isSub10mArrival = extraObj?.optBoolean("sub10m", false) == true
        geofenceItemId = extraObj?.optString("geofenceItemId", "") ?: ""
        val initialDistance = extraObj?.optInt("distance", 0) ?: 0
        val radiusMeters = extraObj?.optInt("radius", 200) ?: 200
        targetLatitude = extraObj?.optDouble("latitude", Double.NaN) ?: Double.NaN
        targetLongitude = extraObj?.optDouble("longitude", Double.NaN) ?: Double.NaN

        val rawTitle = requestJson?.getString("title") ?: (if (isPersian) "یادآور" else "Reminder")
        val cleanTitle = rawTitle
            .replaceFirst("🔔 یادآور: ", "")
            .replaceFirst("یادآور: ", "")
            .replaceFirst("🔔 ", "")
            .replaceFirst("📍 اعلام حصار مکانی: ", "")
            .replaceFirst("📍 رادار حصار مکانی: ", "")
            .replaceFirst("🎯 مقصد ثبت‌شده: ", "")
            .replaceFirst("📍 مکان: ", "")
            .replaceFirst("🎯 مقصد: ", "")
            .replaceFirst("🎯 ", "")
            .replaceFirst("📍 ", "")
            .substringBefore("  |  ")
            .trim()
        cleanLocationTitle = cleanTitle

        // If launched via Status Bar Notification "✎ ویرایش" ("Edit") action button,
        // ensure a minimal transition view is attached so onCreate never finishes before layout,
        // dismiss keyguard if locked, stop sonar audio, open the app, and navigate to Geofence Radius section.
        if (data.getBooleanExtra("yaad_direct_geofence_edit", false)) {
            ensureTransitionBackdropView()
            performEditAction(isDirectTrampoline = true)
            return
        }

        // If launched via Status Bar Notification "🧭 مسیریابی" ("Directions") action button,
        // ensure a minimal transition view is attached, dismiss keyguard if locked, stop sonar audio, and launch Google Maps.
        if (data.getBooleanExtra("yaad_direct_geofence_directions", false)) {
            ensureTransitionBackdropView()
            performDirectionsAction(isDirectTrampoline = true)
            return
        }

        // If a phone call is currently ringing or off-hook at the moment this full-screen popup is launched,
        // immediately suspend the popup and yield to Android's native phone call UI, then restore after the call ends!
        if (isPhoneCallActiveOrRinging(this)) {
            suspendAndYieldForIncomingCall()
            return
        }

        val bodyText = requestJson?.getString("body") ?: ""

        val effectiveTheme = if (isGeofencePopup) {
            if (isSub10mArrival) "geofence-sub10m" else "geofence-radar"
        } else {
            themeName
        }
        val palette = resolvePalette(effectiveTheme)
        val fromScreenOff = data.getBooleanExtra("yaad_launched_from_screen_off", false) ||
            !isScreenCurrentlyInteractive(this)
        val keepAwakeDurationMs = if (fromScreenOff) {
            SCREEN_OFF_KEEP_AWAKE_MS
        } else {
            data.getLongExtra("yaad_keep_screen_on_duration_ms", SCREEN_ON_KEEP_AWAKE_MS)
                .coerceAtLeast(SCREEN_ON_KEEP_AWAKE_MS)
        }

        if (isGeofencePopup) {
            countDownTimer?.cancel()
            if (data.getBooleanExtra("yaad_wake_screen_once", true)) {
                applyScreenKeepAwake(keepAwakeDurationMs, wakeScreenNow = true, fromScreenOff = fromScreenOff)
                data.removeExtra("yaad_wake_screen_once")
            }
            val isVisualOnlyBanner = (extraObj?.optBoolean("visualOnlyBanner", false) == true) ||
                (extraObj?.optBoolean("visualOnly", false) == true)
            val visualBannerText = extraObj?.optString("visualBannerText", "")?.takeIf { it.isNotEmpty() }
                ?: (extraObj?.optString("visualBannerMessage", "") ?: "")
            val multiItemsArr = extraObj?.optJSONArray("multiCards") ?: try {
                val multiItemsJsonStr = extraObj?.optString("multiItemsJson", "[]") ?: "[]"
                org.json.JSONArray(multiItemsJsonStr)
            } catch (e: Exception) {
                org.json.JSONArray()
            }
            if (multiItemsArr.length() >= 2) {
                buildMultiCardGeofenceUI(palette, multiItemsArr)
            } else {
                buildFullScreenGeofenceUI(
                    palette,
                    cleanTitle,
                    if (isVisualOnlyBanner && visualBannerText.isNotEmpty()) visualBannerText else bodyText,
                    initialDistance,
                    radiusMeters
                )
            }
            // IMPORTANT: Do NOT start any auto-close CountDownTimer!
            // Full-screen geofence page MUST stay open until explicit user reaction (Stop, Directions, or Edit).
        } else {
            if (data.getBooleanExtra("yaad_wake_screen_once", true)) {
                applyScreenKeepAwake(keepAwakeDurationMs, wakeScreenNow = true, fromScreenOff = fromScreenOff)
                data.removeExtra("yaad_wake_screen_once")
            }
            // Merge into activeBundledTimedReminders so simultaneous or near-simultaneous reminders
            // are grouped into a single Full-Screen UI instead of stacking multiple activities on top of each other
            try {
                if (notificationId != Int.MIN_VALUE && requestJson != null) {
                    val remId = extraObj?.optString("reminderId", "") ?: ""
                    // Remove any older entry with the same reminderId
                    if (remId.isNotEmpty()) {
                        val toRemove = ArrayList<Int>()
                        for ((kId, kJson) in activeBundledTimedReminders) {
                            val kRemId = kJson.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (kRemId == remId && kId != notificationId) {
                                toRemove.add(kId)
                            }
                        }
                        for (rKey in toRemove) {
                            activeBundledTimedReminders.remove(rKey)
                        }
                    }
                    activeBundledTimedReminders[notificationId] = requestJson!!
                }
                val bundledArr = extraObj?.optJSONArray("bundledReminders")
                if (bundledArr != null) {
                    for (i in 0 until bundledArr.length()) {
                        val bObj = bundledArr.optJSONObject(i) ?: continue
                        val bNotifId = bObj.optInt("notificationId", Int.MIN_VALUE)
                        if (bNotifId == Int.MIN_VALUE) continue
                        val bSourceStr = bObj.optString("sourceJson", "")
                        val bJson = if (bSourceStr.isNotEmpty()) {
                            try { JSObject(bSourceStr) } catch (e: Exception) { null }
                        } else {
                            storage.getSavedNotificationAsJSObject(bNotifId.toString())
                        }
                        if (bJson != null) {
                            activeBundledTimedReminders[bNotifId] = bJson
                        }
                    }
                }
            } catch (e: Exception) {
            }

            if (activeBundledTimedReminders.size >= 2) {
                buildBundledTimedRemindersUI(palette)
            } else {
                buildMinimalCardUI(palette, cleanTitle, bodyText, initialDistance)
            }
            val resumeRemainingMs = data.getLongExtra("yaad_resume_remaining_ms", 60_000L).coerceIn(5_000L, 60_000L)
            val resumeAudioMuted = data.getBooleanExtra("yaad_resume_audio_muted", false)
            if (resumeAudioMuted) {
                muteReminderAudioOnly()
            } else {
                startOneMinuteCountdown(resumeRemainingMs)
            }
        }
    }

    /**
     * Keeps the screen bright and awake for:
     * - 1 minute (60_000 ms) when the out-of-app alert occurs while the screen is ON (in Android launcher, other apps, or lockscreen),
     * - 21 minutes (21 * 60_000 ms) when the out-of-app alert occurs while the screen is OFF (or when screen is turned off),
     * and releases immediately upon any user reaction!
     */
    private fun applyScreenKeepAwake(durationMs: Long, wakeScreenNow: Boolean, fromScreenOff: Boolean = false) {
        val now = System.currentTimeMillis()
        lastKeepAwakeAppliedAtMs = now
        if (fromScreenOff || durationMs >= SCREEN_OFF_KEEP_AWAKE_MS) {
            launchedFromScreenOffMode = true
        }
        val effectiveDurationMs = if (launchedFromScreenOffMode) {
            SCREEN_OFF_KEEP_AWAKE_MS
        } else {
            durationMs.coerceIn(SCREEN_ON_KEEP_AWAKE_MS, SCREEN_OFF_KEEP_AWAKE_MS)
        }
        screenKeepAwakeDeadlineMs = kotlin.math.max(screenKeepAwakeDeadlineMs, now + effectiveDurationMs)
        val remainingMs = (screenKeepAwakeDeadlineMs - now).coerceAtLeast(1_000L)

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(wakeScreenNow)
            }
            @Suppress("DEPRECATION")
            var winFlags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DIM_BEHIND
            if (wakeScreenNow) {
                @Suppress("DEPRECATION")
                winFlags = winFlags or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            }
            window.addFlags(winFlags)
        } catch (e: Exception) {
        }

        if (wakeScreenNow) {
            acquireScreenWakeLockForDuration(remainingMs)
        }
        uiHandler.removeCallbacks(releaseScreenKeepAwakeRunnable)
        uiHandler.postDelayed(releaseScreenKeepAwakeRunnable, remainingMs)
    }

    private fun acquireScreenWakeLockForDuration(durationMs: Long) {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return
            screenWakeLock?.let { existing ->
                if (existing.isHeld) {
                    try {
                        existing.release()
                    } catch (e: Exception) {
                    }
                }
            }
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    android.os.PowerManager.ON_AFTER_RELEASE,
                "yaad:geofenceLockScreenWakeLock"
            )
            wl.setReferenceCounted(false)
            wl.acquire(durationMs.coerceIn(1_000L, SCREEN_OFF_KEEP_AWAKE_MS))
            screenWakeLock = wl
        } catch (e: Exception) {
        }
    }

    private fun expireScreenKeepAwakeWindowOnly() {
        screenKeepAwakeDeadlineMs = 0L
        releaseScreenWakeLock()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setTurnScreenOn(false)
            }
            @Suppress("DEPRECATION")
            window.clearFlags(
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        } catch (e: Exception) {
        }
    }

    private fun releaseScreenWakeLock() {
        uiHandler.removeCallbacks(releaseScreenKeepAwakeRunnable)
        try {
            screenWakeLock?.let { wl ->
                if (wl.isHeld) wl.release()
            }
        } catch (e: Exception) {
        }
        screenWakeLock = null
    }

    private fun stopPulseAnimators() {
        try {
            sonarRingAnimator?.cancel()
            sonarRingAnimator = null
            sonarOuterRingAnimator?.cancel()
            sonarOuterRingAnimator = null
            gpsPinPulseAnimator?.cancel()
            gpsPinPulseAnimator = null
            radarPulseAnimator?.cancel()
            radarPulseAnimator = null
        } catch (e: Exception) {
        }
    }

    private fun applyAdaptivePulseDuration(distanceMeters: Int, radiusMeters: Int, mode: String = "enter") {
        try {
            val intervalMs = YaadGeofenceService.computeSonarIntervalMs(distanceMeters, radiusMeters, mode).coerceAtLeast(200L)
            val animDur = if (intervalMs <= 200L) 220L else 1350L
            sonarOuterRingAnimator?.duration = intervalMs
            sonarRingAnimator?.duration = intervalMs
            gpsPinPulseAnimator?.duration = intervalMs
            if (radarPulseAnimator?.duration != animDur) {
                radarPulseAnimator?.duration = animDur
            }
        } catch (e: Exception) {
        }
    }

    /**
     * Multi-Card Compact Stack UI for 2+ Simultaneous Geofence Alerts on Lockscreen:
     * Ultra-concise: displays ONLY Location Name, Short Status Phrase, Distance, and 4 concise buttons (Mute, Stop, Directions, Edit).
     */
    private fun buildMultiCardGeofenceUI(palette: ThemePalette, itemsArr: org.json.JSONArray) {
        stopPulseAnimators()

        val root = FrameLayout(this)
        root.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.setBackgroundColor(Color.parseColor("#E6021411"))
        root.setPadding(dp(12f), dp(24f), dp(12f), dp(16f))

        val outerContainer = LinearLayout(this)
        outerContainer.orientation = LinearLayout.VERTICAL
        outerContainer.layoutDirection = if (isPersian) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        outerContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, 2.2f, 24f)
        outerContainer.setPadding(dp(14f), dp(12f), dp(14f), dp(14f))
        outerContainer.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        val multiCountStr = if (isPersian) toPersianDigits(itemsArr.length().toString()) else itemsArr.length().toString()
        val multiControlBar = buildTopWindowControlBar(
            centerLabel = if (isPersian) "📍 \$multiCountStr یادآور مکانی فعال" else "📍 \$multiCountStr Active Geofences",
            accentColor = palette.accentColor,
            onCloseCompletely = {
                for (idx in 0 until itemsArr.length()) {
                    val obj = itemsArr.optJSONObject(idx) ?: continue
                    val idStr = obj.optString("id", "")
                    val nId = obj.optInt("notificationId", notificationId)
                    YaadGeofenceService.acknowledgeGeofenceItemForCycle(this, idStr, nId)
                }
                YaadGeofenceService.acknowledgeGeofenceItemForCycle(this, geofenceItemId, notificationId)
                releaseScreenWakeLock()
                finish()
                overridePendingTransition(0, 0)
            },
            onMinimizeTemporarily = {
                performMinimizeGeofencePopupAction()
            }
        )
        outerContainer.addView(multiControlBar)

        val scrollView = android.widget.ScrollView(this)
        scrollView.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        )

        val listLinear = LinearLayout(this)
        listLinear.orientation = LinearLayout.VERTICAL
        listLinear.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        val muteBtnViews = ArrayList<TextView>()
        fun updateAllMuteLabels() {
            val isMuted = YaadGeofenceService.isGeofenceAudioMuted()
            val label = if (isMuted) {
                if (isPersian) "🔊 وصل صدا" else "🔊 Unmute"
            } else {
                if (isPersian) "🔇 قطع صدا" else "🔇 Mute"
            }
            for (tv in muteBtnViews) {
                tv.text = label
            }
        }

        for (i in 0 until itemsArr.length()) {
            val itemObj = itemsArr.optJSONObject(i) ?: continue
            val itemId = itemObj.optString("id", "")
            val itemNotifId = itemObj.optInt("notificationId", notificationId)
            val itemTitle = itemObj.optString("title", cleanLocationTitle)
            val itemBody = itemObj.optString("subtitle", itemObj.optString("body", ""))
            val itemDist = itemObj.optInt("distance", 0)
            val itemRadius = itemObj.optInt("radius", 200)
            val itemLat = itemObj.optDouble("latitude", targetLatitude)
            val itemLon = itemObj.optDouble("longitude", targetLongitude)
            val isTopPriority = (i == 0)

            val card = LinearLayout(this)
            card.orientation = LinearLayout.VERTICAL
            card.setPadding(dp(14f), dp(12f), dp(14f), dp(12f))
            card.background = makeRoundedDrawable(
                if (isTopPriority) Color.parseColor("#063830") else Color.parseColor("#04221D"),
                if (isTopPriority) palette.accentColor else Color.argb(110, 16, 185, 129),
                if (isTopPriority) 2.0f else 1.2f,
                18f
            )
            val cardLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            cardLp.bottomMargin = dp(10f)
            card.layoutParams = cardLp

            // 1. Location Name + Distance & Radius Row
            val headerRow = LinearLayout(this)
            headerRow.orientation = LinearLayout.HORIZONTAL
            headerRow.gravity = Gravity.CENTER_VERTICAL
            headerRow.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )

            val titleRow = TextView(this)
            titleRow.text = itemTitle
            titleRow.setTextColor(Color.WHITE)
            titleRow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            titleRow.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
            titleRow.maxLines = 1
            titleRow.ellipsize = TextUtils.TruncateAt.END
            titleRow.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            headerRow.addView(titleRow)

            val distTv = TextView(this)
            distTv.text = formatDistanceLabel(itemDist, false)
            distTv.setTextColor(Color.parseColor("#A7F3D0"))
            distTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            distTv.setTypeface(Typeface.DEFAULT_BOLD)
            distTv.setPadding(dp(10f), dp(4f), dp(10f), dp(4f))
            distTv.background = makeRoundedDrawable(
                Color.parseColor("#021815"),
                palette.accentColor,
                1.2f,
                12f
            )
            if (isTopPriority) {
                distanceBadgeTextView = distTv
            }
            headerRow.addView(distTv)
            card.addView(headerRow)

            // Radius Badge
            val radiusRowTv = TextView(this)
            radiusRowTv.text = formatRadiusLabel(itemRadius)
            radiusRowTv.setTextColor(Color.parseColor("#6EE7B7"))
            radiusRowTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            radiusRowTv.setTypeface(Typeface.DEFAULT_BOLD)
            val radiusLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            radiusLp.topMargin = dp(4f)
            radiusRowTv.layoutParams = radiusLp
            card.addView(radiusRowTv)

            // 2. Concise Status Phrase
            if (itemBody.isNotEmpty()) {
                val statusTv = TextView(this)
                statusTv.text = itemBody.replace("\\n", " ").trim()
                statusTv.setTextColor(Color.parseColor("#D1FAE5"))
                statusTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                statusTv.setTypeface(Typeface.DEFAULT_BOLD)
                val statusLp = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
                statusLp.topMargin = dp(4f)
                statusTv.layoutParams = statusLp
                card.addView(statusTv)
            }

            // Prominent Pass-Through Snooze Button ("الان نه (Snooze)")
            val snoozeRow = LinearLayout(this)
            snoozeRow.orientation = LinearLayout.HORIZONTAL
            snoozeRow.gravity = Gravity.CENTER
            val snoozeRowLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            snoozeRowLp.topMargin = dp(8f)
            snoozeRow.layoutParams = snoozeRowLp

            val passThroughSnoozeBtn = buildActionButton(
                text = if (isPersian) "⏱ الان نه (Snooze)" else "⏱ Not Now (Snooze)",
                bgColor = Color.parseColor("#78350F"),
                borderColor = Color.parseColor("#F59E0B"),
                textColor = Color.parseColor("#FEF3C7"),
                strokeDp = 1.5f
            ) {
                YaadGeofenceService.snoozeGeofenceItemForPassingThrough(this, itemId, 30 * 60_000L, itemNotifId)
                if (itemsArr.length() <= 1) {
                    releaseScreenWakeLock()
                    finish()
                    overridePendingTransition(0, 0)
                }
            }
            passThroughSnoozeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            passThroughSnoozeBtn.setPadding(dp(10f), dp(10f), dp(10f), dp(10f))
            snoozeRow.addView(passThroughSnoozeBtn)
            card.addView(snoozeRow)

            // 3. 4 Concise Buttons (قطع صدا, توقف, مسیریابی, ویرایش)
            val btnRow = LinearLayout(this)
            btnRow.orientation = LinearLayout.HORIZONTAL
            btnRow.gravity = Gravity.CENTER
            val btnRowLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            btnRowLp.topMargin = dp(6f)
            btnRow.layoutParams = btnRowLp

            val muteBtn = buildActionButton(
                text = if (isPersian) "🔇 قطع صدا" else "🔇 Mute",
                bgColor = Color.parseColor("#451A03"),
                borderColor = Color.parseColor("#F59E0B"),
                textColor = Color.parseColor("#FDE68A"),
                strokeDp = 1.2f
            ) {
                YaadGeofenceService.toggleGeofenceAudioMute(this)
                updateAllMuteLabels()
            }
            muteBtnViews.add(muteBtn)

            val stopBtn = buildActionButton(
                text = if (isPersian) "⏹ توقف" else "⏹ Stop",
                bgColor = palette.doneBtnBg,
                borderColor = Color.TRANSPARENT,
                textColor = palette.doneBtnText,
                strokeDp = 0f
            ) {
                YaadGeofenceService.stopGeofenceOperationForItem(this, itemId, itemNotifId)
                if (itemsArr.length() <= 1) {
                    releaseScreenWakeLock()
                    finish()
                    overridePendingTransition(0, 0)
                }
            }

            val dirBtn = buildActionButton(
                text = if (isPersian) "🧭 مسیریابی" else "🧭 Directions",
                bgColor = Color.parseColor("#0C4A6E"),
                borderColor = Color.parseColor("#38BDF8"),
                textColor = Color.parseColor("#E0F2FE"),
                strokeDp = 1.2f
            ) {
                YaadGeofenceService.pauseGeofenceItemTemporarily(this, itemId, 30 * 60_000L, itemNotifId)
                YaadGeofenceService.launchGoogleMapsDirections(this, itemLat, itemLon, itemTitle)
                releaseScreenWakeLock()
                finish()
                overridePendingTransition(0, 0)
            }

            val edBtn = buildActionButton(
                text = if (isPersian) "✎ ویرایش" else "✎ Edit",
                bgColor = palette.editBtnBg,
                borderColor = palette.editBtnBorder,
                textColor = palette.editBtnText,
                strokeDp = 1.2f
            ) {
                geofenceItemId = itemId
                notificationId = itemNotifId
                try {
                    val prevExtra = requestJson?.optJSONObject("extra")
                    val itemReq = JSObject()
                    itemReq.put("id", itemNotifId)
                    itemReq.put("title", itemTitle)
                    val newExtra = JSObject()
                    newExtra.put("geofence", true)
                    newExtra.put("geofenceItemId", itemId)
                    if (prevExtra != null) {
                        newExtra.put("theme", prevExtra.optString("theme", "dark-gold"))
                        newExtra.put("language", prevExtra.optString("language", "fa"))
                    }
                    itemReq.put("extra", newExtra)
                    requestJson = itemReq
                    sourceJson = itemReq.toString()
                } catch (e: Exception) {
                }
                performEditAction(isDirectTrampoline = false)
            }

            val m = dp(2.5f)
            (muteBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)
            (stopBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)
            (dirBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)
            (edBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)

            btnRow.addView(muteBtn)
            btnRow.addView(stopBtn)
            btnRow.addView(dirBtn)
            btnRow.addView(edBtn)
            card.addView(btnRow)

            listLinear.addView(card)
        }

        updateAllMuteLabels()
        scrollView.addView(listLinear)
        outerContainer.addView(scrollView)
        root.addView(outerContainer)
        setContentView(root)
    }

    /**
     * Dedicated Full-Screen Geofence Alert for Screen-Off / Lock-Screen state (Ultra-Concise Form):
     * Displays ONLY:
     * 1. Location Name + Short Status Phrase
     * 2. Pulsing App Logo + Live Distance
     * 3. 4 Concise Buttons ("قطع صدا", "توقف", "مسیریابی", "ویرایش")
     */
    private fun buildFullScreenGeofenceUI(
        palette: ThemePalette,
        titleStr: String,
        bodyStr: String,
        initialDistance: Int,
        radiusMeters: Int
    ) {
        stopPulseAnimators()

        val root = FrameLayout(this)
        root.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.setBackgroundColor(Color.parseColor("#E6021411"))
        root.setPadding(dp(6f), dp(14f), dp(6f), dp(10f))

        val cardContainer = LinearLayout(this)
        cardContainer.orientation = LinearLayout.VERTICAL
        cardContainer.layoutDirection = if (isPersian) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        cardContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, 2.2f, 24f)
        cardContainer.elevation = dp(20f).toFloat()
        cardContainer.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        val content = LinearLayout(this)
        content.orientation = LinearLayout.VERTICAL
        content.gravity = Gravity.CENTER_HORIZONTAL
        content.setPadding(dp(8f), dp(8f), dp(8f), dp(10f))
        content.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        // Top Window Control Bar: Left = Close Completely (✕), Right = Minimize Temporarily (—)
        val geoControlBar = buildTopWindowControlBar(
            centerLabel = if (isPersian) "📍 رادار هوشمند یاد" else "📍 YAAD Live Radar",
            accentColor = palette.accentColor,
            onCloseCompletely = {
                countDownTimer?.cancel()
                stopPulseAnimators()
                releaseScreenWakeLock()
                YaadGeofenceService.acknowledgeGeofenceItemForCycle(this, geofenceItemId, notificationId)
                finish()
                overridePendingTransition(0, 0)
            },
            onMinimizeTemporarily = {
                performMinimizeGeofencePopupAction()
            }
        )
        content.addView(geoControlBar)

        // 1. TOP SECTION: Location Name + Short Status Phrase (Compact)
        val topTitleBox = LinearLayout(this)
        topTitleBox.orientation = LinearLayout.VERTICAL
        topTitleBox.gravity = Gravity.CENTER
        topTitleBox.setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
        topTitleBox.background = makeRoundedDrawable(
            Color.parseColor("#063830"),
            palette.accentColor,
            1.4f,
            16f
        )
        topTitleBox.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        val titleTv = TextView(this)
        titleTv.text = titleStr
        titleTv.gravity = Gravity.CENTER
        titleTv.setTextColor(palette.titleColor)
        titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17.5f)
        titleTv.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        titleTv.maxLines = 1
        titleTv.ellipsize = TextUtils.TruncateAt.END
        topTitleBox.addView(titleTv)

        val cleanBody = bodyStr.substringAfter("\\n").trim().ifEmpty { bodyStr.trim() }
        if (cleanBody.isNotEmpty()) {
            val bodyTv = TextView(this)
            bodyTv.text = cleanBody
            bodyTv.gravity = Gravity.CENTER
            bodyTv.setTextColor(Color.parseColor("#FDE047"))
            bodyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            bodyTv.setTypeface(Typeface.DEFAULT_BOLD)
            bodyTv.maxLines = 1
            bodyTv.ellipsize = TextUtils.TruncateAt.END
            val bodyParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            bodyParams.topMargin = dp(2f)
            bodyTv.layoutParams = bodyParams
            topTitleBox.addView(bodyTv)
        }
        content.addView(topTitleBox)

        // 2. CENTER SECTION: Expanded Live Polar Trajectory Radar Graph (20px/dp from screen edges) + Compact Distance Box
        val centerArea = LinearLayout(this)
        centerArea.orientation = LinearLayout.VERTICAL
        centerArea.gravity = Gravity.CENTER
        centerArea.clipChildren = false
        centerArea.clipToPadding = false
        centerArea.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        )

        val extraObj = requestJson?.optJSONObject("extra")
        val initialBearing = extraObj?.optDouble("bearingDeg", 300.0)?.toFloat() ?: 300f
        val initialMode = extraObj?.optString("sonarMode", "enter") ?: "enter"
        val isVisualOnlyBanner = (extraObj?.optBoolean("visualOnlyBanner", false) == true) ||
            (extraObj?.optBoolean("visualOnly", false) == true)

        val screenW = resources.displayMetrics.widthPixels
        val radarW = (screenW - dp(28f)).coerceAtLeast(dp(240f))
        val radarH = radarW + dp(20f)
        val radarView = LivePolarRadarView(
            this,
            titleStr,
            radiusMeters,
            initialDistance,
            initialBearing,
            initialMode,
            isVisualOnlyBanner
        )
        radarView.layoutParams = LinearLayout.LayoutParams(radarW, radarH)
        livePolarRadarView = radarView

        val initialIntervalMs = YaadGeofenceService.computeSonarIntervalMs(initialDistance, radiusMeters, initialMode)
        val initialAnimDur = if (initialIntervalMs <= 200L) 220L else 1350L
        radarPulseAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = initialAnimDur
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            addUpdateListener { anim ->
                radarView.pulseProgress = anim.animatedValue as Float
            }
            start()
        }

        centerArea.addView(radarView)

        // Compact Distance + Geofence Radius Box
        val distanceCard = LinearLayout(this)
        distanceCard.orientation = LinearLayout.VERTICAL
        distanceCard.gravity = Gravity.CENTER
        distanceCard.setPadding(dp(16f), dp(6f), dp(16f), dp(6f))
        distanceCard.background = makeRoundedDrawable(
            Color.parseColor("#021815"),
            palette.accentColor,
            1.5f,
            16f
        )
        val distanceCardParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        distanceCardParams.topMargin = dp(6f)
        distanceCard.layoutParams = distanceCardParams

        val liveDistTv = TextView(this)
        liveDistTv.text = formatDistanceLabel(initialDistance.coerceAtLeast(0), isSub10mArrival)
        liveDistTv.gravity = Gravity.CENTER
        liveDistTv.setTextColor(Color.parseColor("#6EE7B7"))
        liveDistTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        liveDistTv.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        distanceBadgeTextView = liveDistTv
        distanceCard.addView(liveDistTv)

        val radiusTv = TextView(this)
        radiusTv.text = formatRadiusLabel(radiusMeters)
        radiusTv.gravity = Gravity.CENTER
        radiusTv.setTextColor(Color.parseColor("#A7F3D0"))
        radiusTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
        radiusTv.setTypeface(Typeface.DEFAULT_BOLD)
        val radiusTvParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        radiusTvParams.topMargin = dp(2f)
        radiusTv.layoutParams = radiusTvParams
        distanceCard.addView(radiusTv)

        centerArea.addView(distanceCard)
        content.addView(centerArea)

        // 3. BOTTOM SECTION: Prominent "الان نه (Snooze)" Button + 4 Compact Buttons ("قطع صدا", "توقف", "مسیریابی", "ویرایش") in 2x2 grid
        val snoozeRow = LinearLayout(this)
        snoozeRow.orientation = LinearLayout.HORIZONTAL
        snoozeRow.gravity = Gravity.CENTER
        val snoozeRowParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        snoozeRowParams.topMargin = dp(6f)
        snoozeRow.layoutParams = snoozeRowParams

        val btnMargin = dp(3f)

        val passThroughSnoozeBtn = buildActionButton(
            text = if (isPersian) "⏱ الان نه (Snooze)" else "⏱ Not Now (Snooze)",
            bgColor = Color.parseColor("#78350F"),
            borderColor = Color.parseColor("#F59E0B"),
            textColor = Color.parseColor("#FEF3C7"),
            strokeDp = 1.6f
        ) {
            performSnoozeGeofenceAction()
        }
        passThroughSnoozeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        passThroughSnoozeBtn.setPadding(dp(10f), dp(10f), dp(10f), dp(10f))
        (passThroughSnoozeBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        snoozeRow.addView(passThroughSnoozeBtn)
        content.addView(snoozeRow)

        val row1 = LinearLayout(this)
        row1.orientation = LinearLayout.HORIZONTAL
        row1.gravity = Gravity.CENTER
        val row1Params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        row1Params.topMargin = dp(5f)
        row1.layoutParams = row1Params

        val muteAudioBtn = buildActionButton(
            text = if (isPersian) "🔇 قطع صدا" else "🔇 Mute",
            bgColor = Color.parseColor("#451A03"),
            borderColor = Color.parseColor("#F59E0B"),
            textColor = Color.parseColor("#FDE68A"),
            strokeDp = 1.2f
        ) {}
        fun refreshMuteBtnState() {
            val isMuted = YaadGeofenceService.isGeofenceAudioMuted()
            muteAudioBtn.text = if (isMuted) {
                if (isPersian) "🔊 وصل صدا" else "🔊 Unmute"
            } else {
                if (isPersian) "🔇 قطع صدا" else "🔇 Mute"
            }
        }
        refreshMuteBtnState()
        muteAudioBtn.setOnClickListener {
            YaadGeofenceService.toggleGeofenceAudioMute(this)
            refreshMuteBtnState()
        }
        muteAudioBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        muteAudioBtn.setPadding(dp(6f), dp(8f), dp(6f), dp(8f))

        val gotItBtn = buildActionButton(
            text = if (isPersian) "⏹ توقف" else "⏹ Stop",
            bgColor = palette.doneBtnBg,
            borderColor = Color.TRANSPARENT,
            textColor = palette.doneBtnText,
            strokeDp = 0f
        ) {
            performBackgroundAction("done")
        }
        gotItBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        gotItBtn.setPadding(dp(6f), dp(8f), dp(6f), dp(8f))

        (muteAudioBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        (gotItBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        row1.addView(muteAudioBtn)
        row1.addView(gotItBtn)
        content.addView(row1)

        val row2 = LinearLayout(this)
        row2.orientation = LinearLayout.HORIZONTAL
        row2.gravity = Gravity.CENTER
        val row2Params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        row2Params.topMargin = dp(5f)
        row2.layoutParams = row2Params

        val directionsBtn = buildActionButton(
            text = if (isPersian) "🧭 مسیریابی" else "🧭 Directions",
            bgColor = Color.parseColor("#0C4A6E"),
            borderColor = Color.parseColor("#38BDF8"),
            textColor = Color.parseColor("#E0F2FE"),
            strokeDp = 1.2f
        ) {
            performDirectionsAction()
        }
        directionsBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        directionsBtn.setPadding(dp(6f), dp(8f), dp(6f), dp(8f))

        val editBtn = buildActionButton(
            text = if (isPersian) "✎ ویرایش" else "✎ Edit",
            bgColor = palette.editBtnBg,
            borderColor = palette.editBtnBorder,
            textColor = palette.editBtnText,
            strokeDp = 1.2f
        ) {
            performEditAction()
        }
        editBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        editBtn.setPadding(dp(6f), dp(8f), dp(6f), dp(8f))

        (directionsBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        (editBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        row2.addView(directionsBtn)
        row2.addView(editBtn)
        content.addView(row2)

        cardContainer.addView(content)
        root.addView(cardContainer)
        setContentView(root)
    }

    private var reminderAudioMutedView: TextView? = null
    private var isReminderAudioMuted: Boolean = false

    /**
     * Bundled Multi-Reminder Full-Screen UI for 2+ Simultaneous Timed Reminders:
     * Prevents overlapping full-screen intents and merges all simultaneous due reminders into one grouped card
     * with individual (Done, +15m, Edit) and batch (Done All, Snooze All 15m) controls.
     */
    private fun buildBundledTimedRemindersUI(palette: ThemePalette) {
        stopPulseAnimators()
        isReminderAudioMuted = false

        val items = ArrayList<Pair<Int, JSObject>>()
        for ((kId, kJson) in activeBundledTimedReminders) {
            items.add(Pair(kId, kJson))
        }
        if (items.size <= 1) {
            val singlePair = items.firstOrNull()
            if (singlePair != null) {
                notificationId = singlePair.first
                activeNotificationId = singlePair.first
                requestJson = singlePair.second
                sourceJson = singlePair.second.toString()
            }
            val rawT = requestJson?.getString("title") ?: (if (isPersian) "یادآور" else "Reminder")
            val cleanT = rawT
                .replaceFirst("🔔 یادآور: ", "")
                .replaceFirst("یادآور: ", "")
                .replaceFirst("🔔 ", "")
                .trim()
            val bodyT = requestJson?.getString("body") ?: ""
            buildMinimalCardUI(palette, cleanT, bodyT, 0)
            return
        }

        val root = FrameLayout(this)
        root.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.setBackgroundColor(Color.parseColor("#EB070B14"))
        root.setPadding(dp(12f), dp(22f), dp(12f), dp(16f))

        val cardContainer = LinearLayout(this)
        cardContainer.orientation = LinearLayout.VERTICAL
        cardContainer.layoutDirection = if (isPersian) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        cardContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, 2.2f, 26f)
        cardContainer.elevation = dp(22f).toFloat()
        cardContainer.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        // 1. 60s audio countdown top progress bar
        val track = FrameLayout(this)
        val trackParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(5f)
        )
        trackParams.setMargins(dp(18f), dp(14f), dp(18f), 0)
        track.layoutParams = trackParams
        track.background = makeRoundedDrawable(Color.argb(45, 128, 128, 128), Color.TRANSPARENT, 0f, 3f)

        val fill = View(this)
        fill.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        fill.background = makeRoundedDrawable(palette.accentColor, Color.TRANSPARENT, 0f, 3f)
        track.addView(fill)
        progressTrackView = track
        progressFillView = fill
        cardContainer.addView(track)

        val content = LinearLayout(this)
        content.orientation = LinearLayout.VERTICAL
        content.setPadding(dp(16f), dp(14f), dp(16f), dp(16f))
        content.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        // Top Window Control Bar: Left = Close Completely (✕), Right = Minimize Temporarily (—)
        val countText = if (isPersian) toPersianDigits(items.size.toString()) else items.size.toString()
        val bundledControlBar = buildTopWindowControlBar(
            centerLabel = if (isPersian) "🔔 \$countText یادآور همزمان" else "🔔 \$countText Simultaneous Reminders",
            accentColor = palette.accentColor,
            onCloseCompletely = {
                countDownTimer?.cancel()
                releaseScreenWakeLock()
                for ((itemNotifId, itemJson) in items) {
                    dispatchBackgroundActionForSpecificNotification(itemNotifId, itemJson.toString(), "stop")
                }
                activeBundledTimedReminders.clear()
                finish()
                overridePendingTransition(0, 0)
            },
            onMinimizeTemporarily = {
                countDownTimer?.cancel()
                releaseScreenWakeLock()
                for ((itemNotifId, itemJson) in items) {
                    dispatchBackgroundActionForSpecificNotification(itemNotifId, itemJson.toString(), "dismiss_popup_only")
                }
                activeBundledTimedReminders.clear()
                finish()
                overridePendingTransition(0, 0)
            }
        )
        content.addView(bundledControlBar)

        // Header Row: Bundled status + Mute Audio button
        val headerRow = LinearLayout(this)
        headerRow.orientation = LinearLayout.HORIZONTAL
        headerRow.gravity = Gravity.CENTER_VERTICAL
        headerRow.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        val brandTv = TextView(this)
        brandTv.text = if (isPersian) "مدیریت یکجا یا تکی یادآورها" else "Manage Individually or All at Once"
        brandTv.setTextColor(palette.titleColor)
        brandTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        brandTv.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        brandTv.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        headerRow.addView(brandTv)

        val muteBtn = TextView(this)
        muteBtn.text = if (isPersian) "🔇 قطع صدا" else "🔇 Mute"
        muteBtn.setTextColor(Color.parseColor("#FDE68A"))
        muteBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        muteBtn.setTypeface(Typeface.DEFAULT_BOLD)
        muteBtn.setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
        muteBtn.background = makeRoundedDrawable(
            Color.parseColor("#451A03"),
            Color.parseColor("#F59E0B"),
            1.2f,
            12f
        )
        muteBtn.setOnClickListener {
            muteReminderAudioOnly()
        }
        reminderAudioMutedView = muteBtn
        headerRow.addView(muteBtn)
        content.addView(headerRow)

        val subHeaderTv = TextView(this)
        subHeaderTv.text = if (isPersian) {
            "چند یادآور در این لحظه سررسید شده‌اند؛ می‌توانید هر کدام را جداگانه یا همه را یکجا مدیریت کنید:"
        } else {
            "Multiple reminders are due right now; manage them individually or all at once:"
        }
        subHeaderTv.setTextColor(palette.mutedColor)
        subHeaderTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
        val subLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        subLp.topMargin = dp(6f)
        subLp.bottomMargin = dp(10f)
        subHeaderTv.layoutParams = subLp
        content.addView(subHeaderTv)

        // Scrollable list of bundled reminder cards
        val scrollView = android.widget.ScrollView(this)
        scrollView.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        )

        val listLinear = LinearLayout(this)
        listLinear.orientation = LinearLayout.VERTICAL
        listLinear.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

        for ((index, pair) in items.withIndex()) {
            val itemNotifId = pair.first
            val itemJson = pair.second
            val rawItemTitle = itemJson.optString("title", if (isPersian) "یادآور" else "Reminder")
            val cleanItemTitle = rawItemTitle
                .replaceFirst("🔔 یادآور: ", "")
                .replaceFirst("یادآور: ", "")
                .replaceFirst("🔔 ", "")
                .trim()
            val itemBody = itemJson.optString("body", "")

            val itemCard = LinearLayout(this)
            itemCard.orientation = LinearLayout.VERTICAL
            itemCard.setPadding(dp(14f), dp(12f), dp(14f), dp(12f))
            itemCard.background = makeRoundedDrawable(
                Color.argb(42, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
                Color.argb(115, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
                1.3f,
                18f
            )
            val cardLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            cardLp.bottomMargin = dp(10f)
            itemCard.layoutParams = cardLp

            val idxStr = if (isPersian) toPersianDigits((index + 1).toString()) else (index + 1).toString()
            val itemTitleTv = TextView(this)
            itemTitleTv.text = "\$idxStr. \$cleanItemTitle"
            itemTitleTv.setTextColor(palette.titleColor)
            itemTitleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16.5f)
            itemTitleTv.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
            itemTitleTv.maxLines = 2
            itemTitleTv.ellipsize = TextUtils.TruncateAt.END
            itemCard.addView(itemTitleTv)

            if (itemBody.isNotEmpty()) {
                val itemBodyTv = TextView(this)
                itemBodyTv.text = itemBody
                itemBodyTv.setTextColor(palette.bodyColor)
                itemBodyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
                itemBodyTv.maxLines = 2
                itemBodyTv.ellipsize = TextUtils.TruncateAt.END
                val bLp = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
                bLp.topMargin = dp(4f)
                itemBodyTv.layoutParams = bLp
                itemCard.addView(itemBodyTv)
            }

            // Per-item quick buttons: Done, +15m, Edit
            val itemBtnRow = LinearLayout(this)
            itemBtnRow.orientation = LinearLayout.HORIZONTAL
            itemBtnRow.gravity = Gravity.CENTER
            val itemBtnLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            itemBtnLp.topMargin = dp(10f)
            itemBtnRow.layoutParams = itemBtnLp

            val itemDoneBtn = buildActionButton(
                text = if (isPersian) "✓ انجام شد" else "✓ Done",
                bgColor = palette.doneBtnBg,
                borderColor = Color.TRANSPARENT,
                textColor = palette.doneBtnText,
                strokeDp = 0f
            ) {
                dispatchBackgroundActionForSpecificNotification(itemNotifId, itemJson.toString(), "done")
                activeBundledTimedReminders.remove(itemNotifId)
                if (activeBundledTimedReminders.isEmpty()) {
                    countDownTimer?.cancel()
                    releaseScreenWakeLock()
                    finish()
                    overridePendingTransition(0, 0)
                } else {
                    buildBundledTimedRemindersUI(palette)
                }
            }
            itemDoneBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            itemDoneBtn.setPadding(dp(8f), dp(9f), dp(8f), dp(9f))

            val itemSnoozeBtn = buildActionButton(
                text = if (isPersian) "⏱ +۱۵ دقیقه" else "⏱ +15m",
                bgColor = palette.secondaryBtnBg,
                borderColor = palette.secondaryBtnBorder,
                textColor = palette.secondaryBtnText,
                strokeDp = 1.1f
            ) {
                dispatchBackgroundActionForSpecificNotification(itemNotifId, itemJson.toString(), "snooze")
                activeBundledTimedReminders.remove(itemNotifId)
                if (activeBundledTimedReminders.isEmpty()) {
                    countDownTimer?.cancel()
                    releaseScreenWakeLock()
                    finish()
                    overridePendingTransition(0, 0)
                } else {
                    buildBundledTimedRemindersUI(palette)
                }
            }
            itemSnoozeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            itemSnoozeBtn.setPadding(dp(8f), dp(9f), dp(8f), dp(9f))

            val itemEditBtn = buildActionButton(
                text = if (isPersian) "✎ ویرایش" else "✎ Edit",
                bgColor = palette.editBtnBg,
                borderColor = palette.editBtnBorder,
                textColor = palette.editBtnText,
                strokeDp = 1.1f
            ) {
                notificationId = itemNotifId
                requestJson = itemJson
                sourceJson = itemJson.toString()
                activeBundledTimedReminders.remove(itemNotifId)
                performEditAction()
            }
            itemEditBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            itemEditBtn.setPadding(dp(8f), dp(9f), dp(8f), dp(9f))

            val m = dp(3f)
            (itemDoneBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)
            (itemSnoozeBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)
            (itemEditBtn.layoutParams as LinearLayout.LayoutParams).setMargins(m, 0, m, 0)

            itemBtnRow.addView(itemDoneBtn)
            itemBtnRow.addView(itemSnoozeBtn)
            itemBtnRow.addView(itemEditBtn)
            itemCard.addView(itemBtnRow)

            listLinear.addView(itemCard)
        }

        scrollView.addView(listLinear)
        content.addView(scrollView)

        // Master Batch Actions at bottom: Done All & Snooze All 15m
        val doneAllBtn = buildActionButton(
            text = if (isPersian) "✓ انجام همه (\$countText مورد)" else "✓ Complete All (\$countText)",
            bgColor = palette.doneBtnBg,
            borderColor = Color.TRANSPARENT,
            textColor = palette.doneBtnText,
            strokeDp = 0f
        ) {
            countDownTimer?.cancel()
            releaseScreenWakeLock()
            for ((itemNotifId, itemJson) in items) {
                dispatchBackgroundActionForSpecificNotification(itemNotifId, itemJson.toString(), "done")
            }
            activeBundledTimedReminders.clear()
            finish()
            overridePendingTransition(0, 0)
        }
        doneAllBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
        doneAllBtn.setPadding(dp(12f), dp(12f), dp(12f), dp(12f))
        val doneAllLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        doneAllLp.topMargin = dp(10f)
        doneAllBtn.layoutParams = doneAllLp
        content.addView(doneAllBtn)

        val snoozeAllBtn = buildActionButton(
            text = if (isPersian) "⏱ تعویق همه به مدت ۱۵ دقیقه" else "⏱ Snooze All 15m",
            bgColor = palette.secondaryBtnBg,
            borderColor = palette.secondaryBtnBorder,
            textColor = palette.secondaryBtnText,
            strokeDp = 1.2f
        ) {
            countDownTimer?.cancel()
            releaseScreenWakeLock()
            for ((itemNotifId, itemJson) in items) {
                dispatchBackgroundActionForSpecificNotification(itemNotifId, itemJson.toString(), "snooze")
            }
            activeBundledTimedReminders.clear()
            finish()
            overridePendingTransition(0, 0)
        }
        snoozeAllBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        snoozeAllBtn.setPadding(dp(12f), dp(11f), dp(12f), dp(11f))
        val snoozeAllLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        snoozeAllLp.topMargin = dp(8f)
        snoozeAllBtn.layoutParams = snoozeAllLp
        content.addView(snoozeAllBtn)

        cardContainer.addView(content)
        root.addView(cardContainer)
        setContentView(root)
    }

    private fun dispatchBackgroundActionForSpecificNotification(
        targetNotifId: Int,
        targetSourceJson: String?,
        actionId: String
    ) {
        try {
            val broadcastIntent = Intent(this, NotificationDismissReceiver::class.java)
            broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, targetNotifId)
            broadcastIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, actionId)
            if (targetSourceJson != null) {
                broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, targetSourceJson)
            }
            sendBroadcast(broadcastIntent)
        } catch (e: Exception) {
        }
    }

    private fun buildMinimalCardUI(palette: ThemePalette, titleStr: String, bodyStr: String, initialDistance: Int) {
        stopPulseAnimators()
        isReminderAudioMuted = false

        val root = FrameLayout(this)
        root.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.setBackgroundColor(Color.parseColor("#EB070B14"))
        root.setPadding(dp(14f), dp(24f), dp(14f), dp(20f))

        val cardContainer = LinearLayout(this)
        cardContainer.orientation = LinearLayout.VERTICAL
        cardContainer.layoutDirection = if (isPersian) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        cardContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, 2.2f, 28f)
        cardContainer.elevation = dp(22f).toFloat()

        val cardParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        cardParams.gravity = Gravity.CENTER
        cardContainer.layoutParams = cardParams

        // 1. 60s audio countdown top progress bar inside full-screen card
        val track = FrameLayout(this)
        val trackParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(5f)
        )
        trackParams.setMargins(dp(20f), dp(16f), dp(20f), 0)
        track.layoutParams = trackParams
        track.background = makeRoundedDrawable(Color.argb(45, 128, 128, 128), Color.TRANSPARENT, 0f, 3f)

        val fill = View(this)
        val fillParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        fill.layoutParams = fillParams
        fill.background = makeRoundedDrawable(palette.accentColor, Color.TRANSPARENT, 0f, 3f)
        track.addView(fill)
        progressTrackView = track
        progressFillView = fill
        cardContainer.addView(track)

        // Inner content container
        val content = LinearLayout(this)
        content.orientation = LinearLayout.VERTICAL
        content.gravity = Gravity.CENTER_HORIZONTAL
        content.setPadding(dp(20f), dp(14f), dp(20f), dp(22f))

        // Top Window Control Bar: Left = Close Completely (✕), Right = Minimize Temporarily (—)
        distanceBadgeTextView = null
        val minimalControlBar = buildTopWindowControlBar(
            centerLabel = if (isPersian) "🔔 یادآور هوشمند یاد" else "🔔 YAAD Smart Reminder",
            accentColor = palette.accentColor,
            onCloseCompletely = {
                performBackgroundAction("stop")
            },
            onMinimizeTemporarily = {
                performBackgroundAction("dismiss_popup_only")
            }
        )
        content.addView(minimalControlBar)

        // Centered Pulsing App Icon Emblem
        try {
            val emblemFrame = FrameLayout(this)
            val emblemSize = dp(68f)
            val emblemLp = LinearLayout.LayoutParams(emblemSize, emblemSize)
            emblemLp.topMargin = dp(14f)
            emblemFrame.layoutParams = emblemLp
            emblemFrame.background = makeOvalDrawable(
                Color.argb(38, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
                palette.accentColor,
                1.8f
            )

            val appIconView = android.widget.ImageView(this)
            val notifIconResId = resources.getIdentifier("ic_stat_notification", "drawable", packageName)
            if (notifIconResId != 0) {
                appIconView.setImageResource(notifIconResId)
            } else {
                val appDrawable = packageManager.getApplicationIcon(applicationInfo)
                appIconView.setImageDrawable(appDrawable)
            }
            appIconView.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            val iconSize = dp(38f)
            val iconParams = FrameLayout.LayoutParams(iconSize, iconSize)
            iconParams.gravity = Gravity.CENTER
            appIconView.layoutParams = iconParams
            emblemFrame.addView(appIconView)
            content.addView(emblemFrame)

            gpsPinPulseAnimator = ObjectAnimator.ofPropertyValuesHolder(
                emblemFrame,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 1.0f, 1.12f, 1.0f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.0f, 1.12f, 1.0f)
            ).apply {
                duration = 1200L
                repeatCount = ValueAnimator.INFINITE
                interpolator = AccelerateDecelerateInterpolator()
                start()
            }
        } catch (e: Exception) {
        }

        // Subject (Title) - Distinct larger, extra-bold typography inside a highlighted box
        val titleTv = TextView(this)
        titleTv.text = titleStr
        titleTv.gravity = Gravity.CENTER
        titleTv.setTextColor(palette.titleColor)
        titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        titleTv.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        titleTv.maxLines = 3
        titleTv.ellipsize = TextUtils.TruncateAt.END
        titleTv.setPadding(dp(16f), dp(12f), dp(16f), dp(12f))
        titleTv.background = makeRoundedDrawable(
            Color.argb(36, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
            Color.argb(120, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
            1.4f,
            16f
        )
        val titleParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        titleParams.topMargin = dp(16f)
        titleTv.layoutParams = titleParams
        titleTv.setOnClickListener {
            performTapOpenTimelineAction()
        }
        content.addView(titleTv)

        // Body / Saved Content
        if (bodyStr.isNotEmpty()) {
            val bodyTv = TextView(this)
            bodyTv.text = bodyStr
            bodyTv.gravity = Gravity.CENTER
            bodyTv.setTextColor(palette.bodyColor)
            bodyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            bodyTv.typeface = Typeface.DEFAULT_BOLD
            bodyTv.maxLines = 5
            bodyTv.ellipsize = TextUtils.TruncateAt.END
            val bodyParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            bodyParams.topMargin = dp(12f)
            bodyTv.layoutParams = bodyParams
            bodyTv.setOnClickListener {
                performTapOpenTimelineAction()
            }
            content.addView(bodyTv)
        }

        // Mute Audio button (قطع صدا) so user can silence the alarm audio while keeping the card open
        val muteBtn = buildActionButton(
            text = if (isPersian) "🔇 قطع صدا" else "🔇 Mute Audio",
            bgColor = Color.parseColor("#451A03"),
            borderColor = Color.parseColor("#F59E0B"),
            textColor = Color.parseColor("#FDE68A"),
            strokeDp = 1.2f
        ) {
            muteReminderAudioOnly()
        }
        val muteLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        muteLp.topMargin = dp(16f)
        muteBtn.layoutParams = muteLp
        reminderAudioMutedView = muteBtn
        content.addView(muteBtn)

        // Primary Done Button (✓ انجام شد)
        val doneBtn = buildActionButton(
            text = if (isPersian) "✓ انجام شد" else "✓ Done",
            bgColor = palette.doneBtnBg,
            borderColor = Color.TRANSPARENT,
            textColor = palette.doneBtnText,
            strokeDp = 0f
        ) {
            performBackgroundAction("done")
        }
        doneBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        doneBtn.setPadding(dp(12f), dp(13f), dp(12f), dp(13f))
        val doneLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        doneLp.topMargin = dp(10f)
        doneBtn.layoutParams = doneLp
        content.addView(doneBtn)

        // Secondary Row: Snooze 15m (⏱ تعویق ۱۵ دقیقه) + Edit (✎ ویرایش)
        val actionsRow = LinearLayout(this)
        actionsRow.orientation = LinearLayout.HORIZONTAL
        actionsRow.gravity = Gravity.CENTER
        val actionsParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        actionsParams.topMargin = dp(10f)
        actionsRow.layoutParams = actionsParams

        val snoozeBtn = buildActionButton(
            text = if (isPersian) "⏱ تعویق ۱۵ دقیقه" else "⏱ Snooze 15m",
            bgColor = palette.secondaryBtnBg,
            borderColor = palette.secondaryBtnBorder,
            textColor = palette.secondaryBtnText,
            strokeDp = 1.2f
        ) {
            performBackgroundAction("snooze")
        }

        val editBtn = buildActionButton(
            text = if (isPersian) "✎ ویرایش" else "✎ Edit",
            bgColor = palette.editBtnBg,
            borderColor = palette.editBtnBorder,
            textColor = palette.editBtnText,
            strokeDp = 1.2f
        ) {
            performEditAction()
        }

        val btnMargin = dp(4f)
        (snoozeBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        (editBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)

        actionsRow.addView(snoozeBtn)
        actionsRow.addView(editBtn)
        content.addView(actionsRow)

        cardContainer.addView(content)
        root.addView(cardContainer)
        setContentView(root)
    }

    private fun buildTopWindowControlBar(
        centerLabel: String,
        accentColor: Int,
        onCloseCompletely: () -> Unit,
        onMinimizeTemporarily: () -> Unit
    ): LinearLayout {
        val bar = LinearLayout(this)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.layoutDirection = View.LAYOUT_DIRECTION_LTR
        bar.gravity = Gravity.CENTER_VERTICAL
        val barLp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        barLp.bottomMargin = dp(6f)
        bar.layoutParams = barLp

        // Top-Left: Close Completely (✕)
        val closeBtn = TextView(this)
        closeBtn.text = "✕"
        closeBtn.gravity = Gravity.CENTER
        closeBtn.setTextColor(Color.parseColor("#FCA5A5"))
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        closeBtn.setTypeface(Typeface.DEFAULT_BOLD)
        closeBtn.background = makeRoundedDrawable(
            Color.parseColor("#3B0A14"),
            Color.parseColor("#F43F5E"),
            1.2f,
            12f
        )
        val btnSize = dp(34f)
        closeBtn.layoutParams = LinearLayout.LayoutParams(btnSize, btnSize)
        closeBtn.contentDescription = if (isPersian) "بستن کامل" else "Close completely"
        closeBtn.setOnClickListener { onCloseCompletely() }
        bar.addView(closeBtn)

        // Center Title / Brand Badge
        val centerTv = TextView(this)
        centerTv.text = centerLabel
        centerTv.gravity = Gravity.CENTER
        centerTv.setTextColor(accentColor)
        centerTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        centerTv.setTypeface(Typeface.DEFAULT_BOLD)
        centerTv.maxLines = 1
        centerTv.ellipsize = TextUtils.TruncateAt.END
        centerTv.setPadding(dp(8f), 0, dp(8f), 0)
        centerTv.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        centerTv.setOnClickListener {
            performTapOpenTimelineAction()
        }
        bar.addView(centerTv)

        // Top-Right: Minimize Temporarily (—)
        val minBtn = TextView(this)
        minBtn.text = "—"
        minBtn.gravity = Gravity.CENTER
        minBtn.setTextColor(Color.parseColor("#E2E8F0"))
        minBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        minBtn.setTypeface(Typeface.DEFAULT_BOLD)
        minBtn.background = makeRoundedDrawable(
            Color.parseColor("#0F2925"),
            accentColor,
            1.2f,
            12f
        )
        minBtn.layoutParams = LinearLayout.LayoutParams(btnSize, btnSize)
        minBtn.contentDescription = if (isPersian) "مینیمایز (بستن موقت)" else "Minimize temporarily"
        minBtn.setOnClickListener { onMinimizeTemporarily() }
        bar.addView(minBtn)

        return bar
    }

    private fun performMinimizeGeofencePopupAction() {
        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()
        try {
            YaadGeofenceService.setGeofenceAudioMuteState(this, true)
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    private fun buildActionButton(
        text: String,
        bgColor: Int,
        borderColor: Int,
        textColor: Int,
        strokeDp: Float,
        onClick: () -> Unit
    ): TextView {
        val btn = TextView(this)
        btn.text = text
        btn.gravity = Gravity.CENTER
        btn.setTextColor(textColor)
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        btn.setTypeface(Typeface.DEFAULT_BOLD)
        btn.setSingleLine(true)
        btn.ellipsize = TextUtils.TruncateAt.END
        btn.setPadding(dp(8f), dp(12f), dp(8f), dp(12f))
        btn.background = makeRoundedDrawable(bgColor, borderColor, strokeDp, 14f)
        btn.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        btn.setOnClickListener { onClick() }
        return btn
    }

    private fun muteReminderAudioOnly() {
        if (isReminderAudioMuted) return
        isReminderAudioMuted = true
        countDownTimer?.cancel()
        try {
            val lp = progressFillView?.layoutParams
            if (lp != null) {
                lp.width = 0
                progressFillView?.layoutParams = lp
            }
            reminderAudioMutedView?.text = if (isPersian) "🔕 صدا قطع شد (در انتظار واکنش شما)" else "🔕 Audio Muted (Awaiting Action)"
            reminderAudioMutedView?.alpha = 0.7f
        } catch (e: Exception) {
        }
        try {
            val broadcastIntent = Intent(this, NotificationDismissReceiver::class.java)
            broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            broadcastIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "mute_after_1m")
            if (sourceJson != null) {
                broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            sendBroadcast(broadcastIntent)
        } catch (e: Exception) {
        }
    }

    private fun startOneMinuteCountdown(initialDurationMs: Long = 60_000L) {
        countDownTimer?.cancel()
        val safeDurationMs = initialDurationMs.coerceIn(5_000L, 60_000L)
        remainingCountdownMillis = safeDurationMs
        countDownTimer = object : CountDownTimer(safeDurationMs, 1_000L) {
            override fun onTick(millisUntilFinished: Long) {
                remainingCountdownMillis = millisUntilFinished
                val secs = ((millisUntilFinished + 999L) / 1000L).toInt().coerceIn(0, 60)
                val formatted = String.format("00:%02d", secs)
                timerTextView?.text = if (isPersian) toPersianDigits(formatted) else formatted
                val trackWidth = progressTrackView?.width ?: 0
                if (trackWidth > 0) {
                    val newWidth = ((millisUntilFinished.toFloat() / 60_000f) * trackWidth).toInt().coerceAtLeast(0)
                    val lp = progressFillView?.layoutParams
                    if (lp != null) {
                        lp.width = newWidth
                        progressFillView?.layoutParams = lp
                    }
                }
            }

            override fun onFinish() {
                remainingCountdownMillis = 0L
                // Only mute the alarm audio after 60 seconds; NEVER close the full-screen Activity until the user reacts!
                muteReminderAudioOnly()
            }
        }.start()
    }

    private fun stopGeofenceAlertIfNeeded(cancelStatusBarNotif: Boolean, stopOperationCompletely: Boolean = false) {
        if (!isGeofencePopup) return
        try {
            if (stopOperationCompletely) {
                YaadGeofenceService.stopGeofenceOperationForItem(
                    this,
                    geofenceItemId,
                    if (cancelStatusBarNotif) notificationId else Int.MIN_VALUE
                )
            } else {
                YaadGeofenceService.stopGeofenceAudio(
                    this,
                    if (cancelStatusBarNotif) notificationId else Int.MIN_VALUE
                )
            }
        } catch (e: Exception) {
        }
    }

    private fun performSnoozeGeofenceAction() {
        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()
        clearSuspendedGeofenceIfMatching(geofenceItemId)
        try {
            YaadGeofenceService.snoozeGeofenceItemForPassingThrough(
                this,
                geofenceItemId,
                30 * 60_000L,
                notificationId
            )
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    private fun performBackgroundAction(actionId: String) {
        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()
        clearSuspendedPopupForNotification(this, notificationId)
        if (isGeofencePopup) {
            clearSuspendedGeofenceIfMatching(geofenceItemId)
            if (actionId == "snooze") {
                performSnoozeGeofenceAction()
                return
            }
            stopGeofenceAlertIfNeeded(
                cancelStatusBarNotif = (actionId == "done"),
                stopOperationCompletely = (actionId == "done")
            )
            finish()
            overridePendingTransition(0, 0)
            return
        }
        try {
            val broadcastIntent = Intent(this, NotificationDismissReceiver::class.java)
            broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            broadcastIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, actionId)
            if (sourceJson != null) {
                broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            sendBroadcast(broadcastIntent)
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    private fun ensureTransitionBackdropView() {
        if (hasContentViewSet) return
        try {
            hasContentViewSet = true
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.setDimAmount(0f)
            val v = View(this)
            v.setBackgroundColor(Color.parseColor("#07070D"))
            setContentView(v)
        } catch (e: Exception) {
        }
    }

    private fun finishAfterHandoff() {
        try {
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.setDimAmount(0f)
        } catch (e: Exception) {
        }
        releaseScreenWakeLock()
        uiHandler.postDelayed({
            try {
                if (!isFinishing && !isDestroyed) {
                    finish()
                    overridePendingTransition(0, 0)
                }
            } catch (e: Exception) {
            }
        }, 180L)
    }

    private fun runAfterKeyguardUnlockIfNeeded(isDirectTrampoline: Boolean, onReady: () -> Unit) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                if (km != null && km.isKeyguardLocked) {
                    km.requestDismissKeyguard(
                        this,
                        object : KeyguardManager.KeyguardDismissCallback() {
                            override fun onDismissSucceeded() {
                                runOnUiThread {
                                    if (!isFinishing && !isDestroyed) {
                                        onReady()
                                    }
                                }
                            }

                            override fun onDismissCancelled() {
                                runOnUiThread {
                                    if (isDirectTrampoline && !isFinishing && !isDestroyed) {
                                        finishAfterHandoff()
                                    }
                                }
                            }

                            override fun onDismissError() {
                                runOnUiThread {
                                    if (!isFinishing && !isDestroyed) {
                                        onReady()
                                    }
                                }
                            }
                        }
                    )
                    return
                }
            }
        } catch (e: Exception) {
        }
        onReady()
    }

    private fun buildMainActivityLaunchIntent(actionId: String): Intent? {
        return try {
            val intent = packageManager.getLaunchIntentForPackage(packageName)
                ?: Intent().apply {
                    setClassName(packageName, "\$packageName.MainActivity")
                }
            intent.action = Intent.ACTION_MAIN
            intent.addCategory(Intent.CATEGORY_LAUNCHER)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            intent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            intent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, actionId)
            if (sourceJson != null) {
                intent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            intent.putExtra("yaad_from_popup", true)
            intent
        } catch (e: Exception) {
            null
        }
    }

    private fun performDirectionsAction(isDirectTrampoline: Boolean = false) {
        countDownTimer?.cancel()
        stopPulseAnimators()
        YaadGeofenceService.pauseGeofenceItemTemporarily(
            this,
            geofenceItemId,
            30 * 60_000L,
            notificationId
        )
        try {
            if (notificationId != Int.MIN_VALUE) {
                NotificationManagerCompat.from(this).cancel(notificationId)
            }
        } catch (e: Exception) {
        }
        runAfterKeyguardUnlockIfNeeded(isDirectTrampoline) {
            YaadGeofenceService.launchGoogleMapsDirections(
                this,
                targetLatitude,
                targetLongitude,
                cleanLocationTitle
            )
            finishAfterHandoff()
        }
    }

    private fun performTapOpenTimelineAction() {
        countDownTimer?.cancel()
        stopPulseAnimators()
        if (isGeofencePopup) {
            stopGeofenceAlertIfNeeded(cancelStatusBarNotif = true)
        }
        try {
            val broadcastIntent = Intent(this, NotificationDismissReceiver::class.java)
            broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            broadcastIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "mute_after_1m")
            if (sourceJson != null) {
                broadcastIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
            }
            sendBroadcast(broadcastIntent)
        } catch (e: Exception) {
        }

        val dataJson = JSObject()
        dataJson.put("actionId", "tap")
        dataJson.put("actionTimestamp", System.currentTimeMillis())
        if (requestJson != null) {
            dataJson.put("notification", requestJson)
        }

        runAfterKeyguardUnlockIfNeeded(isDirectTrampoline = false) {
            val launchIntent = buildMainActivityLaunchIntent("tap")
            if (launchIntent != null) {
                try {
                    startActivity(launchIntent)
                } catch (e: Exception) {
                    LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
                }
            } else {
                LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
            }
            finishAfterHandoff()
        }
    }

    private fun performEditAction(isDirectTrampoline: Boolean = false) {
        countDownTimer?.cancel()
        stopPulseAnimators()
        if (isGeofencePopup) {
            YaadGeofenceService.pauseGeofenceItemTemporarily(
                this,
                geofenceItemId,
                30 * 60_000L,
                notificationId
            )
        }
        try {
            if (notificationId != Int.MIN_VALUE) {
                NotificationManagerCompat.from(this).cancel(notificationId)
                val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val muteIntent = Intent(this, NotificationDismissReceiver::class.java)
                var flags = PendingIntent.FLAG_NO_CREATE
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags = flags or PendingIntent.FLAG_MUTABLE
                }
                val mutePi = PendingIntent.getBroadcast(this, notificationId + 500000, muteIntent, flags)
                if (mutePi != null) {
                    alarmManager.cancel(mutePi)
                    mutePi.cancel()
                }
            }
        } catch (e: Exception) {
        }

        val dataJson = JSObject()
        dataJson.put("actionId", "edit")
        dataJson.put("actionTimestamp", System.currentTimeMillis())
        if (requestJson != null) {
            dataJson.put("notification", requestJson)
        }

        runAfterKeyguardUnlockIfNeeded(isDirectTrampoline) {
            val launchIntent = buildMainActivityLaunchIntent("edit")
            if (launchIntent != null) {
                try {
                    startActivity(launchIntent)
                } catch (e: Exception) {
                    LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
                }
            } else {
                LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
            }
            finishAfterHandoff()
        }
    }

    override fun onDestroy() {
        unregisterCallInterceptionListeners()
        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()
        if (activeInstance?.get() === this) {
            activeInstance = null
            if (!isYieldingForPhoneCall) {
                activeBundledTimedReminders.clear()
            }
        }
        super.onDestroy()
    }

    companion object {
        private const val CALL_SUSPEND_PREFS = "YAAD_CALL_SUSPEND_PREFS"
        const val ACTION_ALARM_CLOCK_LAUNCH_POPUP = "com.capacitorjs.plugins.localnotifications.ALARM_CLOCK_LAUNCH_POPUP"
        const val SCREEN_ON_KEEP_AWAKE_MS = 60_000L          // 1 minute keep-awake when screen is ON (in Android launcher, other apps, or lockscreen)
        const val SCREEN_OFF_KEEP_AWAKE_MS = 21 * 60_000L   // 21 minutes keep-awake when screen is OFF
        private var activeInstance: WeakReference<YaadAlarmPopupActivity>? = null
        private var activeNotificationId: Int = Int.MIN_VALUE
        private val activeBundledTimedReminders = java.util.LinkedHashMap<Int, JSObject>()
        @Volatile
        private var pendingAlarmClockTriggerAtMs: Long = 0L
        @Volatile
        private var pendingAlarmClockNotifId: Int = Int.MIN_VALUE

        fun isShowingAnyPopup(): Boolean {
            val act = activeInstance?.get() ?: return false
            return !act.isFinishing && !act.isDestroyed
        }

        fun isScreenCurrentlyInteractive(context: Context): Boolean {
            return try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                    pm?.isInteractive != false
                } else {
                    @Suppress("DEPRECATION")
                    pm?.isScreenOn != false
                }
            } catch (e: Exception) {
                true
            }
        }

        /**
         * Creates an Activity PendingIntent with Android 14+ (API 34/35) BAL (Background Activity Launch)
         * creator and sender privileges explicitly enabled so fullScreenIntent, Notification contentIntent,
         * and AlarmClock showIntent can always launch YaadAlarmPopupActivity from outside the app.
         */
        fun createBalAllowedActivityPendingIntent(
            context: Context,
            requestCode: Int,
            intent: Intent,
            flags: Int
        ): PendingIntent {
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    val opts = android.app.ActivityOptions.makeBasic()
                    try {
                        val creatorMethod = android.app.ActivityOptions::class.java.getMethod(
                            "setPendingIntentCreatorBackgroundActivityStartMode",
                            Int::class.javaPrimitiveType
                        )
                        creatorMethod.invoke(opts, 1) // MODE_BACKGROUND_ACTIVITY_START_ALLOWED = 1
                    } catch (ignore: Exception) {
                    }
                    try {
                        val senderMethod = android.app.ActivityOptions::class.java.getMethod(
                            "setPendingIntentBackgroundActivityStartMode",
                            Int::class.javaPrimitiveType
                        )
                        senderMethod.invoke(opts, 1) // MODE_BACKGROUND_ACTIVITY_START_ALLOWED = 1
                    } catch (ignore: Exception) {
                    }
                    return PendingIntent.getActivity(context, requestCode, intent, flags, opts.toBundle())
                } catch (e: Exception) {
                }
            }
            return PendingIntent.getActivity(context, requestCode, intent, flags)
        }

        /**
         * When SYSTEM_ALERT_WINDOW ("Display over other apps") is granted, briefly attaches a 1x1 transparent
         * overlay window before calling startActivity() so Android 10–15 WindowProcessController.hasVisibleWindow()
         * evaluates to true and allows instant Activity launch over Android Home / other apps.
         */
        private fun attachTemporaryOverlayBridgeWindowIfPermitted(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
            try {
                if (!Settings.canDrawOverlays(context)) return
                val appCtx = context.applicationContext
                callMonitorHandler.post {
                    try {
                        val wm = appCtx.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return@post
                        val bridgeView = View(appCtx).apply { alpha = 0.01f }
                        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        } else {
                            @Suppress("DEPRECATION")
                            WindowManager.LayoutParams.TYPE_PHONE
                        }
                        val lp = WindowManager.LayoutParams(
                            1,
                            1,
                            overlayType,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                            PixelFormat.TRANSLUCENT
                        ).apply {
                            gravity = Gravity.TOP or Gravity.START
                        }
                        wm.addView(bridgeView, lp)
                        callMonitorHandler.postDelayed({
                            try {
                                wm.removeView(bridgeView)
                            } catch (e: Exception) {
                            }
                        }, 650L)
                    } catch (e: Exception) {
                    }
                }
            } catch (e: Exception) {
            }
        }

        fun launchFromAlarmBroadcast(context: Context, broadcastIntent: Intent) {
            try {
                pendingAlarmClockTriggerAtMs = 0L
                val notifId = broadcastIntent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
                if (notifId == Int.MIN_VALUE) return
                val srcJson = broadcastIntent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY)
                val wakeOnce = broadcastIntent.getBooleanExtra("yaad_wake_screen_once", true)
                val wasScreenOff = broadcastIntent.getBooleanExtra("yaad_launched_from_screen_off", false)
                val keepAwakeMs = broadcastIntent.getLongExtra(
                    "yaad_keep_screen_on_duration_ms",
                    if (wasScreenOff) SCREEN_OFF_KEEP_AWAKE_MS else SCREEN_ON_KEEP_AWAKE_MS
                )
                val remMs = broadcastIntent.getLongExtra("yaad_resume_remaining_ms", 60_000L)
                val audioMuted = broadcastIntent.getBooleanExtra("yaad_resume_audio_muted", false)

                if (isShowingAnyPopup() && activeNotificationId == notifId) {
                    return
                }

                if (wakeOnce) {
                    try {
                        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                        if (pm != null) {
                            @Suppress("DEPRECATION")
                            val wl = pm.newWakeLock(
                                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                                    PowerManager.ON_AFTER_RELEASE,
                                "yaad:alarmBroadcastWakeLock"
                            )
                            wl.setReferenceCounted(false)
                            wl.acquire(keepAwakeMs)
                        }
                    } catch (e: Exception) {
                    }
                }

                val actIntent = Intent(context, YaadAlarmPopupActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                        Intent.FLAG_ACTIVITY_NO_USER_ACTION
                    putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notifId)
                    putExtra("yaad_wake_screen_once", wakeOnce)
                    putExtra("yaad_launched_from_screen_off", wasScreenOff)
                    putExtra("yaad_keep_screen_on_duration_ms", keepAwakeMs)
                    putExtra("yaad_resume_remaining_ms", remMs)
                    putExtra("yaad_resume_audio_muted", audioMuted)
                    if (srcJson != null) {
                        putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, srcJson)
                    }
                }
                attachTemporaryOverlayBridgeWindowIfPermitted(context)
                try {
                    context.startActivity(actIntent)
                } catch (e: Exception) {
                }
                try {
                    var piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        piFlags = piFlags or PendingIntent.FLAG_IMMUTABLE
                    }
                    val pi = createBalAllowedActivityPendingIntent(context, notifId + 760000, actIntent, piFlags)
                    if (Build.VERSION.SDK_INT >= 34) {
                        val opts = android.app.ActivityOptions.makeBasic()
                        try {
                            val method = android.app.ActivityOptions::class.java.getMethod(
                                "setPendingIntentBackgroundActivityStartMode",
                                Int::class.javaPrimitiveType
                            )
                            method.invoke(opts, 1)
                        } catch (ignore: Exception) {
                        }
                        pi.send(context, 0, null, null, null, null, opts.toBundle())
                    } else {
                        pi.send()
                    }
                } catch (e: Exception) {
                }
            } catch (e: Exception) {
            }
        }

        @Volatile
        internal var lastBroadcastCallActive: Boolean = false
        @Volatile
        private var isPopupSuspendedForCall: Boolean = false
        @Volatile
        private var suspendedNotifId: Int = Int.MIN_VALUE
        @Volatile
        private var suspendedSourceJson: String? = null
        @Volatile
        private var suspendedIsGeofence: Boolean = false
        @Volatile
        private var suspendedGeofenceItemId: String = ""
        @Volatile
        private var suspendedRemainingMs: Long = 60_000L
        @Volatile
        private var suspendedAudioMuted: Boolean = false
        private val suspendedBundledMap = java.util.LinkedHashMap<Int, JSObject>()

        private val callMonitorHandler = Handler(Looper.getMainLooper())
        private var callMonitorWakeLock: PowerManager.WakeLock? = null
        private var isCallMonitorRunning: Boolean = false
        private var consecutiveCallIdleTicks: Int = 0
        private var callMonitorAppContext: Context? = null

        /**
         * Reliably detects whether the phone is currently ringing (incoming cellular or VoIP call)
         * or in an active phone/communication call across all Android versions without requiring runtime permissions.
         */
        fun isPhoneCallActiveOrRinging(context: Context): Boolean {
            try {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                if (am != null) {
                    val mode = am.mode
                    if (
                        mode == AudioManager.MODE_RINGTONE ||
                        mode == AudioManager.MODE_IN_CALL ||
                        mode == AudioManager.MODE_IN_COMMUNICATION ||
                        mode == 4 // AudioManager.MODE_CALL_SCREENING
                    ) {
                        return true
                    }
                }
            } catch (e: Exception) {
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
                    if (telecom != null && telecom.isInCall) {
                        return true
                    }
                } catch (se: SecurityException) {
                } catch (e: Exception) {
                }
            }

            try {
                val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                if (tm != null) {
                    @Suppress("DEPRECATION")
                    val callState = tm.callState
                    if (
                        callState == TelephonyManager.CALL_STATE_RINGING ||
                        callState == TelephonyManager.CALL_STATE_OFFHOOK
                    ) {
                        return true
                    }
                    if (callState == TelephonyManager.CALL_STATE_IDLE) {
                        lastBroadcastCallActive = false
                    }
                }
            } catch (se: SecurityException) {
            } catch (e: Exception) {
            }

            return lastBroadcastCallActive
        }

        fun yieldActivePopupForPhoneCall(context: Context) {
            val act = activeInstance?.get() ?: return
            act.runOnUiThread {
                try {
                    if (!act.isFinishing && !act.isDestroyed) {
                        act.suspendAndYieldForIncomingCall()
                    }
                } catch (e: Exception) {
                }
            }
        }

        fun suspendGeofencePopupForPhoneCall(
            context: Context,
            notificationId: Int,
            sourceJson: String?,
            geofenceItemId: String
        ) {
            val appCtx = context.applicationContext
            isPopupSuspendedForCall = true
            suspendedIsGeofence = true
            suspendedNotifId = notificationId
            suspendedSourceJson = sourceJson
            suspendedGeofenceItemId = geofenceItemId
            try {
                appCtx.getSharedPreferences(CALL_SUSPEND_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("active", true)
                    .putBoolean("is_geofence", true)
                    .putInt("notif_id", notificationId)
                    .putString("source_json", sourceJson ?: "")
                    .putString("geofence_item_id", geofenceItemId)
                    .apply()
            } catch (e: Exception) {
            }
            try {
                YaadGeofenceService.pauseSonarForPhoneCall(appCtx)
            } catch (e: Exception) {
            }
            startCallEndMonitor(appCtx)
        }

        fun suspendTimedReminderForPhoneCall(
            context: Context,
            notificationId: Int,
            sourceJson: String?,
            remainingMs: Long = 60_000L,
            audioMuted: Boolean = false
        ) {
            val appCtx = context.applicationContext
            isPopupSuspendedForCall = true
            suspendedIsGeofence = false
            suspendedNotifId = notificationId
            suspendedSourceJson = sourceJson
            suspendedRemainingMs = remainingMs.coerceIn(5_000L, 60_000L)
            suspendedAudioMuted = audioMuted
            suspendedBundledMap.clear()
            suspendedBundledMap.putAll(activeBundledTimedReminders)

            // Cancel the 1m auto-mute alarm while call is in progress; we will reschedule the remaining time when the call ends
            try {
                if (notificationId != Int.MIN_VALUE) {
                    val alarmManager = appCtx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                    val muteIntent = Intent(appCtx, NotificationDismissReceiver::class.java)
                    var flags = PendingIntent.FLAG_NO_CREATE
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        flags = flags or PendingIntent.FLAG_MUTABLE
                    }
                    val mutePi = PendingIntent.getBroadcast(appCtx, notificationId + 500000, muteIntent, flags)
                    if (mutePi != null && alarmManager != null) {
                        alarmManager.cancel(mutePi)
                        mutePi.cancel()
                    }
                }
            } catch (e: Exception) {
            }

            try {
                appCtx.getSharedPreferences(CALL_SUSPEND_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("active", true)
                    .putBoolean("is_geofence", false)
                    .putInt("notif_id", notificationId)
                    .putString("source_json", sourceJson ?: "")
                    .putLong("remaining_ms", suspendedRemainingMs)
                    .putBoolean("audio_muted", audioMuted)
                    .apply()
            } catch (e: Exception) {
            }
            startCallEndMonitor(appCtx)
        }

        fun clearSuspendedPopupForNotification(context: Context?, notificationId: Int) {
            suspendedBundledMap.remove(notificationId)
            if (suspendedNotifId == notificationId || notificationId == Int.MIN_VALUE) {
                if (!suspendedIsGeofence && suspendedBundledMap.isNotEmpty()) {
                    val nextEntry = suspendedBundledMap.entries.first()
                    suspendedNotifId = nextEntry.key
                    suspendedSourceJson = nextEntry.value.toString()
                    return
                }
                isPopupSuspendedForCall = false
                suspendedNotifId = Int.MIN_VALUE
                suspendedSourceJson = null
                suspendedGeofenceItemId = ""
                if (context != null) {
                    try {
                        context.applicationContext
                            .getSharedPreferences(CALL_SUSPEND_PREFS, Context.MODE_PRIVATE)
                            .edit()
                            .clear()
                            .apply()
                    } catch (e: Exception) {
                    }
                }
            }
        }

        fun clearSuspendedGeofenceIfMatching(itemId: String) {
            val cleanTarget = itemId.removePrefix("loc_").removePrefix("rem_")
            val cleanSuspended = suspendedGeofenceItemId.removePrefix("loc_").removePrefix("rem_")
            if (
                suspendedIsGeofence &&
                (itemId.isEmpty() || suspendedGeofenceItemId.isEmpty() || cleanTarget == cleanSuspended)
            ) {
                isPopupSuspendedForCall = false
                suspendedNotifId = Int.MIN_VALUE
                suspendedSourceJson = null
                suspendedGeofenceItemId = ""
                callMonitorAppContext?.let { ctx ->
                    try {
                        ctx.getSharedPreferences(CALL_SUSPEND_PREFS, Context.MODE_PRIVATE)
                            .edit()
                            .clear()
                            .apply()
                    } catch (e: Exception) {
                    }
                }
            }
        }

        private val callMonitorRunnable = object : Runnable {
            override fun run() {
                val appCtx = callMonitorAppContext
                if (appCtx == null) {
                    isCallMonitorRunning = false
                    releaseCallMonitorWakeLock()
                    return
                }

                val callStillActive = isPhoneCallActiveOrRinging(appCtx)
                if (callStillActive) {
                    consecutiveCallIdleTicks = 0
                    yieldActivePopupForPhoneCall(appCtx)
                    callMonitorHandler.postDelayed(this, 400L)
                    return
                }

                consecutiveCallIdleTicks++
                // Wait 2 consecutive idle ticks (~800ms) so the transition from RINGING -> IN_CALL or InCallUI closing animation completes cleanly
                if (consecutiveCallIdleTicks < 2) {
                    callMonitorHandler.postDelayed(this, 400L)
                    return
                }

                isCallMonitorRunning = false
                consecutiveCallIdleTicks = 0
                releaseCallMonitorWakeLock()
                restoreSuspendedPopupAfterCall(appCtx)
            }
        }

        private fun startCallEndMonitor(context: Context) {
            val appCtx = context.applicationContext
            callMonitorAppContext = appCtx
            consecutiveCallIdleTicks = 0
            try {
                if (callMonitorWakeLock?.isHeld != true) {
                    val pm = appCtx.getSystemService(Context.POWER_SERVICE) as? PowerManager
                    if (pm != null) {
                        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yaad:callRestoreMonitorWakeLock")
                        wl.setReferenceCounted(false)
                        wl.acquire(30 * 60_000L)
                        callMonitorWakeLock = wl
                    }
                }
            } catch (e: Exception) {
            }
            if (!isCallMonitorRunning) {
                isCallMonitorRunning = true
                callMonitorHandler.removeCallbacks(callMonitorRunnable)
                callMonitorHandler.postDelayed(callMonitorRunnable, 400L)
            }
        }

        private fun releaseCallMonitorWakeLock() {
            try {
                callMonitorWakeLock?.let { wl ->
                    if (wl.isHeld) wl.release()
                }
            } catch (e: Exception) {
            }
            callMonitorWakeLock = null
        }

        fun restoreSuspendedPopupAfterCall(context: Context) {
            val appCtx = context.applicationContext
            if (isPhoneCallActiveOrRinging(appCtx)) {
                startCallEndMonitor(appCtx)
                return
            }

            val prefs = appCtx.getSharedPreferences(CALL_SUSPEND_PREFS, Context.MODE_PRIVATE)
            val hasPrefsSuspended = prefs.getBoolean("active", false)
            if (!isPopupSuspendedForCall && !hasPrefsSuspended) {
                // Also check if YaadGeofenceService has an active unacknowledged geofence alert that was paused by the call
                YaadGeofenceService.restoreGeofenceAlertAfterPhoneCall(appCtx)
                return
            }

            val wasGeofence = if (isPopupSuspendedForCall) suspendedIsGeofence else prefs.getBoolean("is_geofence", false)
            val notifId = if (isPopupSuspendedForCall) suspendedNotifId else prefs.getInt("notif_id", Int.MIN_VALUE)
            val srcJson = if (isPopupSuspendedForCall) suspendedSourceJson else prefs.getString("source_json", null)
            val remMs = if (isPopupSuspendedForCall) suspendedRemainingMs else prefs.getLong("remaining_ms", 60_000L)
            val wasMuted = if (isPopupSuspendedForCall) suspendedAudioMuted else prefs.getBoolean("audio_muted", false)

            isPopupSuspendedForCall = false
            suspendedNotifId = Int.MIN_VALUE
            suspendedSourceJson = null
            suspendedGeofenceItemId = ""
            try {
                prefs.edit().clear().apply()
            } catch (e: Exception) {
            }

            if (wasGeofence) {
                YaadGeofenceService.restoreGeofenceAlertAfterPhoneCall(appCtx)
                return
            }

            if (notifId == Int.MIN_VALUE || srcJson.isNullOrEmpty()) return

            // Verify timed reminder notification wasn't already dismissed/completed from status bar during the call
            var isStillActiveInStatusBar = false
            try {
                val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                if (nm != null) {
                    for (active in nm.activeNotifications) {
                        if (active.id == notifId || suspendedBundledMap.containsKey(active.id)) {
                            isStillActiveInStatusBar = true
                            break
                        }
                    }
                }
            } catch (e: Exception) {
                isStillActiveInStatusBar = true
            }

            val storage = NotificationStorage(appCtx)
            val savedNotif = storage.getSavedNotification(notifId.toString())
            if (!isStillActiveInStatusBar && (savedNotif == null || savedNotif.cancelled)) {
                suspendedBundledMap.clear()
                return
            }

            if (suspendedBundledMap.isNotEmpty()) {
                activeBundledTimedReminders.clear()
                activeBundledTimedReminders.putAll(suspendedBundledMap)
                suspendedBundledMap.clear()
            }

            // Re-post insistent notification audio and schedule remaining countdown if not muted
            if (!wasMuted && remMs > 2_000L) {
                try {
                    val restoredJson = JSObject(srcJson)
                    restoredJson.remove("schedule")
                    val currentCh = restoredJson.optString("channelId", "")
                    if (currentCh == "yaad_channel_v2_silent" || currentCh.isEmpty()) {
                        restoredJson.put("channelId", "yaad_channel_v2_default")
                    }
                    val localNotif = LocalNotification.buildNotificationFromJSObject(restoredJson)
                    val manager = LocalNotificationManager(storage, null, appCtx, CapConfig.loadDefault(appCtx))
                    manager.schedule(null, listOf(localNotif))

                    val alarmManager = appCtx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                    if (alarmManager != null) {
                        val muteIntent = Intent(appCtx, NotificationDismissReceiver::class.java).apply {
                            putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notifId)
                            putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "mute_after_1m")
                            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, srcJson)
                        }
                        var piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            piFlags = piFlags or PendingIntent.FLAG_MUTABLE
                        }
                        val pi = PendingIntent.getBroadcast(appCtx, notifId + 500000, muteIntent, piFlags)
                        val triggerAt = System.currentTimeMillis() + remMs
                        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
                        if (canExact) {
                            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                        } else {
                            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                        }
                    }
                } catch (e: Exception) {
                }
            }

            launch(
                appCtx,
                notifId,
                srcJson,
                wakeScreenOnce = true,
                resumeRemainingMs = remMs,
                resumeAudioMuted = wasMuted
            )
        }

        fun isShowingGeofencePopup(): Boolean {
            val act = activeInstance?.get() ?: return false
            return !act.isFinishing && !act.isDestroyed && act.isGeofencePopup
        }

        fun updateLiveGeofenceDistance(
            distanceMeters: Int,
            radiusMeters: Int,
            sub10m: Boolean,
            bearingDeg: Float = 300f,
            sonarMode: String = "enter",
            visualOnly: Boolean = false
        ) {
            val act = activeInstance?.get() ?: return
            if (!act.isGeofencePopup) return
            act.runOnUiThread {
                try {
                    if (!act.isFinishing && !act.isDestroyed) {
                        act.distanceBadgeTextView?.text = act.formatDistanceLabel(
                            distanceMeters,
                            sub10m || act.isSub10mArrival
                        )
                        act.livePolarRadarView?.updateLiveState(
                            distanceMeters,
                            radiusMeters,
                            bearingDeg,
                            sonarMode,
                            visualOnly
                        )
                        act.applyAdaptivePulseDuration(distanceMeters, radiusMeters, sonarMode)
                    }
                } catch (e: Exception) {
                }
            }
        }

        fun onReminderAudioMutedAfterOneMinute(notificationId: Int) {
            val act = activeInstance?.get() ?: return
            if (activeNotificationId == notificationId || notificationId == Int.MIN_VALUE) {
                act.runOnUiThread {
                    try {
                        if (!act.isFinishing && !act.isDestroyed && !act.isGeofencePopup) {
                            act.isReminderAudioMuted = true
                            act.countDownTimer?.cancel()
                            val lp = act.progressFillView?.layoutParams
                            if (lp != null) {
                                lp.width = 0
                                act.progressFillView?.layoutParams = lp
                            }
                            act.reminderAudioMutedView?.text =
                                if (act.isPersian) "🔕 صدا قطع شد (در انتظار واکنش شما)" else "🔕 Audio Muted (Awaiting Action)"
                            act.reminderAudioMutedView?.alpha = 0.7f
                        }
                    } catch (e: Exception) {
                    }
                }
            }
        }

        fun dismissIfMatching(notificationId: Int) {
            activeBundledTimedReminders.remove(notificationId)
            val act = activeInstance?.get() ?: return
            if (!act.isGeofencePopup && activeBundledTimedReminders.isNotEmpty()) {
                act.runOnUiThread {
                    try {
                        if (!act.isFinishing && !act.isDestroyed) {
                            val themeName = act.requestJson?.optJSONObject("extra")?.optString("theme", "dark-gold") ?: "dark-gold"
                            act.buildBundledTimedRemindersUI(act.resolvePalette(themeName))
                        }
                    } catch (e: Exception) {
                    }
                }
                return
            }
            if (activeNotificationId == notificationId || notificationId == Int.MIN_VALUE || activeBundledTimedReminders.isEmpty()) {
                act.runOnUiThread {
                    try {
                        if (!act.isFinishing && !act.isDestroyed) {
                            act.countDownTimer?.cancel()
                            act.stopPulseAnimators()
                            act.releaseScreenWakeLock()
                            act.finish()
                            act.overridePendingTransition(0, 0)
                        }
                    } catch (e: Exception) {
                    }
                }
            }
        }

        fun launch(
            context: Context,
            notificationId: Int,
            sourceJson: String?,
            wakeScreenOnce: Boolean = true,
            resumeRemainingMs: Long = 60_000L,
            resumeAudioMuted: Boolean = false,
            forceScreenOffDuration: Boolean = false
        ) {
            if (isPhoneCallActiveOrRinging(context)) {
                val isGeo = try {
                    sourceJson != null && JSObject(sourceJson).optJSONObject("extra")?.optBoolean("geofence", false) == true
                } catch (e: Exception) {
                    false
                }
                if (isGeo) {
                    val gItemId = try {
                        if (sourceJson != null) JSObject(sourceJson).optJSONObject("extra")?.optString("geofenceItemId", "") ?: "" else ""
                    } catch (e: Exception) {
                        ""
                    }
                    suspendGeofencePopupForPhoneCall(context, notificationId, sourceJson, gItemId)
                } else {
                    suspendTimedReminderForPhoneCall(context, notificationId, sourceJson, resumeRemainingMs, resumeAudioMuted)
                }
                return
            }

            // Evaluate screen-off state BEFORE acquiring any wake lock so 21-minute vs 1-minute duration is 100% accurate
            val wasScreenOff = forceScreenOffDuration ||
                !isScreenCurrentlyInteractive(context) ||
                YaadGeofenceService.isInScreenOffSession
            val keepScreenOnDurationMs = if (wasScreenOff) SCREEN_OFF_KEEP_AWAKE_MS else SCREEN_ON_KEEP_AWAKE_MS

            if (wakeScreenOnce) {
                try {
                    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                    if (pm != null) {
                        @Suppress("DEPRECATION")
                        val wl = pm.newWakeLock(
                            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                                PowerManager.ON_AFTER_RELEASE,
                            "yaad:popupDirectLaunchWakeLock"
                        )
                        wl.setReferenceCounted(false)
                        wl.acquire(keepScreenOnDurationMs)
                    }
                } catch (e: Exception) {
                }
            }

            val intent = Intent(context, YaadAlarmPopupActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                putExtra("yaad_wake_screen_once", wakeScreenOnce)
                putExtra("yaad_launched_from_screen_off", wasScreenOff)
                putExtra("yaad_keep_screen_on_duration_ms", keepScreenOnDurationMs)
                putExtra("yaad_resume_remaining_ms", resumeRemainingMs)
                putExtra("yaad_resume_audio_muted", resumeAudioMuted)
                if (sourceJson != null) {
                    putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                }
            }

            // If an instance of YaadAlarmPopupActivity is already alive, update its intent on UI thread immediately
            val existingAct = activeInstance?.get()
            if (existingAct != null && !existingAct.isFinishing && !existingAct.isDestroyed) {
                existingAct.runOnUiThread {
                    try {
                        existingAct.onNewIntent(intent)
                    } catch (e: Exception) {
                    }
                }
                return
            }

            val appCtx = context.applicationContext
            attachTemporaryOverlayBridgeWindowIfPermitted(appCtx)

            try {
                context.startActivity(intent)
            } catch (e: Exception) {
                triggerAlarmClockFallbackLaunch(
                    appCtx,
                    notificationId,
                    sourceJson,
                    wakeScreenOnce,
                    wasScreenOff,
                    keepScreenOnDurationMs,
                    resumeRemainingMs,
                    resumeAudioMuted
                )
                return
            }

            // On Android 10–15 (API 29–35), calling startActivity() from a background service while the user is on
            // the Android Home screen or inside another app may be silently ignored by Background Activity Launch (BAL)
            // rules without throwing an exception.
            // Verify within 140ms that activeInstance is alive; if not, fire the BAL-exempt PendingIntent + AlarmClock launch!
            callMonitorHandler.postDelayed({
                val cur = activeInstance?.get()
                if (cur == null || cur.isFinishing || cur.isDestroyed) {
                    triggerAlarmClockFallbackLaunch(
                        appCtx,
                        notificationId,
                        sourceJson,
                        wakeScreenOnce,
                        wasScreenOff,
                        keepScreenOnDurationMs,
                        resumeRemainingMs,
                        resumeAudioMuted
                    )
                }
            }, 140L)
        }

        private fun triggerAlarmClockFallbackLaunch(
            context: Context,
            notificationId: Int,
            sourceJson: String?,
            wakeScreenOnce: Boolean,
            wasScreenOff: Boolean,
            keepScreenOnDurationMs: Long,
            resumeRemainingMs: Long,
            resumeAudioMuted: Boolean
        ) {
            try {
                val appCtx = context.applicationContext
                attachTemporaryOverlayBridgeWindowIfPermitted(appCtx)

                val fallbackIntent = Intent(appCtx, YaadAlarmPopupActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                        Intent.FLAG_ACTIVITY_NO_USER_ACTION
                    putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                    putExtra("yaad_wake_screen_once", wakeScreenOnce)
                    putExtra("yaad_launched_from_screen_off", wasScreenOff)
                    putExtra("yaad_keep_screen_on_duration_ms", keepScreenOnDurationMs)
                    putExtra("yaad_resume_remaining_ms", resumeRemainingMs)
                    putExtra("yaad_resume_audio_muted", resumeAudioMuted)
                    if (sourceJson != null) {
                        putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                    }
                }
                var actPiFlags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    actPiFlags = actPiFlags or PendingIntent.FLAG_IMMUTABLE
                }
                val showPi = createBalAllowedActivityPendingIntent(
                    appCtx,
                    notificationId + 750000,
                    fallbackIntent,
                    actPiFlags
                )
                try {
                    if (Build.VERSION.SDK_INT >= 34) {
                        val opts = android.app.ActivityOptions.makeBasic()
                        try {
                            val method = android.app.ActivityOptions::class.java.getMethod(
                                "setPendingIntentBackgroundActivityStartMode",
                                Int::class.javaPrimitiveType
                            )
                            method.invoke(opts, 1) // MODE_BACKGROUND_ACTIVITY_START_ALLOWED = 1
                        } catch (ignore: Exception) {
                        }
                        showPi.send(appCtx, 0, null, null, null, null, opts.toBundle())
                    } else {
                        showPi.send()
                    }
                } catch (sendEx: Exception) {
                }

                // Schedule AlarmManager.setAlarmClock with LocalNotificationRestoreReceiver broadcast operation + showPi.
                // AlarmManager.setAlarmClock is exempt from Doze and grants explicit BAL whitelist token to the receiver!
                // Throttle so an already-pending AlarmClock for the same notification isn't reset before firing.
                val now = System.currentTimeMillis()
                if (pendingAlarmClockNotifId == notificationId && now < pendingAlarmClockTriggerAtMs + 1500L) {
                    return
                }
                val alarmManager = appCtx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                if (alarmManager != null) {
                    val bcastIntent = Intent(appCtx, LocalNotificationRestoreReceiver::class.java).apply {
                        action = ACTION_ALARM_CLOCK_LAUNCH_POPUP
                        putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                        putExtra("yaad_wake_screen_once", wakeScreenOnce)
                        putExtra("yaad_launched_from_screen_off", wasScreenOff)
                        putExtra("yaad_keep_screen_on_duration_ms", keepScreenOnDurationMs)
                        putExtra("yaad_resume_remaining_ms", resumeRemainingMs)
                        putExtra("yaad_resume_audio_muted", resumeAudioMuted)
                        if (sourceJson != null) {
                            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                        }
                    }
                    var bcastFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        bcastFlags = bcastFlags or PendingIntent.FLAG_IMMUTABLE
                    }
                    val operationPi = PendingIntent.getBroadcast(
                        appCtx,
                        notificationId + 770000,
                        bcastIntent,
                        bcastFlags
                    )
                    val triggerAt = now + 150L
                    pendingAlarmClockNotifId = notificationId
                    pendingAlarmClockTriggerAtMs = triggerAt
                    alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showPi), operationPi)
                }
            } catch (ex: Exception) {
            }
        }
    }
}
`;

// 9. Create YaadGeofenceService.kt for Out-of-App Background Geofence Monitoring
const geofenceServicePath = path.join(pluginDir, 'YaadGeofenceService.kt');
const geofenceServiceContent = `package com.capacitorjs.plugins.localnotifications

import android.Manifest
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

class YaadGeofenceService : Service(), LocationListener {

    private var locationManager: LocationManager? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isTrackingRegistered = false
    private var isScreenReceiverRegistered = false
    private var serviceCpuWakeLock: PowerManager.WakeLock? = null
    private var lastGpsFixTimeMs: Long = 0L
    private var lastAcceptedLocationTimeMs: Long = 0L
    private var lastAcceptedLat: Double = Double.NaN
    private var lastAcceptedLon: Double = Double.NaN
    private var lastAcceptedAccuracy: Float = Float.MAX_VALUE

    private fun acquireServiceCpuWakeLock() {
        try {
            if (serviceCpuWakeLock?.isHeld == true) return
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yaad:geofenceServiceCpuWakeLock")
            wl.setReferenceCounted(false)
            wl.acquire(4 * 60 * 60 * 1000L)
            serviceCpuWakeLock = wl
        } catch (e: Exception) {
        }
    }

    private fun releaseServiceCpuWakeLock() {
        try {
            serviceCpuWakeLock?.let { wl ->
                if (wl.isHeld) wl.release()
            }
        } catch (e: Exception) {
        }
        serviceCpuWakeLock = null
    }

    /**
     * BroadcastReceiver for Screen-Off & Screen-On on Lockscreen:
     * When a geofence alert is active and has NOT been closed with ✕, stopped, snoozed, edited, or navigated,
     * turning off or locking the phone screen (ACTION_SCREEN_OFF or ACTION_SCREEN_ON while locked)
     * immediately launches the full-screen geofence alert on the lockscreen!
     */
    private val screenStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (action == "android.intent.action.PHONE_STATE") {
                val stateStr = intent.getStringExtra("state")
                val inCall = stateStr == "RINGING" || stateStr == "OFFHOOK"
                YaadAlarmPopupActivity.lastBroadcastCallActive = inCall
                if (inCall) {
                    pauseSonarForPhoneCall(applicationContext)
                    YaadAlarmPopupActivity.yieldActivePopupForPhoneCall(applicationContext)
                }
                return
            }
            if (action == Intent.ACTION_SCREEN_OFF) {
                isInScreenOffSession = true
                mainHandler.postDelayed({
                    try {
                        relaunchActivePopupOnLockscreenIfNeeded(wakeScreen = true, allowWhenUnlockedOutOfApp = true)
                    } catch (e: Exception) {
                    }
                }, 80L)
            } else if (action == Intent.ACTION_SCREEN_ON) {
                mainHandler.postDelayed({
                    try {
                        relaunchActivePopupOnLockscreenIfNeeded(wakeScreen = false, allowWhenUnlockedOutOfApp = isInScreenOffSession)
                    } catch (e: Exception) {
                    }
                }, 80L)
            } else if (action == Intent.ACTION_USER_PRESENT) {
                isInScreenOffSession = false
            }
        }
    }

    private val periodicCheckRunnable = object : Runnable {
        override fun run() {
            try {
                if (!shouldRun(applicationContext)) {
                    stopGeofenceAudio(applicationContext)
                    cancelGpsDisabledWarningNotification(applicationContext)
                    releaseServiceCpuWakeLock()
                    stopSelf()
                    return
                }
                acquireServiceCpuWakeLock()
                val inCallNow = YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(applicationContext)
                if (inCallNow != wasInPhoneCallLastTick) {
                    wasInPhoneCallLastTick = inCallNow
                    LocalNotificationsPlugin.evaluateJsInWebView(
                        "window.dispatchEvent(new CustomEvent('yaad:phone-call-state', { detail: { active: \$inCallNow } }));"
                    )
                    if (inCallNow) {
                        pauseSonarForPhoneCall(applicationContext)
                        YaadAlarmPopupActivity.yieldActivePopupForPhoneCall(applicationContext)
                    }
                }
                checkLastKnownLocations()
            } catch (e: Exception) {
            }
            // 750ms check cycle for <= 1s geofence alert response
            mainHandler.postDelayed(this, 750L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        registerScreenStateReceiver()
        acquireServiceCpuWakeLock()
    }

    private fun registerScreenStateReceiver() {
        if (isScreenReceiverRegistered) return
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
                addAction("android.intent.action.PHONE_STATE")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(screenStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(screenStateReceiver, filter)
            }
            isScreenReceiverRegistered = true
        } catch (e: Exception) {
        }
    }

    private fun unregisterScreenStateReceiver() {
        if (!isScreenReceiverRegistered) return
        try {
            unregisterReceiver(screenStateReceiver)
        } catch (e: Exception) {
        }
        isScreenReceiverRegistered = false
    }

    private fun relaunchActivePopupOnLockscreenIfNeeded(
        wakeScreen: Boolean = false,
        allowWhenUnlockedOutOfApp: Boolean = false
    ) {
        if (YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(this)) return
        if (activeGeofenceNotificationId == Int.MIN_VALUE || activeGeofenceItemId.isEmpty()) {
            // If no active candidate is cached yet, evaluate last known location immediately
            checkLastKnownLocations()
            if (activeGeofenceNotificationId == Int.MIN_VALUE || activeGeofenceItemId.isEmpty()) return
        }
        val screenOffOrLocked = isInScreenOffSession || !isScreenInteractive() || isDeviceKeyguardLocked()
        if (!wakeScreen && !allowWhenUnlockedOutOfApp && !screenOffOrLocked) return
        // Note: When wakeScreen == true (triggered by ACTION_SCREEN_OFF), we MUST still wake the screen and
        // upgrade the keep-screen-on duration to 21 minutes even if YaadAlarmPopupActivity was already open!
        if (!wakeScreen && YaadAlarmPopupActivity.isShowingGeofencePopup()) return

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_ENABLED, false)) return
        val now = System.currentTimeMillis()
        val cleanId = activeGeofenceItemId.removePrefix("loc_").removePrefix("rem_")
        for (sfx in listOf(activeGeofenceItemId, cleanId, "loc_\$cleanId", "rem_\$cleanId")) {
            val pausedUntil = prefs.getLong("paused_until_\$sfx", 0L)
            if (pausedUntil > now) return
            if (prefs.getBoolean("completed_cycle_\$sfx", false)) return
        }

        val wasScreenOff = wakeScreen || isInScreenOffSession || !isScreenInteractive()
        val keepAwakeDurationMs = if (wasScreenOff) {
            YaadAlarmPopupActivity.SCREEN_OFF_KEEP_AWAKE_MS
        } else {
            YaadAlarmPopupActivity.SCREEN_ON_KEEP_AWAKE_MS
        }

        if (wasScreenOff) {
            wakeScreenForLockscreenAlert(keepAwakeDurationMs)
        }

        val isVisualOnly = activeGeofenceEventType == "visual_banner"
        val (notifTitle, notifBody) = buildStatusBarTitleAndBody(
            title = activeGeofenceTitle,
            statusPhrase = activeGeofenceDescription,
            distance = liveSonarDistanceMeters,
            radius = activeGeofenceRadius,
            isEn = activeGeofenceIsEn,
            visualOnlyBanner = isVisualOnly,
            visualBannerText = activeGeofenceCustomMessage
        )
        val sourceJsonStr = buildAndPostStatusBarNotification(
            notificationId = activeGeofenceNotificationId,
            id = activeGeofenceItemId,
            notifTitle = notifTitle,
            notifBody = notifBody,
            isSub10m = activeGeofenceEventType == "arrived_under_10m",
            distance = liveSonarDistanceMeters,
            radius = activeGeofenceRadius,
            targetLat = activeGeofenceLat,
            targetLon = activeGeofenceLon,
            isEn = activeGeofenceIsEn,
            isLiveUpdate = false,
            showFullScreen = true,
            postToStatusBar = true,
            visualOnlyBanner = isVisualOnly,
            visualBannerText = activeGeofenceCustomMessage,
            multiCardsJson = lastActiveMultiCardsJson,
            wasScreenOff = wasScreenOff,
            keepScreenOnDurationMs = keepAwakeDurationMs
        )
        YaadAlarmPopupActivity.launch(
            this,
            activeGeofenceNotificationId,
            sourceJsonStr,
            wakeScreenOnce = true,
            forceScreenOffDuration = wasScreenOff
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_DISABLE_GEOFENCE_RADAR) {
            disableGeofenceRadarFromBackground(applicationContext)
            stopLocationUpdates()
            releaseServiceCpuWakeLock()
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
            } catch (e: Exception) {
            }
            stopSelf()
            return START_NOT_STICKY
        }
        if (action == ACTION_STOP_GEOFENCE_ALERT) {
            val notifId = intent?.getIntExtra(EXTRA_NOTIFICATION_ID, Int.MIN_VALUE) ?: Int.MIN_VALUE
            val targetItemId = intent?.getStringExtra(EXTRA_GEOFENCE_ITEM_ID) ?: activeGeofenceItemId
            stopGeofenceOperationForItem(applicationContext, targetItemId, notifId)
            if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
                stopLocationUpdates()
                releaseServiceCpuWakeLock()
                stopSelf()
                return START_NOT_STICKY
            }
            return START_STICKY
        }
        if (action == ACTION_SNOOZE_GEOFENCE_ALERT) {
            val notifId = intent?.getIntExtra(EXTRA_NOTIFICATION_ID, Int.MIN_VALUE) ?: Int.MIN_VALUE
            val targetItemId = intent?.getStringExtra(EXTRA_GEOFENCE_ITEM_ID) ?: activeGeofenceItemId
            snoozeGeofenceItemForPassingThrough(applicationContext, targetItemId, 30 * 60_000L, notifId)
            if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
                stopLocationUpdates()
                releaseServiceCpuWakeLock()
                stopSelf()
                return START_NOT_STICKY
            }
            return START_STICKY
        }

        if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
            stopGeofenceAudio(applicationContext)
            cancelGpsDisabledWarningNotification(applicationContext)
            stopLocationUpdates()
            releaseServiceCpuWakeLock()
            stopSelf()
            return START_NOT_STICKY
        }

        acquireServiceCpuWakeLock()
        registerScreenStateReceiver()
        promoteToForegroundService()
        startLocationUpdates()
        if (action == ACTION_APP_BACKGROUNDED_CHECK) {
            mainHandler.post {
                try {
                    checkLastKnownLocations()
                    relaunchActivePopupOnLockscreenIfNeeded(
                        wakeScreen = !isScreenInteractive(),
                        allowWhenUnlockedOutOfApp = true
                    )
                } catch (e: Exception) {
                }
            }
        }
        mainHandler.removeCallbacks(periodicCheckRunnable)
        mainHandler.post(periodicCheckRunnable)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        LocalNotificationsPlugin.onAppTaskRemoved()
        try {
            if (shouldRun(applicationContext) && hasLocationPermission(applicationContext)) {
                acquireServiceCpuWakeLock()
                ensureServiceState(applicationContext)
                val am = getSystemService(Context.ALARM_SERVICE) as? android.app.AlarmManager
                if (am != null) {
                    val restartIntent = Intent(applicationContext, LocalNotificationRestoreReceiver::class.java).apply {
                        action = ACTION_RESTART_GEOFENCE_SERVICE
                    }
                    var piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        piFlags = piFlags or PendingIntent.FLAG_IMMUTABLE
                    }
                    val pi = PendingIntent.getBroadcast(applicationContext, 991122, restartIntent, piFlags)
                    val triggerAt = System.currentTimeMillis() + 500L
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
                    } else {
                        am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
                    }
                }
            }
        } catch (e: Exception) {
        }
    }

    private fun promoteToForegroundService() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val ch = NotificationChannel(
                    RADAR_SERVICE_CHANNEL_ID,
                    "Geofence Radar Service",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Active location boundary monitoring"
                    setShowBadge(false)
                    setSound(null, null)
                    enableVibration(false)
                }
                nm.createNotificationChannel(ch)
            }

            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val isEn = prefs.getString(KEY_LANGUAGE, "fa") == "en"
            val title = if (isEn) "YAAD Geofence Radar Active" else "رادار حصار مکانی یاد فعال است"
            val text = if (isEn) "Monitoring your saved location boundaries" else "در حال پایش محدوده مکان‌های ثبت‌شده"
            val turnOffLabel = if (isEn) "⏹ Turn Off Radar" else "⏹ خاموش کردن رادار"

            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                )
            }
            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val contentPi = if (launchIntent != null) {
                PendingIntent.getActivity(this, 909100, launchIntent, piFlags)
            } else null

            val disableRadarIntent = Intent(this, YaadGeofenceService::class.java).apply {
                action = ACTION_DISABLE_GEOFENCE_RADAR
            }
            val disableRadarPi = PendingIntent.getService(this, 909105, disableRadarIntent, piFlags)

            val smallIconRes = resources.getIdentifier("ic_stat_icon_config_sample", "drawable", packageName)
                .takeIf { it != 0 } ?: applicationInfo.icon

            val notif = NotificationCompat.Builder(this, RADAR_SERVICE_CHANNEL_ID)
                .setSmallIcon(smallIconRes)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(0, turnOffLabel, disableRadarPi)
                .apply {
                    if (contentPi != null) setContentIntent(contentPi)
                }
                .build()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    RADAR_FOREGROUND_NOTIFICATION_ID,
                    notif,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                )
            } else {
                startForeground(RADAR_FOREGROUND_NOTIFICATION_ID, notif)
            }
        } catch (e: Exception) {
        }
    }

    private var currentGpsIntervalMs: Long = 500L

    private fun startLocationUpdates(intervalMs: Long = currentGpsIntervalMs) {
        val lm = locationManager ?: return
        if (!hasLocationPermission(this)) return
        try {
            currentGpsIntervalMs = intervalMs.coerceIn(500L, 12_000L)
            if (isTrackingRegistered) {
                try {
                    lm.removeUpdates(this)
                } catch (e: Exception) {
                }
                isTrackingRegistered = false
            }
            var anyRegistered = false
            // 1. Adaptive satellite GPS_PROVIDER (500ms near boundary for <=1s response, scaled up when far to save battery)
            try {
                if (lm.allProviders.contains(LocationManager.GPS_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        currentGpsIntervalMs,
                        0.0f,
                        this,
                        Looper.getMainLooper()
                    )
                    anyRegistered = true
                }
            } catch (e: Exception) {
            }
            // 2. Adaptive NETWORK_PROVIDER for indoor/urban response (<=1s when near boundary)
            try {
                if (lm.allProviders.contains(LocationManager.NETWORK_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        currentGpsIntervalMs,
                        0.0f,
                        this,
                        Looper.getMainLooper()
                    )
                    anyRegistered = true
                }
            } catch (e: Exception) {
            }
            // 3. FUSED provider (Android 12+ LocationManager.FUSED_PROVIDER = "fused") for fast indoor/outdoor fused fixes
            try {
                if (lm.allProviders.contains("fused")) {
                    lm.requestLocationUpdates(
                        "fused",
                        currentGpsIntervalMs,
                        0.0f,
                        this,
                        Looper.getMainLooper()
                    )
                    anyRegistered = true
                }
            } catch (e: Exception) {
            }
            // 4. PASSIVE_PROVIDER (250ms, 0m) to capture location fixes from any system service immediately with zero extra battery cost
            try {
                if (lm.allProviders.contains(LocationManager.PASSIVE_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.PASSIVE_PROVIDER,
                        250L,
                        0.0f,
                        this,
                        Looper.getMainLooper()
                    )
                    anyRegistered = true
                }
            } catch (e: Exception) {
            }
            isTrackingRegistered = anyRegistered
            checkLastKnownLocations()
        } catch (e: SecurityException) {
        } catch (e: Exception) {
        }
    }

    private fun updateAdaptiveLocationInterval(minDistanceToBoundaryMeters: Int, hasActiveAlert: Boolean) {
        val desiredIntervalMs = when {
            hasActiveAlert || minDistanceToBoundaryMeters <= 600 -> 500L
            minDistanceToBoundaryMeters <= 2500 -> 3000L
            else -> 10000L
        }
        if (desiredIntervalMs != currentGpsIntervalMs && isTrackingRegistered) {
            startLocationUpdates(desiredIntervalMs)
        }
    }

    private fun stopLocationUpdates() {
        if (!isTrackingRegistered) return
        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
        }
        isTrackingRegistered = false
    }

    private fun shouldAcceptNativeLocation(loc: Location, allowSameTimestampTick: Boolean = false): Boolean {
        val now = System.currentTimeMillis()
        val locTime = if (loc.time > 0L) loc.time else now
        if (!allowSameTimestampTick && locTime < lastAcceptedLocationTimeMs - 2000L) {
            return false
        }

        val acc = if (loc.hasAccuracy() && loc.accuracy > 0f) loc.accuracy else 20f
        val isGps = loc.provider == LocationManager.GPS_PROVIDER
        if (isGps) {
            lastGpsFixTimeMs = now
        } else {
            // Prevent indoor ("زیر سقف") ping-pong between fine satellite GPS and coarse cell/Wi-Fi NETWORK_PROVIDER
            if (now - lastGpsFixTimeMs < 60_000L && acc > lastAcceptedAccuracy + 12f) {
                if (!lastAcceptedLat.isNaN() && !lastAcceptedLon.isNaN()) {
                    val netJump = calculateHaversineMeters(
                        lastAcceptedLat,
                        lastAcceptedLon,
                        loc.latitude,
                        loc.longitude
                    )
                    if (netJump < (acc + lastAcceptedAccuracy + 35f).toInt()) {
                        return false
                    }
                } else {
                    return false
                }
            }
        }

        if (!lastAcceptedLat.isNaN() && !lastAcceptedLon.isNaN()) {
            val ageMs = (now - lastAcceptedLocationTimeMs).coerceAtLeast(0L)
            val jumpMeters = calculateHaversineMeters(
                lastAcceptedLat,
                lastAcceptedLon,
                loc.latitude,
                loc.longitude
            )
            if (ageMs < 45_000L && lastAcceptedAccuracy <= 30f && acc > 45f && jumpMeters < (acc + lastAcceptedAccuracy + 25f).toInt()) {
                return false
            }
            if (ageMs < 15_000L && lastAcceptedAccuracy <= 30f && acc > 65f && jumpMeters > 35) {
                return false
            }
        }

        lastAcceptedLocationTimeMs = locTime
        lastAcceptedLat = loc.latitude
        lastAcceptedLon = loc.longitude
        lastAcceptedAcc = acc
        lastAcceptedAccuracy = acc
        return true
    }

    private var lastAcceptedAcc: Float = Float.MAX_VALUE

    private fun checkLastKnownLocations() {
        val lm = locationManager ?: return
        if (!hasLocationPermission(this)) return
        try {
            val now = System.currentTimeMillis()
            var gpsLoc: Location? = null
            var netLoc: Location? = null
            var fusedLoc: Location? = null
            var passiveLoc: Location? = null
            try {
                if (lm.allProviders.contains(LocationManager.GPS_PROVIDER)) {
                    gpsLoc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                }
            } catch (e: Exception) {
            }
            try {
                if (lm.allProviders.contains(LocationManager.NETWORK_PROVIDER)) {
                    netLoc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                }
            } catch (e: Exception) {
            }
            try {
                if (lm.allProviders.contains("fused")) {
                    fusedLoc = lm.getLastKnownLocation("fused")
                }
            } catch (e: Exception) {
            }
            try {
                if (lm.allProviders.contains(LocationManager.PASSIVE_PROVIDER)) {
                    passiveLoc = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
                }
            } catch (e: Exception) {
            }

            // Prefer satellite GPS_PROVIDER for up to 45s indoors so roof attenuation never causes
            // periodic 15s switching to a shifted NETWORK_PROVIDER coordinate.
            val primaryChosen = if (gpsLoc != null && now - gpsLoc.time <= 45_000L) {
                gpsLoc
            } else if (gpsLoc != null && netLoc != null) {
                if (gpsLoc.time >= netLoc.time - 20_000L && gpsLoc.accuracy <= netLoc.accuracy + 20f) gpsLoc else netLoc
            } else {
                gpsLoc ?: fusedLoc ?: netLoc ?: passiveLoc
            }

            var chosen = primaryChosen
            if (chosen == null || (fusedLoc != null && fusedLoc.time > chosen.time + 15_000L)) {
                if (fusedLoc != null && (gpsLoc == null || now - gpsLoc.time > 45_000L)) {
                    chosen = fusedLoc
                }
            }
            if (chosen == null) {
                chosen = passiveLoc
            }

            // Fallback to the latest WebView-synced position if LocationManager has no cached fix yet
            if (chosen == null) {
                val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val syncedLat = java.lang.Double.longBitsToDouble(
                    prefs.getLong(KEY_LAST_SYNCED_LAT_BITS, java.lang.Double.doubleToRawLongBits(Double.NaN))
                )
                val syncedLon = java.lang.Double.longBitsToDouble(
                    prefs.getLong(KEY_LAST_SYNCED_LON_BITS, java.lang.Double.doubleToRawLongBits(Double.NaN))
                )
                if (!syncedLat.isNaN() && !syncedLon.isNaN()) {
                    val syncedAcc = prefs.getFloat(KEY_LAST_SYNCED_ACC, 20f)
                    val syncedTime = prefs.getLong(KEY_LAST_SYNCED_TIME, now)
                    chosen = Location("webview_synced").apply {
                        latitude = syncedLat
                        longitude = syncedLon
                        accuracy = syncedAcc
                        time = if (syncedTime > 0L) syncedTime else now
                    }
                }
            }

            if (chosen != null) {
                if (shouldAcceptNativeLocation(chosen, allowSameTimestampTick = true)) {
                    evaluateLocationAgainstGeofences(chosen)
                }
            }
        } catch (e: SecurityException) {
        } catch (e: Exception) {
        }
    }

    override fun onLocationChanged(location: Location) {
        if (shouldAcceptNativeLocation(location, allowSameTimestampTick = false)) {
            evaluateLocationAgainstGeofences(location)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onProviderEnabled(provider: String) {
        startLocationUpdates()
    }

    override fun onProviderDisabled(provider: String) {
    }

    private fun isDeviceKeyguardLocked(): Boolean {
        return try {
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            km?.isKeyguardLocked == true
        } catch (e: Exception) {
            false
        }
    }

    private fun isScreenInteractive(): Boolean {
        return try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                pm?.isInteractive == true
            } else {
                @Suppress("DEPRECATION")
                pm?.isScreenOn == true
            }
        } catch (e: Exception) {
            true
        }
    }

    private fun isScreenOffOrLocked(): Boolean {
        return isInScreenOffSession || !isScreenInteractive() || isDeviceKeyguardLocked()
    }

    private fun toPersianDigits(input: String): String {
        val persian = charArrayOf('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹')
        val sb = StringBuilder(input.length)
        for (ch in input) {
            if (ch in '0'..'9') {
                sb.append(persian[ch - '0'])
            } else {
                sb.append(ch)
            }
        }
        return sb.toString()
    }

    private fun evaluateLocationAgainstGeofences(location: Location) {
        try {
            val appInForeground = LocalNotificationsPlugin.isAppInForeground(this)
            val screenOffOrLocked = isScreenOffOrLocked()

            // Stream live native GPS fix to WebView whenever app is in foreground for <2s in-app response
            if (appInForeground) {
                if (!screenOffOrLocked && activeGeofenceNotificationId != Int.MIN_VALUE) {
                    try {
                        NotificationManagerCompat.from(this).cancel(activeGeofenceNotificationId)
                    } catch (e: Exception) {
                    }
                }
                val lat = location.latitude
                val lon = location.longitude
                val acc = location.accuracy
                val ts = System.currentTimeMillis()
                LocalNotificationsPlugin.evaluateJsInWebView(
                    "window.dispatchEvent(new CustomEvent('yaad:native-location', { detail: { latitude: \$lat, longitude: \$lon, accuracy: \$acc, timestamp: \$ts } }));"
                )
            }

            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val isEn = prefs.getString(KEY_LANGUAGE, "fa") == "en"
            val rawItems = prefs.getString(KEY_ITEMS_JSON, "[]") ?: "[]"
            val arr = JSONArray(rawItems)
            if (arr.length() == 0) return

            val now = System.currentTimeMillis()
            val accuracyMeters = if (location.hasAccuracy() && location.accuracy > 0f) location.accuracy.toDouble() else 15.0
            val editor = prefs.edit()
            var prefsModified = false

            data class NativeAlertCandidate(
                val id: String,
                val title: String,
                val statusPhrase: String,
                val eventType: String,
                val sonarMode: String,
                val distance: Int,
                val radius: Int,
                val targetDistance: Int,
                val targetLat: Double,
                val targetLon: Double,
                val visualOnlyBanner: Boolean,
                val visualBannerText: String,
                val is5Hz: Boolean,
                val playAudio: Boolean
            )

            val activeCandidates = ArrayList<NativeAlertCandidate>()
            var minDistanceToBoundaryMeters = Int.MAX_VALUE

            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val id = item.optString("id", "")
                if (id.isEmpty()) continue

                val pausedUntilKey = "paused_until_\$id"
                val pausedUntil = prefs.getLong(pausedUntilKey, 0L)
                if (pausedUntil > now) {
                    continue
                } else if (pausedUntil in 1..now) {
                    editor.remove(pausedUntilKey)
                    lastInwardMoveTimeMap[id] = now
                    prefsModified = true
                }

                val title = item.optString("title", "")
                val targetLat = item.optDouble("latitude", Double.NaN)
                val targetLon = item.optDouble("longitude", Double.NaN)
                if (targetLat.isNaN() || targetLon.isNaN()) continue

                val radius = item.optInt("radius", 200).coerceAtLeast(20)
                val rawTriggerOn = item.optString("triggerOn", "enter")
                val triggerOn = if (rawTriggerOn == "exit") "exit" else "enter"

                val rawDistance = calculateHaversineMeters(
                    location.latitude,
                    location.longitude,
                    targetLat,
                    targetLon
                )

                val distFromBoundary = kotlin.math.abs(rawDistance - radius)
                if (distFromBoundary < minDistanceToBoundaryMeters) {
                    minDistanceToBoundaryMeters = distFromBoundary
                }

                // Accuracy-weighted moving average + fuzzy hysteresis
                val (smoothedDistDouble, deltaMeters) = recordAndAnalyzeNativeTrend(id, rawDistance.toDouble(), accuracyMeters, now)
                val distance = smoothedDistDouble.roundToInt()

                val fivePctMeters = kotlin.math.min((radius * 0.35).toInt(), kotlin.math.max(15, (radius * 0.05).roundToInt()))
                val centerZoneMeters = fivePctMeters
                val preEntryStartMeters = radius + fivePctMeters
                val fuzzyHyst = kotlin.math.min(25, kotlin.math.max(10, (accuracyMeters * 0.6).roundToInt()))
                val antiPingPongDeadband = kotlin.math.max(fuzzyHyst, kotlin.math.min(80, (radius * 0.15).roundToInt()))

                val insideKey = "inside_\$id"
                val armedExitKey = "armed_exit_\$id"
                val sonarDoneKey = "sonar_done_\$id"
                val latchedModeKey = "latched_mode_\$id"
                val cooldownUntilKey = "cooldown_until_\$id"
                val hasPreviousState = prefs.contains(insideKey)
                val wasInsideBefore = prefs.getBoolean(insideKey, false)
                var armedForExit = prefs.getBoolean(armedExitKey, false)
                var sonarDone = prefs.getBoolean(sonarDoneKey, false)
                var latchedMode = prefs.getString(latchedModeKey, "") ?: ""
                val cooldownUntil = prefs.getLong(cooldownUntilKey, 0L)

                if (distance > preEntryStartMeters + antiPingPongDeadband) {
                    outsideSampleCountMap[id] = (outsideSampleCountMap[id] ?: 0) + 1
                    insideSampleCountMap[id] = 0
                } else if (distance <= radius) {
                    insideSampleCountMap[id] = (insideSampleCountMap[id] ?: 0) + 1
                    outsideSampleCountMap[id] = 0
                }

                if (!startedOutsideMap.containsKey(id)) {
                    startedOutsideMap[id] = rawDistance > radius
                }
                val startedOutside = startedOutsideMap[id] == true

                val isInsideNow = if (wasInsideBefore) {
                    distance <= radius + antiPingPongDeadband
                } else {
                    distance <= radius
                }

                // Capture previous minimum distance BEFORE updating it with current sample so Exit displacement check works!
                val prevMinDistInside = minDistInsideMap[id] ?: Double.POSITIVE_INFINITY
                if (isInsideNow || distance <= radius) {
                    if (smoothedDistDouble < prevMinDistInside) {
                        minDistInsideMap[id] = smoothedDistDouble
                    }
                } else if (distance > preEntryStartMeters + antiPingPongDeadband && (outsideSampleCountMap[id] ?: 0) >= 2) {
                    minDistInsideMap.remove(id)
                    startedOutsideMap[id] = true
                }

                if (distance <= preEntryStartMeters + fuzzyHyst) {
                    val prevMax = maxDistApproachMap[id] ?: 0.0
                    if (smoothedDistDouble > prevMax) {
                        maxDistApproachMap[id] = smoothedDistDouble
                    }
                } else {
                    maxDistApproachMap[id] = smoothedDistDouble
                }

                val minDistInside = if (prevMinDistInside.isFinite()) prevMinDistInside else (minDistInsideMap[id] ?: Double.POSITIVE_INFINITY)
                val maxDistApproach = maxDistApproachMap[id] ?: smoothedDistDouble

                val lastInwardMs = lastInwardMoveTimeMap[id] ?: 0L
                val lastOutwardMs = lastOutwardMoveTimeMap[id] ?: 0L
                val isMovingInward = deltaMeters <= -0.8 || (lastInwardMs > 0L && lastInwardMs >= lastOutwardMs && now - lastInwardMs < 60_000L)

                // Strict directional confirmation so Enter mode NEVER fires on Exit and Exit mode NEVER fires on Enter
                val isConfirmedExiting = deltaMeters >= 1.0 ||
                    (lastOutwardMs > lastInwardMs && now - lastOutwardMs <= 60_000L) ||
                    (minDistInside.isFinite() && smoothedDistDouble - minDistInside >= kotlin.math.max(4.0, fuzzyHyst * 0.45))

                val isConfirmedEntering = deltaMeters <= -0.8 ||
                    (lastInwardMs > lastOutwardMs && now - lastInwardMs <= 60_000L) ||
                    (maxDistApproach - smoothedDistDouble >= kotlin.math.max(4.0, fuzzyHyst * 0.45))

                // Only persist background alert-phase timers (five_hz_start, banner_start, sonar_done) when out-of-app or screen is off/locked.
                // When the user is inside the unlocked app, WebView manages its own timers so background timers stay fresh for when the user exits the app!
                val isOutOfAppSession = !appInForeground || screenOffOrLocked

                if ((distance <= radius || wasInsideBefore) && !armedForExit) {
                    armedForExit = true
                    editor.putBoolean(armedExitKey, true)
                    prefsModified = true
                }

                val fiveHzKey = "five_hz_start_\$id"
                val bannerStartKey = "banner_start_\$id"
                val bannerTextKey = "banner_text_\$id"
                val entryToastStartKey = "entry_toast_start_\$id"
                val completedCycleKey = "completed_cycle_\$id"

                var fiveHzStart = prefs.getLong(fiveHzKey, 0L)
                val bannerStart = prefs.getLong(bannerStartKey, 0L)
                val bannerText = prefs.getString(bannerTextKey, "") ?: ""
                var entryToastStart = prefs.getLong(entryToastStartKey, 0L)
                var completedCycle = prefs.getBoolean(completedCycleKey, false)

                // Active visual-only banner (after 10s of 5Hz sonar):
                // Keep the full-screen alert open until user reacts or resets!
                // Note: In Exit mode, entering the 5% zone (distance <= centerZoneMeters || rawDistance <= centerZoneMeters)
                // UNCONDITIONALLY unlatches and silences any banner or alert!
                if (bannerStart > 0L && !completedCycle) {
                    val shouldUnlatchOutsideEnter = triggerOn == "enter" && distance > preEntryStartMeters + antiPingPongDeadband && (outsideSampleCountMap[id] ?: 0) >= 2
                    val shouldUnlatchCenterExit = triggerOn == "exit" && (distance <= centerZoneMeters || rawDistance <= centerZoneMeters)

                    if (shouldUnlatchOutsideEnter || shouldUnlatchCenterExit) {
                        editor.remove(bannerStartKey)
                        editor.remove(bannerTextKey)
                        editor.remove(latchedModeKey)
                        latchedMode = ""
                        prefsModified = true
                    } else {
                        val targetDist = if (triggerOn == "exit") kotlin.math.abs(distance - radius) else distance
                        activeCandidates.add(
                            NativeAlertCandidate(
                                id = id,
                                title = title,
                                statusPhrase = bannerText,
                                eventType = "visual_banner",
                                sonarMode = if (triggerOn == "exit") "exit" else "enter",
                                distance = distance,
                                radius = radius,
                                targetDistance = targetDist,
                                targetLat = targetLat,
                                targetLon = targetLon,
                                visualOnlyBanner = true,
                                visualBannerText = bannerText,
                                is5Hz = false,
                                playAudio = false
                            )
                        )
                        continue
                    }
                }

                when (triggerOn) {
                    "enter" -> {
                        if (distance > preEntryStartMeters + antiPingPongDeadband) {
                            if ((outsideSampleCountMap[id] ?: 0) >= 2) {
                                if (wasInsideBefore || completedCycle || fiveHzStart > 0L || entryToastStart > 0L || sonarDone || latchedMode.isNotEmpty() || cooldownUntil > 0L) {
                                    editor.putBoolean(insideKey, false)
                                    editor.putBoolean(completedCycleKey, false)
                                    editor.putBoolean(sonarDoneKey, false)
                                    editor.putBoolean(armedExitKey, false)
                                    editor.remove(cooldownUntilKey)
                                    editor.remove(fiveHzKey)
                                    editor.remove(entryToastStartKey)
                                    editor.remove(latchedModeKey)
                                    val prefix = "\${id}_"
                                    for (k in wokenAlertPhaseSet.toList()) {
                                        if (k.startsWith(prefix)) wokenAlertPhaseSet.remove(k)
                                    }
                                    prefsModified = true
                                }
                            }
                            continue
                        }
                        if (distance > preEntryStartMeters && !wasInsideBefore && latchedMode != "enter") {
                            continue
                        }
                        if (completedCycle || (now < cooldownUntil && latchedMode != "enter")) {
                            continue
                        }
                        if (isConfirmedExiting && !isConfirmedEntering && distance > radius && latchedMode != "enter") {
                            if (fiveHzStart > 0L) {
                                editor.remove(fiveHzKey)
                                prefsModified = true
                            }
                            continue
                        }
                        if (!wasInsideBefore && isInsideNow && !isConfirmedExiting) {
                            editor.putBoolean(insideKey, true)
                            if (isOutOfAppSession) {
                                editor.putLong(entryToastStartKey, now)
                                entryToastStart = now
                            }
                            lastInwardMoveTimeMap[id] = now
                            prefsModified = true
                        }

                        val activeEntryToastMsg = if (entryToastStart > 0L && now - entryToastStart < 10_000L) {
                            if (isEn) "Entered «\$title»" else "ورود به حصار مکانی «\$title»"
                        } else ""

                        if (distance <= centerZoneMeters || fiveHzStart > 0L) {
                            if (latchedMode != "enter") {
                                latchedMode = "enter"
                                editor.putString(latchedModeKey, "enter")
                                prefsModified = true
                            }
                            if (fiveHzStart == 0L && isOutOfAppSession) {
                                fiveHzStart = now
                                editor.putLong(fiveHzKey, now)
                                prefsModified = true
                            }
                            val elapsed5Hz = if (fiveHzStart > 0L && isOutOfAppSession) now - fiveHzStart else 0L
                            val centerMsg = if (isEn) "At center of «\$title»" else "در مرکز حصار مکانی «\$title»"
                            if (elapsed5Hz < 10_000L) {
                                activeCandidates.add(
                                    NativeAlertCandidate(
                                        id = id,
                                        title = title,
                                        statusPhrase = centerMsg,
                                        eventType = "arrived_under_10m",
                                        sonarMode = "enter",
                                        distance = distance,
                                        radius = radius,
                                        targetDistance = distance,
                                        targetLat = targetLat,
                                        targetLon = targetLon,
                                        visualOnlyBanner = false,
                                        visualBannerText = centerMsg,
                                        is5Hz = true,
                                        playAudio = true
                                    )
                                )
                            } else {
                                editor.remove(fiveHzKey)
                                editor.putLong(bannerStartKey, now)
                                editor.putString(bannerTextKey, centerMsg)
                                editor.putBoolean(sonarDoneKey, true)
                                prefsModified = true
                                activeCandidates.add(
                                    NativeAlertCandidate(
                                        id = id,
                                        title = title,
                                        statusPhrase = centerMsg,
                                        eventType = "visual_banner",
                                        sonarMode = "enter",
                                        distance = distance,
                                        radius = radius,
                                        targetDistance = distance,
                                        targetLat = targetLat,
                                        targetLon = targetLon,
                                        visualOnlyBanner = true,
                                        visualBannerText = centerMsg,
                                        is5Hz = false,
                                        playAudio = false
                                    )
                                )
                            }
                        } else if (!sonarDone && (latchedMode == "enter" || distance <= radius || (distance <= preEntryStartMeters && !isConfirmedExiting))) {
                            if (latchedMode != "enter") {
                                latchedMode = "enter"
                                editor.putString(latchedModeKey, "enter")
                                prefsModified = true
                            }
                            val statusMsg = if (activeEntryToastMsg.isNotEmpty()) {
                                activeEntryToastMsg
                            } else if (isInsideNow) {
                                if (isEn) "Entered «\$title»" else "ورود به حصار مکانی «\$title»"
                            } else {
                                if (isEn) "Approaching «\$title»" else "نزدیک شدن به «\$title»"
                            }
                            activeCandidates.add(
                                NativeAlertCandidate(
                                    id = id,
                                    title = title,
                                    statusPhrase = statusMsg,
                                    eventType = "enter",
                                    sonarMode = "enter",
                                    distance = distance,
                                    radius = radius,
                                    targetDistance = distance,
                                    targetLat = targetLat,
                                    targetLon = targetLon,
                                    visualOnlyBanner = false,
                                    visualBannerText = statusMsg,
                                    is5Hz = false,
                                    playAudio = !sonarDone
                                )
                            )
                        }
                    }

                    "exit" -> {
                        val distToBoundary = kotlin.math.max(0, radius - distance)
                        val suppressExit = shouldSuppressExitByFivePercentAndGpsFilter(
                            id = id,
                            rawDistance = rawDistance,
                            smoothedDistance = distance,
                            smoothedDistDouble = smoothedDistDouble,
                            radius = radius,
                            centerZoneMeters = centerZoneMeters,
                            accuracyMeters = accuracyMeters,
                            minDistInside = minDistInside,
                            isConfirmedExiting = isConfirmedExiting,
                            isMovingInward = isMovingInward,
                            wasInsideBefore = wasInsideBefore,
                            armedForExit = armedForExit,
                            completedCycle = completedCycle,
                            sonarDone = sonarDone,
                            fiveHzStart = fiveHzStart,
                            latchedMode = latchedMode,
                            now = now,
                            editor = editor,
                            insideKey = insideKey,
                            armedExitKey = armedExitKey,
                            completedCycleKey = completedCycleKey,
                            sonarDoneKey = sonarDoneKey,
                            fiveHzKey = fiveHzKey,
                            latchedModeKey = latchedModeKey
                        )
                        if (suppressExit.second) {
                            prefsModified = true
                        }
                        if (suppressExit.first) {
                            continue
                        }

                        if (!armedForExit && (wasInsideBefore || distance <= radius || !startedOutside)) {
                            armedForExit = true
                            editor.putBoolean(armedExitKey, true)
                            prefsModified = true
                        }

                        val crossedOutside = distance > radius
                        if (crossedOutside && (wasInsideBefore || !startedOutside || latchedMode == "exit") && !armedForExit) {
                            armedForExit = true
                            editor.putBoolean(armedExitKey, true)
                            prefsModified = true
                        }

                        if (!armedForExit || completedCycle || (isConfirmedEntering && !isConfirmedExiting && !crossedOutside && latchedMode != "exit")) {
                            if (fiveHzStart > 0L && isConfirmedEntering && !crossedOutside) {
                                editor.remove(fiveHzKey)
                                prefsModified = true
                            }
                            continue
                        }

                        if (distance <= radius && fiveHzStart == 0L) {
                            if ((!isConfirmedExiting && latchedMode != "exit") || (isMovingInward && latchedMode != "exit") || sonarDone) {
                                continue
                            }
                            if (latchedMode != "exit") {
                                latchedMode = "exit"
                                editor.putString(latchedModeKey, "exit")
                                prefsModified = true
                            }
                            lastExitAlertEmittedTimeMap[id] = now
                            val exitingMsg = if (isEn) "Exiting «\$title»" else "در حال خروج از حصار مکانی «\$title»"
                            activeCandidates.add(
                                NativeAlertCandidate(
                                    id = id,
                                    title = title,
                                    statusPhrase = exitingMsg,
                                    eventType = "exit",
                                    sonarMode = "exit",
                                    distance = distance,
                                    radius = radius,
                                    targetDistance = distToBoundary,
                                    targetLat = targetLat,
                                    targetLon = targetLon,
                                    visualOnlyBanner = false,
                                    visualBannerText = exitingMsg,
                                    is5Hz = false,
                                    playAudio = !sonarDone
                                )
                            )
                        } else if ((crossedOutside || isConfirmedExiting || latchedMode == "exit") && !completedCycle && rawDistance > centerZoneMeters) {
                            if (latchedMode != "exit") {
                                latchedMode = "exit"
                                editor.putString(latchedModeKey, "exit")
                                prefsModified = true
                            }
                            lastExitAlertEmittedTimeMap[id] = now
                            val exitedMsg = if (isEn) "Exited «\$title»" else "خروج از حصار مکانی «\$title»"
                            if (fiveHzStart == 0L && isOutOfAppSession) {
                                fiveHzStart = now
                                editor.putBoolean(insideKey, false)
                                editor.putBoolean(armedExitKey, false)
                                editor.putLong(fiveHzKey, now)
                                prefsModified = true
                            }
                            val elapsed5Hz = if (fiveHzStart > 0L && isOutOfAppSession) now - fiveHzStart else 0L
                            if (elapsed5Hz < 10_000L) {
                                activeCandidates.add(
                                    NativeAlertCandidate(
                                        id = id,
                                        title = title,
                                        statusPhrase = exitedMsg,
                                        eventType = "exit",
                                        sonarMode = "exit",
                                        distance = distance,
                                        radius = radius,
                                        targetDistance = 0,
                                        targetLat = targetLat,
                                        targetLon = targetLon,
                                        visualOnlyBanner = false,
                                        visualBannerText = exitedMsg,
                                        is5Hz = true,
                                        playAudio = true
                                    )
                                )
                            } else {
                                editor.remove(fiveHzKey)
                                editor.putLong(bannerStartKey, now)
                                editor.putString(bannerTextKey, exitedMsg)
                                editor.putBoolean(sonarDoneKey, true)
                                prefsModified = true
                                activeCandidates.add(
                                    NativeAlertCandidate(
                                        id = id,
                                        title = title,
                                        statusPhrase = exitedMsg,
                                        eventType = "visual_banner",
                                        sonarMode = "exit",
                                        distance = distance,
                                        radius = radius,
                                        targetDistance = 0,
                                        targetLat = targetLat,
                                        targetLon = targetLon,
                                        visualOnlyBanner = true,
                                        visualBannerText = exitedMsg,
                                        is5Hz = false,
                                        playAudio = false
                                    )
                                )
                            }
                        } else if (!hasPreviousState) {
                            editor.putBoolean(insideKey, isInsideNow)
                            prefsModified = true
                        }
                    }
                }
            }

            if (prefsModified) {
                editor.apply()
            }

            updateAdaptiveLocationInterval(minDistanceToBoundaryMeters, activeCandidates.isNotEmpty())

            if (activeCandidates.isEmpty()) {
                wokenAlertPhaseSet.clear()
                if (sonarLoopActive || activeGeofenceNotificationId != Int.MIN_VALUE) {
                    stopGeofenceAudio(applicationContext)
                } else {
                    activeGeofenceNotificationId = Int.MIN_VALUE
                    activeGeofenceItemId = ""
                    lastActiveMultiCardsJson = ""
                }
                return
            }

            activeCandidates.sortBy { it.targetDistance }

            val topSonarCandidate = activeCandidates.firstOrNull { !it.visualOnlyBanner && it.playAudio }
            val topOverall = activeCandidates.first()

            val multiCardsArr = JSONArray()
            for (cand in activeCandidates) {
                val cardObj = JSONObject().apply {
                    put("id", cand.id)
                    put("notificationId", geofenceNotifId(cand.id))
                    put("title", cand.title)
                    put("subtitle", cand.statusPhrase)
                    put("distance", cand.distance)
                    put("radius", cand.radius)
                    put("latitude", cand.targetLat)
                    put("longitude", cand.targetLon)
                    put("visualOnlyBanner", cand.visualOnlyBanner)
                    put("visualBannerText", cand.visualBannerText)
                }
                multiCardsArr.put(cardObj)
            }
            val multiCardsStr = if (activeCandidates.size > 1) multiCardsArr.toString() else ""
            lastActiveMultiCardsJson = multiCardsStr

            val topBearingDeg = computeBearingDeg(
                topOverall.targetLat,
                topOverall.targetLon,
                location.latitude,
                location.longitude
            )

            // Always keep top candidate state cached so if the user locks or turns off the screen or leaves the app,
            // YaadGeofenceService immediately launches the full-screen alert!
            activeGeofenceNotificationId = geofenceNotifId(topOverall.id)
            activeGeofenceItemId = topOverall.id
            activeGeofenceTitle = topOverall.title
            activeGeofenceDescription = topOverall.statusPhrase
            activeGeofenceCustomMessage = topOverall.visualBannerText
            activeGeofenceEventType = topOverall.eventType
            activeGeofenceRadius = topOverall.radius
            activeGeofenceLat = topOverall.targetLat
            activeGeofenceLon = topOverall.targetLon
            activeGeofenceBearingDeg = topBearingDeg
            activeGeofenceSonarMode = topOverall.sonarMode
            activeGeofenceIsEn = isEn
            liveSonarDistanceMeters = topOverall.distance
            liveSonarRadiusMeters = topOverall.radius

            // If app is in foreground AND screen is on/unlocked, WebView handles the in-app modal & WebAudio sonar.
            // Do NOT add to wokenAlertPhaseSet here so if the user turns off/locks the phone screen or switches to Android Home/other app,
            // the full-screen popup opens immediately!
            if (appInForeground && !screenOffOrLocked) {
                if (sonarLoopActive) {
                    sonarLoopActive = false
                    try {
                        sonarThread?.interrupt()
                    } catch (e: Exception) {
                    }
                    sonarThread = null
                }
                return
            }

            // If the phone is currently ringing or in an active phone call:
            // Immediately pause sonar, yield any open full-screen geofence popup to Android's native call screen,
            // and register the geofence popup as suspended so it automatically returns as soon as the call finishes!
            if (YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(this)) {
                pauseSonarForPhoneCall(this)
                YaadAlarmPopupActivity.yieldActivePopupForPhoneCall(this)
                YaadAlarmPopupActivity.suspendGeofencePopupForPhoneCall(
                    this,
                    activeGeofenceNotificationId,
                    null,
                    activeGeofenceItemId
                )
                return
            }

            for ((idx, cand) in activeCandidates.withIndex()) {
                val candBearing = computeBearingDeg(
                    cand.targetLat,
                    cand.targetLon,
                    location.latitude,
                    location.longitude
                )
                fireOutOfAppGeofenceAlert(
                    id = cand.id,
                    title = cand.title,
                    statusPhrase = cand.statusPhrase,
                    eventType = cand.eventType,
                    sonarMode = cand.sonarMode,
                    is5Hz = cand.is5Hz,
                    distance = cand.distance,
                    radius = cand.radius,
                    targetLat = cand.targetLat,
                    targetLon = cand.targetLon,
                    bearingDeg = candBearing,
                    isEn = isEn,
                    visualOnlyBanner = cand.visualOnlyBanner,
                    visualBannerText = cand.visualBannerText,
                    isTopPriority = (idx == 0),
                    multiCardsJson = multiCardsStr
                )
            }

            if (topSonarCandidate != null && !geofenceAudioMuted) {
                val sonarBearing = computeBearingDeg(
                    topSonarCandidate.targetLat,
                    topSonarCandidate.targetLon,
                    location.latitude,
                    location.longitude
                )
                updateLiveSonarDistance(topSonarCandidate.distance, topSonarCandidate.radius, topSonarCandidate.sonarMode)
                YaadAlarmPopupActivity.updateLiveGeofenceDistance(
                    topSonarCandidate.distance,
                    topSonarCandidate.radius,
                    topSonarCandidate.is5Hz,
                    sonarBearing,
                    topSonarCandidate.sonarMode,
                    topSonarCandidate.visualOnlyBanner
                )
                if (!sonarLoopActive) {
                    val notifId = geofenceNotifId(topSonarCandidate.id)
                    startNativeSubmarineSonarLoop(
                        applicationContext,
                        topSonarCandidate.distance,
                        topSonarCandidate.radius,
                        notifId,
                        topSonarCandidate.sonarMode
                    )
                }
            } else {
                if (sonarLoopActive) {
                    sonarLoopActive = false
                    try {
                        sonarThread?.interrupt()
                    } catch (e: Exception) {
                    }
                    sonarThread = null
                }
                YaadAlarmPopupActivity.updateLiveGeofenceDistance(
                    topOverall.distance,
                    topOverall.radius,
                    topOverall.is5Hz,
                    topBearingDeg,
                    topOverall.sonarMode,
                    topOverall.visualOnlyBanner
                )
            }
        } catch (e: Exception) {
        }
    }

    private fun computeBearingDeg(
        targetLat: Double,
        targetLon: Double,
        userLat: Double,
        userLon: Double
    ): Float {
        if (targetLat.isNaN() || targetLon.isNaN() || userLat.isNaN() || userLon.isNaN()) return 300f
        val phi1 = Math.toRadians(targetLat)
        val phi2 = Math.toRadians(userLat)
        val dLon = Math.toRadians(userLon - targetLon)
        val y = sin(dLon) * cos(phi2)
        val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLon)
        val deg = (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
        return deg.toFloat()
    }

    private fun buildStatusBarTitleAndBody(
        title: String,
        statusPhrase: String,
        distance: Int,
        radius: Int,
        isEn: Boolean,
        visualOnlyBanner: Boolean = false,
        visualBannerText: String = ""
    ): Pair<String, String> {
        val distText = if (isEn) "\${distance}m" else "\${toPersianDigits(distance.toString())} متر"
        val radText = if (isEn) "Radius: \${radius}m" else "شعاع حصار: \${toPersianDigits(radius.toString())} متر"
        val phrase = if (visualOnlyBanner && visualBannerText.isNotEmpty()) visualBannerText else statusPhrase
        val notifTitle = "\$title  •  \$distText"
        val notifBody = if (phrase.isNotEmpty()) "\$phrase  |  \$radText" else radText
        return Pair(notifTitle, notifBody)
    }

    private fun updateActiveStatusBarNotificationDistance(newDistance: Int) {
        val notifId = activeGeofenceNotificationId
        if (notifId == Int.MIN_VALUE || activeGeofenceItemId.isEmpty()) return
        if (isScreenOffOrLocked() || YaadAlarmPopupActivity.isShowingGeofencePopup() || LocalNotificationsPlugin.isAppInForeground(this)) {
            return
        }
        if (newDistance == lastNotifiedStatusBarDistance) return
        lastNotifiedStatusBarDistance = newDistance

        try {
            val (notifTitle, notifBody) = buildStatusBarTitleAndBody(
                title = activeGeofenceTitle,
                statusPhrase = activeGeofenceDescription,
                distance = newDistance,
                radius = activeGeofenceRadius,
                isEn = activeGeofenceIsEn
            )

            buildAndPostStatusBarNotification(
                notificationId = notifId,
                id = activeGeofenceItemId,
                notifTitle = notifTitle,
                notifBody = notifBody,
                isSub10m = activeGeofenceEventType == "arrived_under_10m",
                distance = newDistance,
                radius = activeGeofenceRadius,
                targetLat = activeGeofenceLat,
                targetLon = activeGeofenceLon,
                isEn = activeGeofenceIsEn,
                isLiveUpdate = true,
                showFullScreen = false,
                postToStatusBar = true
            )
        } catch (e: Exception) {
        }
    }

    private fun fireOutOfAppGeofenceAlert(
        id: String,
        title: String,
        statusPhrase: String,
        eventType: String,
        sonarMode: String = "enter",
        is5Hz: Boolean = false,
        distance: Int,
        radius: Int,
        targetLat: Double,
        targetLon: Double,
        bearingDeg: Float = 300f,
        isEn: Boolean,
        visualOnlyBanner: Boolean = false,
        visualBannerText: String = "",
        isTopPriority: Boolean = true,
        multiCardsJson: String = ""
    ) {
        try {
            val screenCurrentlyInteractive = isScreenInteractive()
            val screenOffOrLocked = isInScreenOffSession || !screenCurrentlyInteractive || isDeviceKeyguardLocked()
            if (LocalNotificationsPlugin.isAppInForeground(this) && !screenOffOrLocked) {
                return
            }
            val wasScreenOffBeforeWake = isInScreenOffSession || !screenCurrentlyInteractive
            val keepAwakeDurationMs = if (wasScreenOffBeforeWake) {
                YaadAlarmPopupActivity.SCREEN_OFF_KEEP_AWAKE_MS
            } else {
                YaadAlarmPopupActivity.SCREEN_ON_KEEP_AWAKE_MS
            }

            val isSub10m = eventType == "arrived_under_10m"
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val alertChannelId = "yaad_channel_v7_geofence_lockscreen"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (nm.getNotificationChannel(alertChannelId) == null) {
                    val ch = NotificationChannel(
                        alertChannelId,
                        "YAAD Geofence Radar & Lockscreen Alerts",
                        NotificationManager.IMPORTANCE_HIGH
                    ).apply {
                        this.description = "Geofence radar and target arrival alerts on lockscreen and status bar"
                        enableVibration(true)
                        vibrationPattern = longArrayOf(0, 450, 180, 450)
                        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                        setSound(null, null)
                    }
                    nm.createNotificationChannel(ch)
                }
            }

            val (notifTitle, notifBody) = buildStatusBarTitleAndBody(
                title = title,
                statusPhrase = statusPhrase,
                distance = distance,
                radius = radius,
                isEn = isEn,
                visualOnlyBanner = visualOnlyBanner,
                visualBannerText = visualBannerText
            )

            val notificationId = geofenceNotifId(id)

            if (isTopPriority) {
                activeGeofenceNotificationId = notificationId
                activeGeofenceItemId = id
                activeGeofenceTitle = title
                activeGeofenceDescription = statusPhrase
                activeGeofenceCustomMessage = visualBannerText
                activeGeofenceEventType = eventType
                activeGeofenceRadius = radius
                activeGeofenceLat = targetLat
                activeGeofenceLon = targetLon
                activeGeofenceBearingDeg = bearingDeg
                activeGeofenceSonarMode = sonarMode
                activeGeofenceIsEn = isEn
                lastNotifiedStatusBarDistance = distance
            }

            val popupAlreadyShowing = YaadAlarmPopupActivity.isShowingGeofencePopup()
            val wakePhaseKey = "\${id}_\${sonarMode}_\${eventType}_\${is5Hz}"
            val nowWakeMs = System.currentTimeMillis()
            // Launch the full-screen alert whenever a brand-new alert phase starts (for both Enter and Exit),
            // OR whenever an active out-of-app alert is not yet showing its full-screen popup!
            val isFirstWakeForPhase = isTopPriority && wokenAlertPhaseSet.add(wakePhaseKey)
            if (isFirstWakeForPhase) {
                lastPhaseWakeTimestampMap[wakePhaseKey] = nowWakeMs
            }

            val shouldLaunchFullScreenPopup = isTopPriority && (
                isFirstWakeForPhase ||
                    (!popupAlreadyShowing && nowWakeMs - lastOutOfAppPopupLaunchAttemptMs >= 6_000L)
            )

            if (shouldLaunchFullScreenPopup && wasScreenOffBeforeWake) {
                wakeScreenForLockscreenAlert(keepAwakeDurationMs)
            }

            val shouldPostNotif = if (screenOffOrLocked) {
                !popupAlreadyShowing || shouldLaunchFullScreenPopup
            } else {
                true
            }
            val shouldUseLiveUpdate = !shouldLaunchFullScreenPopup

            val sourceJsonStr = buildAndPostStatusBarNotification(
                notificationId = notificationId,
                id = id,
                notifTitle = notifTitle,
                notifBody = notifBody,
                isSub10m = isSub10m,
                distance = distance,
                radius = radius,
                targetLat = targetLat,
                targetLon = targetLon,
                bearingDeg = bearingDeg,
                sonarMode = sonarMode,
                isEn = isEn,
                isLiveUpdate = shouldUseLiveUpdate,
                showFullScreen = shouldLaunchFullScreenPopup,
                postToStatusBar = shouldPostNotif,
                visualOnlyBanner = visualOnlyBanner,
                visualBannerText = visualBannerText,
                multiCardsJson = multiCardsJson,
                wasScreenOff = wasScreenOffBeforeWake,
                keepScreenOnDurationMs = keepAwakeDurationMs
            )

            if (shouldLaunchFullScreenPopup) {
                lastOutOfAppPopupLaunchAttemptMs = nowWakeMs
                YaadAlarmPopupActivity.launch(
                    this,
                    notificationId,
                    sourceJsonStr,
                    wakeScreenOnce = true,
                    forceScreenOffDuration = wasScreenOffBeforeWake
                )
            }
        } catch (e: Exception) {
        }
    }

    private fun wakeScreenForLockscreenAlert(durationMs: Long = YaadAlarmPopupActivity.SCREEN_OFF_KEEP_AWAKE_MS) {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                "yaad:geofenceScreenWakeUp"
            )
            wl.setReferenceCounted(false)
            wl.acquire(durationMs.coerceIn(YaadAlarmPopupActivity.SCREEN_ON_KEEP_AWAKE_MS, YaadAlarmPopupActivity.SCREEN_OFF_KEEP_AWAKE_MS))
        } catch (e: Exception) {
        }
    }

    private fun buildAndPostStatusBarNotification(
        notificationId: Int,
        id: String,
        notifTitle: String,
        notifBody: String,
        isSub10m: Boolean,
        distance: Int,
        radius: Int,
        targetLat: Double,
        targetLon: Double,
        bearingDeg: Float = activeGeofenceBearingDeg,
        sonarMode: String = activeGeofenceSonarMode,
        isEn: Boolean,
        isLiveUpdate: Boolean,
        showFullScreen: Boolean,
        postToStatusBar: Boolean = true,
        visualOnlyBanner: Boolean = false,
        visualBannerText: String = "",
        multiCardsJson: String = "",
        wasScreenOff: Boolean = false,
        keepScreenOnDurationMs: Long = YaadAlarmPopupActivity.SCREEN_ON_KEEP_AWAKE_MS
    ): String {
        val alertChannelId = "yaad_channel_v7_geofence_lockscreen"

        val extraJson = JSObject().apply {
            put("geofence", true)
            put("geofenceItemId", id)
            put("sub10m", isSub10m)
            put("distance", distance)
            put("radius", radius)
            put("latitude", targetLat)
            put("longitude", targetLon)
            put("bearingDeg", bearingDeg.toDouble())
            put("sonarMode", sonarMode)
            put("language", if (isEn) "en" else "fa")
            put("theme", if (isSub10m) "geofence-sub10m" else "geofence-radar")
            put("visualOnlyBanner", visualOnlyBanner)
            put("visualOnly", visualOnlyBanner)
            put("visualBannerText", visualBannerText)
            put("visualBannerMessage", visualBannerText)
            if (multiCardsJson.isNotEmpty()) {
                try {
                    put("multiCards", JSONArray(multiCardsJson))
                    put("multiItemsJson", multiCardsJson)
                } catch (e: Exception) {
                }
            }
        }
        val sourceObj = JSObject().apply {
            put("id", notificationId)
            put("title", notifTitle)
            put("body", notifBody)
            put("extra", extraJson)
        }
        val sourceJsonStr = sourceObj.toString()

        if (!postToStatusBar) {
            return sourceJsonStr
        }

        val now = System.currentTimeMillis()
        // Do not overwrite an active fullScreenIntent notification with a silent live update within 3.5 seconds of firing
        if (isLiveUpdate && !showFullScreen && now - lastFullScreenNotificationPostMs < 3_500L) {
            return sourceJsonStr
        }

        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val popupIntent = Intent(this, YaadAlarmPopupActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                Intent.FLAG_ACTIVITY_NO_USER_ACTION
            putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJsonStr)
            putExtra("yaad_wake_screen_once", true)
            putExtra("yaad_launched_from_screen_off", wasScreenOff)
            putExtra("yaad_keep_screen_on_duration_ms", keepScreenOnDurationMs)
        }
        val fullScreenPi = YaadAlarmPopupActivity.createBalAllowedActivityPendingIntent(
            this,
            notificationId + 100000,
            popupIntent,
            piFlags
        )

        val stopIntent = Intent(this, YaadGeofenceService::class.java).apply {
            action = ACTION_STOP_GEOFENCE_ALERT
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(EXTRA_GEOFENCE_ITEM_ID, id)
        }
        val stopPi = PendingIntent.getService(
            this,
            notificationId + 200000,
            stopIntent,
            piFlags
        )

        val snoozeIntent = Intent(this, YaadGeofenceService::class.java).apply {
            action = ACTION_SNOOZE_GEOFENCE_ALERT
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(EXTRA_GEOFENCE_ITEM_ID, id)
        }
        val snoozePi = PendingIntent.getService(
            this,
            notificationId + 250000,
            snoozeIntent,
            piFlags
        )

        val directionsIntent = Intent(this, YaadAlarmPopupActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
            putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJsonStr)
            putExtra("yaad_direct_geofence_directions", true)
        }
        val directionsPi = YaadAlarmPopupActivity.createBalAllowedActivityPendingIntent(
            this,
            notificationId + 400000,
            directionsIntent,
            piFlags
        )

        val editIntent = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, YaadAlarmPopupActivity::class.java)).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "edit")
            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJsonStr)
            putExtra("yaad_direct_geofence_edit", true)
        }
        val editPi = YaadAlarmPopupActivity.createBalAllowedActivityPendingIntent(
            this,
            notificationId + 300000,
            editIntent,
            piFlags
        )

        val smallIconRes = resources.getIdentifier("ic_stat_icon_config_sample", "drawable", packageName)
            .takeIf { it != 0 } ?: applicationInfo.icon

        val distFormatted = if (isEn) "\${distance}m" else "\${toPersianDigits(distance.toString())} متر"
        val headerTitle = "\$notifTitle  •  \$distFormatted"

        val builder = NotificationCompat.Builder(this, alertChannelId)
            .setSmallIcon(smallIconRes)
            .setContentTitle(headerTitle)
            .setContentText(notifBody)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notifBody).setBigContentTitle(headerTitle))
            .setColor(if (visualOnlyBanner || isSub10m) 0xFF059669.toInt() else 0xFF04231F.toInt())
            .setColorized(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(!visualOnlyBanner)
            .setOnlyAlertOnce(isLiveUpdate && !showFullScreen)
            .setAutoCancel(false)
            .setGroup(GEOFENCE_MULTI_GROUP_KEY)
            .setDeleteIntent(snoozePi)
            .setContentIntent(fullScreenPi)
            .addAction(
                0,
                if (isEn) "⏱ Not Now (Snooze)" else "⏱ الان نه (Snooze)",
                snoozePi
            )
            .addAction(
                0,
                if (isEn) "⏹ Stop" else "⏹ توقف",
                stopPi
            )
            .addAction(
                0,
                if (isEn) "🧭 Directions" else "🧭 مسیریابی",
                directionsPi
            )

        // Do NOT call builder.setTimeoutAfter(20_000L) so the notification and full-screen alert stay active until user reaction!
        if (!isLiveUpdate || showFullScreen) {
            builder.setVibrate(longArrayOf(0, 450, 180, 450))
        }
        if (showFullScreen) {
            builder.setFullScreenIntent(fullScreenPi, true)
        }

        val nmCompat = NotificationManagerCompat.from(this)
        if (showFullScreen) {
            lastFullScreenNotificationPostMs = now
            // Cancel any existing notification with the same ID first so Android treats this as a fresh post
            // and unconditionally fires the fullScreenIntent on lockscreen / screen-off!
            try {
                nmCompat.cancel(notificationId)
            } catch (e: Exception) {
            }
        }
        nmCompat.notify(notificationId, builder.build())

        if (multiCardsJson.isNotEmpty()) {
            val summaryTitle = if (isEn) "Active Geofence Alerts" else "اعلان‌های حصار مکانی"
            val summaryNotif = NotificationCompat.Builder(this, alertChannelId)
                .setSmallIcon(smallIconRes)
                .setContentTitle(summaryTitle)
                .setStyle(NotificationCompat.InboxStyle().setSummaryText(summaryTitle))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup(GEOFENCE_MULTI_GROUP_KEY)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build()
            nmCompat.notify(GEOFENCE_GROUP_SUMMARY_ID, summaryNotif)
        }

        return sourceJsonStr
    }

    private fun calculateHaversineMeters(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double
    ): Int {
        val r = 6371000.0
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val dPhi = Math.toRadians(lat2 - lat1)
        val dLambda = Math.toRadians(lon2 - lon1)

        val a = sin(dPhi / 2) * sin(dPhi / 2) +
            cos(phi1) * cos(phi2) * sin(dLambda / 2) * sin(dLambda / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return (r * c).roundToInt()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(periodicCheckRunnable)
        unregisterScreenStateReceiver()
        stopLocationUpdates()
        releaseServiceCpuWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val PREFS_NAME = "YAAD_GEOFENCE_PREFS"
        private const val KEY_ENABLED = "geofence_enabled"
        private const val KEY_LANGUAGE = "geofence_lang"
        private const val KEY_ITEMS_JSON = "geofence_items_json"
        private const val KEY_STOPPED_ITEMS_QUEUE = "geofence_stopped_items_queue"
        private const val KEY_RADAR_DISABLED_FROM_BG = "geofence_radar_disabled_from_bg"
        private const val KEY_LAST_SYNCED_LAT_BITS = "geofence_last_synced_lat_bits"
        private const val KEY_LAST_SYNCED_LON_BITS = "geofence_last_synced_lon_bits"
        private const val KEY_LAST_SYNCED_ACC = "geofence_last_synced_acc"
        private const val KEY_LAST_SYNCED_TIME = "geofence_last_synced_time"
        private const val RADAR_SERVICE_CHANNEL_ID = "yaad_geofence_radar_service_v1"
        private const val RADAR_FOREGROUND_NOTIFICATION_ID = 889911
        private const val GPS_WARNING_NOTIFICATION_ID = 889912
        private const val GEOFENCE_MULTI_GROUP_KEY = "YAAD_GEOFENCE_MULTI_GROUP"
        private const val GEOFENCE_GROUP_SUMMARY_ID = 889915
        const val ACTION_STOP_GEOFENCE_ALERT = "com.capacitorjs.plugins.localnotifications.STOP_GEOFENCE_ALERT"
        const val ACTION_SNOOZE_GEOFENCE_ALERT = "com.capacitorjs.plugins.localnotifications.SNOOZE_GEOFENCE_ALERT"
        const val ACTION_DISABLE_GEOFENCE_RADAR = "com.capacitorjs.plugins.localnotifications.DISABLE_GEOFENCE_RADAR"
        const val ACTION_RESTART_GEOFENCE_SERVICE = "com.capacitorjs.plugins.localnotifications.RESTART_GEOFENCE_SERVICE"
        const val ACTION_APP_BACKGROUNDED_CHECK = "com.capacitorjs.plugins.localnotifications.APP_BACKGROUNDED_CHECK"
        const val EXTRA_NOTIFICATION_ID = "extra_geofence_notif_id"
        const val EXTRA_GEOFENCE_ITEM_ID = "extra_geofence_item_id"

        @Volatile
        internal var isInScreenOffSession: Boolean = false
        @Volatile
        private var lastFullScreenNotificationPostMs: Long = 0L

        fun isScreenOffOrLockedStatic(context: Context): Boolean {
            return try {
                if (isInScreenOffSession) return true
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val interactive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                    pm?.isInteractive != false
                } else {
                    @Suppress("DEPRECATION")
                    pm?.isScreenOn != false
                }
                if (!interactive) return true
                val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                km?.isKeyguardLocked == true
            } catch (e: Exception) {
                false
            }
        }

        fun onAppForegrounded(context: Context) {
            try {
                if (!isScreenOffOrLockedStatic(context)) {
                    isInScreenOffSession = false
                    if (activeGeofenceNotificationId != Int.MIN_VALUE) {
                        NotificationManagerCompat.from(context).cancel(activeGeofenceNotificationId)
                    }
                }
            } catch (e: Exception) {
            }
        }

        fun onAppBackgrounded(context: Context) {
            try {
                val appCtx = context.applicationContext
                if (shouldRun(appCtx) && hasLocationPermission(appCtx)) {
                    val intent = Intent(appCtx, YaadGeofenceService::class.java).apply {
                        action = ACTION_APP_BACKGROUNDED_CHECK
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ContextCompat.startForegroundService(appCtx, intent)
                    } else {
                        appCtx.startService(intent)
                    }
                }
            } catch (e: Exception) {
            }
        }

        /**
         * Generates an isolated Notification ID in the 700,000,000+ range for Geofences
         * so it NEVER collides with Time Reminder notification IDs (1..600,000,000).
         */
        fun geofenceNotifId(id: String): Int {
            return 700_000_000 + (id.hashCode() and 0x07ffffff)
        }

        private data class WeightedSample(val distance: Double, val weight: Double)

        private val distanceHistoryMap = HashMap<String, ArrayList<WeightedSample>>()
        private val lastMoveRefDistMap = HashMap<String, Double>()
        private val lastInwardMoveTimeMap = HashMap<String, Long>()
        private val lastOutwardMoveTimeMap = HashMap<String, Long>()
        private val minDistInsideMap = HashMap<String, Double>()
        private val maxDistApproachMap = HashMap<String, Double>()
        private val startedOutsideMap = HashMap<String, Boolean>()
        private val outsideSampleCountMap = HashMap<String, Int>()
        private val insideSampleCountMap = HashMap<String, Int>()
        private val exitAntiBounceUntilMap = HashMap<String, Long>()
        private val exitOscillationCountMap = HashMap<String, Int>()
        private val exitOutwardSampleCountMap = HashMap<String, Int>()
        private val fivePctInsideSampleCountMap = HashMap<String, Int>()
        private val wasInFivePctForExitMap = HashMap<String, Boolean>()
        private val lastExitAlertEmittedTimeMap = HashMap<String, Long>()
        private val lastSampleEvalTimeMap = HashMap<String, Long>()
        private val lastSampleEvalDistMap = HashMap<String, Int>()
        private val lastPhaseWakeTimestampMap = java.util.concurrent.ConcurrentHashMap<String, Long>()
        private val wokenAlertPhaseSet = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

        /**
         * Dedicated 5% Zone Silence & Indoor/Boundary GPS Error Anti-Bounce Filter for Exit Mode ("exit"):
         * 1. Unconditional Silence inside 5% Zone:
         *    Whenever rawDistance <= centerZoneMeters OR smoothedDistance <= centerZoneMeters,
         *    NO notification and NO alarm/sonar is ever allowed to fire (even if GPS drifts outward inside the 5% zone).
         * 2. 5% Boundary Hysteresis ("در مرز پنج درصد") & Under-Roof GPS Error Protection ("زیر سقف"):
         *    Applies a tight accuracy-adaptive escape margin beyond the 5% boundary ('fivePctExitEscapeMeters'),
         *    rejects indoor multipath spikes across the 5% border, and enforces an escalating anti-bounce cooldown
         *    whenever GPS oscillates back into the 5% zone so repeated back-to-back notifications never occur.
         * Returns Pair(shouldSuppressAlert, prefsModified).
         */
        private fun shouldSuppressExitByFivePercentAndGpsFilter(
            id: String,
            rawDistance: Int,
            smoothedDistance: Int,
            smoothedDistDouble: Double,
            radius: Int,
            centerZoneMeters: Int,
            accuracyMeters: Double,
            minDistInside: Double,
            isConfirmedExiting: Boolean,
            isMovingInward: Boolean,
            wasInsideBefore: Boolean,
            armedForExit: Boolean,
            completedCycle: Boolean,
            sonarDone: Boolean,
            fiveHzStart: Long,
            latchedMode: String,
            now: Long,
            editor: android.content.SharedPreferences.Editor,
            insideKey: String,
            armedExitKey: String,
            completedCycleKey: String,
            sonarDoneKey: String,
            fiveHzKey: String,
            latchedModeKey: String
        ): Pair<Boolean, Boolean> {
            var prefsChanged = false
            val safeAcc = accuracyMeters.coerceIn(5.0, 100.0)
            val prevEvalDist = lastSampleEvalDistMap[id]
            val prevEvalTime = lastSampleEvalTimeMap[id] ?: 0L
            val isNewSampleTick = prevEvalDist == null ||
                kotlin.math.abs(rawDistance - prevEvalDist) >= 1 ||
                now - prevEvalTime >= 950L
            if (isNewSampleTick) {
                lastSampleEvalDistMap[id] = rawDistance
                lastSampleEvalTimeMap[id] = now
            }

            // 1. UNCONDITIONAL SILENCE INSIDE THE 5% ZONE:
            if (rawDistance <= centerZoneMeters || smoothedDistance <= centerZoneMeters) {
                wasInFivePctForExitMap[id] = true
                exitOutwardSampleCountMap[id] = 0
                val insideFivePctSamples = (fivePctInsideSampleCountMap[id] ?: 0) + (if (isNewSampleTick) 1 else 0)
                fivePctInsideSampleCountMap[id] = insideFivePctSamples

                val lastAlertMs = lastExitAlertEmittedTimeMap[id] ?: 0L
                val hadRecentExitAlert = latchedMode == "exit" || fiveHzStart > 0L || (lastAlertMs > 0L && now - lastAlertMs < 90_000L)
                if (hadRecentExitAlert) {
                    if (latchedMode == "exit" || fiveHzStart > 0L) {
                        val oscCount = ((exitOscillationCountMap[id] ?: 0) + 1).coerceAtMost(6)
                        exitOscillationCountMap[id] = oscCount
                        val debounceMs = (45_000L * oscCount).coerceAtMost(180_000L)
                        val prevCooldown = exitAntiBounceUntilMap[id] ?: 0L
                        exitAntiBounceUntilMap[id] = kotlin.math.max(prevCooldown, now + debounceMs)
                    }
                    editor.remove(fiveHzKey)
                    editor.remove(latchedModeKey)
                    prefsChanged = true
                }

                if (!wasInsideBefore) {
                    editor.putBoolean(insideKey, true)
                    prefsChanged = true
                }
                if (!armedForExit) {
                    editor.putBoolean(armedExitKey, true)
                    prefsChanged = true
                }

                val antiBounceUntil = exitAntiBounceUntilMap[id] ?: 0L
                if (insideFivePctSamples >= 2 && now >= antiBounceUntil) {
                    if (completedCycle || sonarDone) {
                        editor.putBoolean(completedCycleKey, false)
                        editor.putBoolean(sonarDoneKey, false)
                        val prefix = "\${id}_"
                        for (k in wokenAlertPhaseSet.toList()) {
                            if (k.startsWith(prefix)) wokenAlertPhaseSet.remove(k)
                        }
                        prefsChanged = true
                    }
                    exitOscillationCountMap[id] = 0
                }
                return Pair(true, prefsChanged)
            }

            fivePctInsideSampleCountMap[id] = 0

            // 2. HYSTERESIS DEADBAND AT THE 5% BORDER ("در مرز پنج درصد") & INDOOR GPS ERROR ("زیر سقف"):
            val maxBorderBuffer = kotlin.math.min(18, kotlin.math.max(5, (radius * 0.12).roundToInt()))
            val gpsBorderBuffer = (safeAcc * 0.35).roundToInt().coerceIn(4, maxBorderBuffer)
            val fivePctExitEscapeMeters = kotlin.math.min((radius * 0.65).roundToInt(), centerZoneMeters + gpsBorderBuffer)

            val antiBounceUntil = exitAntiBounceUntilMap[id] ?: 0L
            if (now < antiBounceUntil && smoothedDistance <= radius) {
                return Pair(true, prefsChanged)
            }

            val isAlreadyLatchedOutward = (latchedMode == "exit" && !isMovingInward) || fiveHzStart > 0L
            if (!isAlreadyLatchedOutward) {
                if (smoothedDistance <= fivePctExitEscapeMeters || rawDistance <= fivePctExitEscapeMeters) {
                    exitOutwardSampleCountMap[id] = 0
                    if (!armedForExit) {
                        editor.putBoolean(armedExitKey, true)
                        prefsChanged = true
                    }
                    return Pair(true, prefsChanged)
                }

                val wasInFivePct = wasInFivePctForExitMap[id] == true
                val requiredDisplacementFromMin = if (wasInFivePct) {
                    kotlin.math.min(14.0, kotlin.math.max(4.0, safeAcc * 0.35))
                } else {
                    3.0
                }
                val hasMovedSignificantlyFromMin = !minDistInside.isFinite() ||
                    (smoothedDistDouble - minDistInside >= requiredDisplacementFromMin) ||
                    (rawDistance.toDouble() - minDistInside >= requiredDisplacementFromMin)

                if (isConfirmedExiting && hasMovedSignificantlyFromMin) {
                    if (isNewSampleTick) {
                        exitOutwardSampleCountMap[id] = (exitOutwardSampleCountMap[id] ?: 0) + 1
                    }
                } else if (isMovingInward) {
                    exitOutwardSampleCountMap[id] = 0
                }

                if (smoothedDistance <= radius) {
                    val isNearFivePctBorder = smoothedDistance <= fivePctExitEscapeMeters + 12
                    val neededSamples = if ((wasInFivePct && isNearFivePctBorder) || safeAcc > 35.0) 2 else 1
                    val curSamples = exitOutwardSampleCountMap[id] ?: 0
                    if (!isConfirmedExiting || !hasMovedSignificantlyFromMin || curSamples < neededSamples) {
                        return Pair(true, prefsChanged)
                    }
                }
            } else if (smoothedDistance <= radius && isMovingInward && smoothedDistance <= fivePctExitEscapeMeters) {
                editor.remove(latchedModeKey)
                exitOutwardSampleCountMap[id] = 0
                exitAntiBounceUntilMap[id] = kotlin.math.max(antiBounceUntil, now + 30_000L)
                prefsChanged = true
                return Pair(true, prefsChanged)
            }

            return Pair(false, prefsChanged)
        }

        private fun computeWeightedAvg(samples: List<WeightedSample>): Double {
            if (samples.isEmpty()) return 0.0
            var wSum = 0.0
            var totalW = 0.0
            for (s in samples) {
                wSum += s.distance * s.weight
                totalW += s.weight
            }
            return if (totalW > 0.0) wSum / totalW else samples.last().distance
        }

        private fun recordAndAnalyzeNativeTrend(
            itemId: String,
            rawDistance: Double,
            accuracyMeters: Double = 15.0,
            nowMs: Long = System.currentTimeMillis()
        ): Pair<Double, Double> {
            val safeAcc = accuracyMeters.coerceIn(5.0, 80.0)
            val weight = 1.0 / (safeAcc * safeAcc)

            val prevRef = lastMoveRefDistMap[itemId]
            if (prevRef == null) {
                lastMoveRefDistMap[itemId] = rawDistance
            } else {
                val diff = rawDistance - prevRef
                val moveThresh = (safeAcc * 0.15).coerceIn(2.0, 5.0)
                if (kotlin.math.abs(diff) >= moveThresh) {
                    if (diff <= -moveThresh) {
                        lastInwardMoveTimeMap[itemId] = nowMs
                    } else if (diff >= moveThresh) {
                        lastOutwardMoveTimeMap[itemId] = nowMs
                    }
                    lastMoveRefDistMap[itemId] = rawDistance
                }
            }

            val list = distanceHistoryMap.getOrPut(itemId) { ArrayList() }
            if (list.isEmpty() || kotlin.math.abs(rawDistance - list.last().distance) >= 0.8) {
                list.add(WeightedSample(rawDistance, weight))
                while (list.size > 5) {
                    list.removeAt(0)
                }
            }
            val smoothed = computeWeightedAvg(list)
            if (list.size < 2) {
                return Pair(smoothed, 0.0)
            }
            val splitIdx = (list.size / 2).coerceAtLeast(1)
            val olderAvg = computeWeightedAvg(list.subList(0, splitIdx))
            val newerAvg = computeWeightedAvg(list.subList(splitIdx, list.size))
            val delta = newerAvg - olderAvg
            if (delta <= -1.0) {
                lastInwardMoveTimeMap[itemId] = nowMs
            } else if (delta >= 1.5) {
                lastOutwardMoveTimeMap[itemId] = nowMs
            }
            return Pair(smoothed, delta)
        }

        @Volatile
        private var sonarLoopActive: Boolean = false
        @Volatile
        private var geofenceAudioMuted: Boolean = false
        @Volatile
        private var sonarPausedByPhoneCall: Boolean = false
        @Volatile
        private var wasInPhoneCallLastTick: Boolean = false
        @Volatile
        private var liveSonarDistanceMeters: Int = 100
        @Volatile
        private var liveSonarRadiusMeters: Int = 200
        @Volatile
        private var liveSonarMode: String = "enter"
        @Volatile
        private var activeGeofenceNotificationId: Int = Int.MIN_VALUE
        @Volatile
        private var activeGeofenceItemId: String = ""
        @Volatile
        private var activeGeofenceTitle: String = ""
        @Volatile
        private var activeGeofenceDescription: String = ""
        @Volatile
        private var activeGeofenceCustomMessage: String = ""
        @Volatile
        private var activeGeofenceEventType: String = "enter"
        @Volatile
        private var activeGeofenceRadius: Int = 200
        @Volatile
        private var activeGeofenceLat: Double = Double.NaN
        @Volatile
        private var activeGeofenceLon: Double = Double.NaN
        @Volatile
        private var activeGeofenceBearingDeg: Float = 300f
        @Volatile
        private var activeGeofenceSonarMode: String = "enter"
        @Volatile
        private var activeGeofenceIsEn: Boolean = false
        @Volatile
        private var lastActiveMultiCardsJson: String = ""
        @Volatile
        private var lastNotifiedStatusBarDistance: Int = Int.MIN_VALUE
        @Volatile
        private var lastOutOfAppPopupLaunchAttemptMs: Long = 0L
        @Volatile
        private var gpsWarningPosted: Boolean = false

        private var sonarThread: Thread? = null
        private var sonarWakeLock: PowerManager.WakeLock? = null

        fun isGeofenceAudioMuted(): Boolean = geofenceAudioMuted

        fun pauseSonarForPhoneCall(context: Context) {
            sonarPausedByPhoneCall = true
            sonarLoopActive = false
            try {
                sonarThread?.interrupt()
            } catch (e: Exception) {
            }
            sonarThread = null
        }

        fun restoreGeofenceAlertAfterPhoneCall(context: Context) {
            val appCtx = context.applicationContext
            sonarPausedByPhoneCall = false
            if (activeGeofenceNotificationId == Int.MIN_VALUE || activeGeofenceItemId.isEmpty()) return
            if (!shouldRun(appCtx)) return

            try {
                val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val now = System.currentTimeMillis()
                val cleanId = activeGeofenceItemId.removePrefix("loc_").removePrefix("rem_")
                for (sfx in listOf(activeGeofenceItemId, cleanId, "loc_\$cleanId", "rem_\$cleanId")) {
                    if (prefs.getLong("paused_until_\$sfx", 0L) > now) return
                    if (prefs.getBoolean("completed_cycle_\$sfx", false)) return
                }

                val isVisualOnly = activeGeofenceEventType == "visual_banner"
                val sonarDone = prefs.getBoolean("sonar_done_\$activeGeofenceItemId", false)
                if (!geofenceAudioMuted && !isVisualOnly && !sonarDone && !sonarLoopActive) {
                    startNativeSubmarineSonarLoop(
                        appCtx,
                        liveSonarDistanceMeters,
                        liveSonarRadiusMeters,
                        activeGeofenceNotificationId,
                        activeGeofenceSonarMode
                    )
                }

                // Relaunch the full-screen geofence alert if app is not in foreground or if screen is locked/off
                val screenOffOrLocked = isScreenOffOrLockedStatic(appCtx)
                if (!LocalNotificationsPlugin.isAppInForeground(appCtx) || screenOffOrLocked) {
                    val distText = if (activeGeofenceIsEn) "\${liveSonarDistanceMeters}m" else "\${toPersianDigitsStatic(liveSonarDistanceMeters.toString())} متر"
                    val radText = if (activeGeofenceIsEn) "Radius: \${activeGeofenceRadius}m" else "شعاع حصار: \${toPersianDigitsStatic(activeGeofenceRadius.toString())} متر"
                    val phrase = if (isVisualOnly && activeGeofenceCustomMessage.isNotEmpty()) activeGeofenceCustomMessage else activeGeofenceDescription
                    val notifTitle = "\$activeGeofenceTitle  •  \$distText"
                    val notifBody = if (phrase.isNotEmpty()) "\$phrase  |  \$radText" else radText

                    val extraJson = JSObject().apply {
                        put("geofence", true)
                        put("geofenceItemId", activeGeofenceItemId)
                        put("sub10m", activeGeofenceEventType == "arrived_under_10m")
                        put("distance", liveSonarDistanceMeters)
                        put("radius", activeGeofenceRadius)
                        put("latitude", activeGeofenceLat)
                        put("longitude", activeGeofenceLon)
                        put("bearingDeg", activeGeofenceBearingDeg.toDouble())
                        put("sonarMode", activeGeofenceSonarMode)
                        put("language", if (activeGeofenceIsEn) "en" else "fa")
                        put("theme", if (activeGeofenceEventType == "arrived_under_10m") "geofence-sub10m" else "geofence-radar")
                        put("visualOnlyBanner", isVisualOnly)
                        put("visualOnly", isVisualOnly)
                        put("visualBannerText", activeGeofenceCustomMessage)
                        put("visualBannerMessage", activeGeofenceCustomMessage)
                        if (lastActiveMultiCardsJson.isNotEmpty()) {
                            try {
                                put("multiCards", JSONArray(lastActiveMultiCardsJson))
                                put("multiItemsJson", lastActiveMultiCardsJson)
                            } catch (e: Exception) {
                            }
                        }
                    }
                    val sourceObj = JSObject().apply {
                        put("id", activeGeofenceNotificationId)
                        put("title", notifTitle)
                        put("body", notifBody)
                        put("extra", extraJson)
                    }
                    YaadAlarmPopupActivity.launch(
                        appCtx,
                        activeGeofenceNotificationId,
                        sourceObj.toString(),
                        wakeScreenOnce = true
                    )
                }
            } catch (e: Exception) {
            }
        }

        private fun toPersianDigitsStatic(input: String): String {
            val persian = charArrayOf('۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹')
            val sb = StringBuilder(input.length)
            for (ch in input) {
                if (ch in '0'..'9') {
                    sb.append(persian[ch - '0'])
                } else {
                    sb.append(ch)
                }
            }
            return sb.toString()
        }

        fun setGeofenceAudioMuteState(context: Context, muted: Boolean): Boolean {
            geofenceAudioMuted = muted
            if (geofenceAudioMuted) {
                sonarLoopActive = false
                try {
                    sonarThread?.interrupt()
                } catch (e: Exception) {
                }
                sonarThread = null
            } else if (
                activeGeofenceNotificationId != Int.MIN_VALUE &&
                activeGeofenceEventType != "visual_banner" &&
                !YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(context)
            ) {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val sonarDone = prefs.getBoolean("sonar_done_\$activeGeofenceItemId", false)
                if (!sonarDone) {
                    startNativeSubmarineSonarLoop(
                        context.applicationContext,
                        liveSonarDistanceMeters,
                        liveSonarRadiusMeters,
                        activeGeofenceNotificationId,
                        liveSonarMode
                    )
                }
            }
            return geofenceAudioMuted
        }

        fun toggleGeofenceAudioMute(context: Context): Boolean {
            return setGeofenceAudioMuteState(context, !geofenceAudioMuted)
        }

        fun isDeviceLocationEnabled(context: Context): Boolean {
            return try {
                val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    lm.isLocationEnabled
                } else {
                    lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                        lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                }
            } catch (e: Exception) {
                true
            }
        }

        fun openDeviceLocationSettings(context: Context) {
            try {
                val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
            }
        }

        fun launchGoogleMapsDirections(context: Context, lat: Double, lon: Double, label: String) {
            try {
                val uriStr = if (!lat.isNaN() && !lon.isNaN()) {
                    "https://www.google.com/maps/dir/?api=1&destination=\$lat,\$lon&travelmode=driving"
                } else {
                    "https://www.google.com/maps/search/?api=1&query=" + Uri.encode(label)
                }
                val mapIntent = Intent(Intent.ACTION_VIEW, Uri.parse(uriStr)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(mapIntent)
            } catch (e: Exception) {
            }
        }

        fun cancelGpsDisabledWarningNotification(context: Context) {
            if (!gpsWarningPosted) return
            gpsWarningPosted = false
            try {
                NotificationManagerCompat.from(context).cancel(GPS_WARNING_NOTIFICATION_ID)
            } catch (e: Exception) {
            }
        }

        fun resetSavedGeofenceState(context: Context, itemId: String) {
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val editor = prefs.edit()
                if (itemId.isNotEmpty()) {
                    val cleanId = itemId.removePrefix("loc_").removePrefix("rem_")
                    val suffixes = listOf(itemId, cleanId, "loc_\$cleanId", "rem_\$cleanId")
                    for (sfx in suffixes) {
                        distanceHistoryMap.remove(sfx)
                        lastMoveRefDistMap.remove(sfx)
                        lastInwardMoveTimeMap.remove(sfx)
                        lastOutwardMoveTimeMap.remove(sfx)
                        minDistInsideMap.remove(sfx)
                        maxDistApproachMap.remove(sfx)
                        startedOutsideMap.remove(sfx)
                        outsideSampleCountMap.remove(sfx)
                        insideSampleCountMap.remove(sfx)
                        exitAntiBounceUntilMap.remove(sfx)
                        exitOscillationCountMap.remove(sfx)
                        exitOutwardSampleCountMap.remove(sfx)
                        fivePctInsideSampleCountMap.remove(sfx)
                        wasInFivePctForExitMap.remove(sfx)
                        lastExitAlertEmittedTimeMap.remove(sfx)
                        lastSampleEvalTimeMap.remove(sfx)
                        lastSampleEvalDistMap.remove(sfx)
                        val prefix = "\${sfx}_"
                        for (k in lastPhaseWakeTimestampMap.keys().toList()) {
                            if (k.startsWith(prefix)) lastPhaseWakeTimestampMap.remove(k)
                        }
                        for (k in wokenAlertPhaseSet.toList()) {
                            if (k.startsWith(prefix)) wokenAlertPhaseSet.remove(k)
                        }
                        editor.remove("inside_\$sfx")
                        editor.remove("armed_exit_\$sfx")
                        editor.remove("sonar_done_\$sfx")
                        editor.remove("u10m_\$sfx")
                        editor.remove("last_trig_\$sfx")
                        editor.remove("last_u10m_trig_\$sfx")
                        editor.remove("five_hz_start_\$sfx")
                        editor.remove("banner_start_\$sfx")
                        editor.remove("banner_text_\$sfx")
                        editor.remove("entry_toast_start_\$sfx")
                        editor.remove("completed_cycle_\$sfx")
                        editor.remove("latched_mode_\$sfx")
                        editor.remove("paused_until_\$sfx")
                        editor.remove("cooldown_until_\$sfx")
                    }
                } else {
                    distanceHistoryMap.clear()
                    lastMoveRefDistMap.clear()
                    lastInwardMoveTimeMap.clear()
                    lastOutwardMoveTimeMap.clear()
                    minDistInsideMap.clear()
                    maxDistApproachMap.clear()
                    startedOutsideMap.clear()
                    outsideSampleCountMap.clear()
                    insideSampleCountMap.clear()
                    exitAntiBounceUntilMap.clear()
                    exitOscillationCountMap.clear()
                    exitOutwardSampleCountMap.clear()
                    fivePctInsideSampleCountMap.clear()
                    wasInFivePctForExitMap.clear()
                    lastExitAlertEmittedTimeMap.clear()
                    lastSampleEvalTimeMap.clear()
                    lastSampleEvalDistMap.clear()
                    lastPhaseWakeTimestampMap.clear()
                    wokenAlertPhaseSet.clear()
                    for (key in prefs.all.keys.toList()) {
                        if (
                            key.startsWith("inside_") ||
                            key.startsWith("armed_exit_") ||
                            key.startsWith("sonar_done_") ||
                            key.startsWith("u10m_") ||
                            key.startsWith("last_trig_") ||
                            key.startsWith("last_u10m_trig_") ||
                            key.startsWith("five_hz_start_") ||
                            key.startsWith("banner_start_") ||
                            key.startsWith("banner_text_") ||
                            key.startsWith("entry_toast_start_") ||
                            key.startsWith("completed_cycle_") ||
                            key.startsWith("latched_mode_") ||
                            key.startsWith("paused_until_") ||
                            key.startsWith("cooldown_until_")
                        ) {
                            editor.remove(key)
                        }
                    }
                }
                editor.apply()
            } catch (e: Exception) {
            }
        }

        fun disableGeofenceRadarFromBackground(context: Context) {
            geofenceAudioMuted = false
            val oldNotifId = activeGeofenceNotificationId
            YaadAlarmPopupActivity.clearSuspendedGeofenceIfMatching("")
            stopGeofenceAudio(context, oldNotifId)
            YaadAlarmPopupActivity.dismissIfMatching(oldNotifId)
            cancelGpsDisabledWarningNotification(context)
            try {
                val nm = NotificationManagerCompat.from(context)
                nm.cancel(RADAR_FOREGROUND_NOTIFICATION_ID)
                nm.cancel(GEOFENCE_GROUP_SUMMARY_ID)
            } catch (e: Exception) {
            }
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit()
                    .putBoolean(KEY_ENABLED, false)
                    .putBoolean(KEY_RADAR_DISABLED_FROM_BG, true)
                    .apply()
                LocalNotificationsPlugin.evaluateJsInWebView(
                    "window.dispatchEvent(new CustomEvent('yaad:disable-geofence-radar'));"
                )
            } catch (e: Exception) {
            }
        }

        fun consumeRadarDisabledFromBackground(context: Context): Boolean {
            return try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val wasDisabled = prefs.getBoolean(KEY_RADAR_DISABLED_FROM_BG, false)
                if (wasDisabled) {
                    prefs.edit().putBoolean(KEY_RADAR_DISABLED_FROM_BG, false).apply()
                }
                wasDisabled
            } catch (e: Exception) {
                false
            }
        }

        fun acknowledgeGeofenceItemForCycle(
            context: Context,
            rawItemId: String,
            notificationIdToCancel: Int = Int.MIN_VALUE
        ) {
            val targetId = rawItemId.ifEmpty { activeGeofenceItemId }
            geofenceAudioMuted = false
            YaadAlarmPopupActivity.clearSuspendedGeofenceIfMatching(targetId)
            stopGeofenceAudio(context, notificationIdToCancel)
            YaadAlarmPopupActivity.dismissIfMatching(notificationIdToCancel)
            if (targetId.isEmpty()) return

            try {
                val now = System.currentTimeMillis()
                val cooldownUntil = now + 3 * 60_000L
                val cleanId = targetId.removePrefix("loc_").removePrefix("rem_")
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val editor = prefs.edit()
                for (sfx in listOf(targetId, cleanId, "loc_\$cleanId", "rem_\$cleanId")) {
                    editor.putBoolean("completed_cycle_\$sfx", true)
                    editor.putBoolean("sonar_done_\$sfx", true)
                    editor.putLong("cooldown_until_\$sfx", cooldownUntil)
                    editor.remove("five_hz_start_\$sfx")
                    editor.remove("banner_start_\$sfx")
                    editor.remove("banner_text_\$sfx")
                }
                editor.apply()

                LocalNotificationsPlugin.evaluateJsInWebView(
                    "window.dispatchEvent(new CustomEvent('yaad:acknowledge-geofence-item', { detail: { itemId: '\$targetId' } }));"
                )
            } catch (e: Exception) {
            }
        }

        fun stopGeofenceOperationForItem(
            context: Context,
            rawItemId: String,
            notificationIdToCancel: Int = Int.MIN_VALUE
        ) {
            val targetId = rawItemId.ifEmpty { activeGeofenceItemId }
            geofenceAudioMuted = false
            YaadAlarmPopupActivity.clearSuspendedGeofenceIfMatching(targetId)
            stopGeofenceAudio(context, notificationIdToCancel)
            YaadAlarmPopupActivity.dismissIfMatching(notificationIdToCancel)

            if (targetId.isEmpty()) return

            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val rawItems = prefs.getString(KEY_ITEMS_JSON, "[]") ?: "[]"
                val arr = JSONArray(rawItems)
                val filteredArr = JSONArray()
                val cleanTarget = targetId.removePrefix("loc_").removePrefix("rem_")
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val oid = obj.optString("id", "")
                    val cleanOid = oid.removePrefix("loc_").removePrefix("rem_")
                    if (oid != targetId && cleanOid != cleanTarget) {
                        filteredArr.put(obj)
                    }
                }

                val queueRaw = prefs.getString(KEY_STOPPED_ITEMS_QUEUE, "[]") ?: "[]"
                val queueArr = try {
                    JSONArray(queueRaw)
                } catch (e: Exception) {
                    JSONArray()
                }
                queueArr.put(targetId)

                val editor = prefs.edit()
                for (sfx in listOf(targetId, cleanTarget, "loc_\$cleanTarget", "rem_\$cleanTarget")) {
                    editor.putBoolean("completed_cycle_\$sfx", true)
                    editor.putBoolean("sonar_done_\$sfx", true)
                }
                editor
                    .putString(KEY_ITEMS_JSON, filteredArr.toString())
                    .putString(KEY_STOPPED_ITEMS_QUEUE, queueArr.toString())
                    .putBoolean(KEY_ENABLED, filteredArr.length() > 0 && prefs.getBoolean(KEY_ENABLED, false))
                    .apply()

                LocalNotificationsPlugin.evaluateJsInWebView(
                    "window.dispatchEvent(new CustomEvent('yaad:stop-geofence-item', { detail: { itemId: '\$targetId' } }));"
                )
            } catch (e: Exception) {
            }
        }

        fun snoozeGeofenceItemForPassingThrough(
            context: Context,
            rawItemId: String,
            durationMs: Long = 30 * 60_000L,
            notificationIdToCancel: Int = Int.MIN_VALUE
        ) {
            val targetId = rawItemId.ifEmpty { activeGeofenceItemId }
            geofenceAudioMuted = false
            YaadAlarmPopupActivity.clearSuspendedGeofenceIfMatching(targetId)
            stopGeofenceAudio(context, notificationIdToCancel)
            YaadAlarmPopupActivity.dismissIfMatching(notificationIdToCancel)
            if (targetId.isEmpty()) return

            try {
                val now = System.currentTimeMillis()
                val resumeAt = now + durationMs.coerceAtLeast(60_000L)
                val cleanId = targetId.removePrefix("loc_").removePrefix("rem_")
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val editor = prefs.edit()
                for (sfx in listOf(targetId, cleanId, "loc_\$cleanId", "rem_\$cleanId")) {
                    editor.putLong("paused_until_\$sfx", resumeAt)
                    editor.putLong("cooldown_until_\$sfx", resumeAt)
                    editor.putBoolean("completed_cycle_\$sfx", true)
                    editor.putBoolean("sonar_done_\$sfx", true)
                    editor.putBoolean("inside_\$sfx", true)
                    editor.remove("five_hz_start_\$sfx")
                    editor.remove("banner_start_\$sfx")
                    editor.remove("banner_text_\$sfx")
                    outsideSampleCountMap[sfx] = 0
                }
                editor.apply()

                LocalNotificationsPlugin.evaluateJsInWebView(
                    "window.dispatchEvent(new CustomEvent('yaad:snooze-geofence-item', { detail: { itemId: '\$targetId' } }));"
                )
            } catch (e: Exception) {
            }
        }

        fun pauseGeofenceItemTemporarily(
            context: Context,
            rawItemId: String,
            durationMs: Long = 30 * 60_000L,
            notificationIdToCancel: Int = Int.MIN_VALUE
        ) {
            val targetId = rawItemId.ifEmpty { activeGeofenceItemId }
            YaadAlarmPopupActivity.clearSuspendedGeofenceIfMatching(targetId)
            stopGeofenceAudio(context, notificationIdToCancel)
            YaadAlarmPopupActivity.dismissIfMatching(notificationIdToCancel)
            if (targetId.isEmpty()) return

            try {
                val now = System.currentTimeMillis()
                val resumeAt = now + durationMs.coerceAtLeast(3_000L)
                val cleanId = targetId.removePrefix("loc_").removePrefix("rem_")
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val editor = prefs.edit()
                for (sfx in listOf(targetId, cleanId, "loc_\$cleanId", "rem_\$cleanId")) {
                    editor.putLong("paused_until_\$sfx", resumeAt)
                }
                editor.apply()
            } catch (e: Exception) {
            }
        }

        fun resumeGeofenceItemFromPause(
            context: Context,
            rawItemId: String = ""
        ) {
            try {
                val now = System.currentTimeMillis()
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val editor = prefs.edit()
                if (rawItemId.isNotEmpty()) {
                    val cleanId = rawItemId.removePrefix("loc_").removePrefix("rem_")
                    for (sfx in listOf(rawItemId, cleanId, "loc_\$cleanId", "rem_\$cleanId")) {
                        editor.remove("paused_until_\$sfx")
                        lastInwardMoveTimeMap[sfx] = now
                    }
                } else {
                    for (key in prefs.all.keys.toList()) {
                        if (key.startsWith("paused_until_")) {
                            val itemKey = key.removePrefix("paused_until_")
                            editor.remove(key)
                            lastInwardMoveTimeMap[itemKey] = now
                        }
                    }
                }
                editor.apply()
            } catch (e: Exception) {
            }
        }

        fun consumeQueuedStoppedItems(context: Context): String {
            return try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val raw = prefs.getString(KEY_STOPPED_ITEMS_QUEUE, "[]") ?: "[]"
                if (raw != "[]") {
                    prefs.edit().putString(KEY_STOPPED_ITEMS_QUEUE, "[]").apply()
                }
                raw
            } catch (e: Exception) {
                "[]"
            }
        }

        fun computeSonarIntervalMs(distanceMeters: Int, radiusMeters: Int, mode: String = "enter"): Long {
            val safeRadius = radiusMeters.coerceAtLeast(20)
            val clampedDist = distanceMeters.coerceAtLeast(0)
            val fivePctMeters = kotlin.math.min((safeRadius * 0.35).toInt(), kotlin.math.max(15, (safeRadius * 0.05).roundToInt()))

            return if (mode == "exit" || mode == "both_exit") {
                if (clampedDist > safeRadius) 200L else 6000L
            } else {
                if (clampedDist <= fivePctMeters) 200L else 6000L
            }
        }

        fun updateLiveSonarDistance(distanceMeters: Int, radiusMeters: Int, mode: String = liveSonarMode) {
            liveSonarDistanceMeters = distanceMeters
            if (radiusMeters > 0) {
                liveSonarRadiusMeters = radiusMeters
            }
            liveSonarMode = mode
        }

        fun stopGeofenceAudio(context: Context? = null, notificationIdToCancel: Int = Int.MIN_VALUE) {
            sonarLoopActive = false
            try {
                sonarThread?.interrupt()
            } catch (e: Exception) {
            }
            sonarThread = null
            try {
                sonarWakeLock?.let { wl ->
                    if (wl.isHeld) wl.release()
                }
            } catch (e: Exception) {
            }
            sonarWakeLock = null

            if (context != null) {
                try {
                    val nm = NotificationManagerCompat.from(context)
                    if (notificationIdToCancel != Int.MIN_VALUE) {
                        nm.cancel(notificationIdToCancel)
                    }
                    if (activeGeofenceNotificationId != Int.MIN_VALUE) {
                        nm.cancel(activeGeofenceNotificationId)
                    }
                } catch (e: Exception) {
                }
            }
            activeGeofenceNotificationId = Int.MIN_VALUE
            activeGeofenceItemId = ""
            lastActiveMultiCardsJson = ""
            lastNotifiedStatusBarDistance = Int.MIN_VALUE
        }

        private fun acquireTemporaryWakeLock(context: Context, timeoutMs: Long) {
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
                sonarWakeLock?.let { if (it.isHeld) it.release() }
                val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yaad:geofenceSonarWakeLock")
                wl.setReferenceCounted(false)
                wl.acquire(timeoutMs)
                sonarWakeLock = wl
            } catch (e: Exception) {
            }
        }

        private fun synthesizeSonarPingPcm(dist: Int, rad: Int, sampleRate: Int = 24000, mode: String = "enter"): ShortArray {
            val safeRad = rad.coerceAtLeast(1)
            val currentIntervalMs = computeSonarIntervalMs(dist, safeRad, mode)
            val is5Hz = currentIntervalMs <= 200L
            val isExitMode = mode == "exit" || mode == "both_exit"
            val pingDurationSec = if (is5Hz) 0.14 else 0.44
            val numSamples = (sampleRate * pingDurationSec).toInt()
            val pcmBuffer = ShortArray(numSamples)

            val baseFreq = if (isExitMode) {
                if (is5Hz) 780.0 else 680.0
            } else {
                if (is5Hz) 1540.0 else 1380.0
            }
            val harmonicRatio = if (isExitMode) 0.5 else 1.5
            val echoDelaySamples = ((if (is5Hz) 0.055 else 0.13) * sampleRate).toInt()
            val decayRate = if (is5Hz) 24.0 else 10.0

            for (i in 0 until numSamples) {
                val timeSec = i.toDouble() / sampleRate.toDouble()
                val attack1 = (timeSec / (if (is5Hz) 0.004 else 0.008)).coerceIn(0.0, 1.0)
                val env1 = attack1 * exp(-timeSec * decayRate)
                val sig1 = sin(2.0 * PI * baseFreq * timeSec) * 0.72 +
                    sin(2.0 * PI * (baseFreq * harmonicRatio) * timeSec) * (if (isExitMode) 0.24 else 0.16)

                var sig2 = 0.0
                if (i >= echoDelaySamples) {
                    val echoTime = (i - echoDelaySamples).toDouble() / sampleRate.toDouble()
                    val attack2 = (echoTime / 0.006).coerceIn(0.0, 1.0)
                    val env2 = attack2 * exp(-echoTime * (decayRate * 1.1)) * 0.36
                    sig2 = sin(2.0 * PI * (baseFreq * 0.992) * echoTime) * env2
                }

                val combined = ((sig1 * env1) + sig2).coerceIn(-0.98, 0.98)
                pcmBuffer[i] = (combined * Short.MAX_VALUE).toInt().toShort()
            }
            return pcmBuffer
        }

        fun playSingleSubmarineSonarPing(distanceMeters: Int, radiusMeters: Int) {
            if (geofenceAudioMuted || sonarPausedByPhoneCall) return
            Thread {
                try {
                    if (geofenceAudioMuted || sonarPausedByPhoneCall) return@Thread
                    val sampleRate = 24000
                    val pcm = synthesizeSonarPingPcm(distanceMeters, radiusMeters, sampleRate, liveSonarMode)
                    playPcmBufferOnce(pcm, sampleRate)
                } catch (e: Exception) {
                }
            }.apply {
                isDaemon = true
                start()
            }
        }

        fun startNativeSubmarineSonarLoop(
            context: Context,
            initialDistance: Int,
            radius: Int,
            notificationId: Int,
            mode: String = "enter"
        ) {
            if (geofenceAudioMuted || YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(context)) {
                if (YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(context)) {
                    sonarPausedByPhoneCall = true
                }
                return
            }
            sonarPausedByPhoneCall = false
            val savedItemId = activeGeofenceItemId
            stopGeofenceAudio(context)
            activeGeofenceItemId = savedItemId
            liveSonarDistanceMeters = initialDistance
            liveSonarRadiusMeters = radius.coerceAtLeast(1)
            liveSonarMode = mode
            activeGeofenceNotificationId = notificationId
            sonarLoopActive = true
            acquireTemporaryWakeLock(context, 15 * 60_000L)

            val appCtx = context.applicationContext
            val t = Thread {
                val sampleRate = 24000
                while (sonarLoopActive && !geofenceAudioMuted && !sonarPausedByPhoneCall) {
                    if (YaadAlarmPopupActivity.isPhoneCallActiveOrRinging(appCtx)) {
                        sonarPausedByPhoneCall = true
                        break
                    }
                    var pingDurationMs = 450L
                    try {
                        val dist = liveSonarDistanceMeters
                        val rad = liveSonarRadiusMeters.coerceAtLeast(1)
                        val curMode = liveSonarMode
                        val pcmBuffer = synthesizeSonarPingPcm(dist, rad, sampleRate, curMode)
                        pingDurationMs = ((pcmBuffer.size.toLong() * 1000L) / sampleRate.toLong()) + 20L
                        if (!geofenceAudioMuted && !sonarPausedByPhoneCall) {
                            playPcmBufferOnce(pcmBuffer, sampleRate)
                        }
                    } catch (ie: InterruptedException) {
                        break
                    } catch (e: Exception) {
                    }

                    var sleptMs = pingDurationMs
                    while (sonarLoopActive && !geofenceAudioMuted && !sonarPausedByPhoneCall) {
                        val targetWaitMs = computeSonarIntervalMs(liveSonarDistanceMeters, liveSonarRadiusMeters, liveSonarMode)
                        if (sleptMs >= targetWaitMs) break
                        try {
                            Thread.sleep(20L)
                            sleptMs += 20L
                        } catch (ie: InterruptedException) {
                            break
                        }
                    }
                }
                sonarLoopActive = false
            }.apply {
                name = "yaad-submarine-sonar"
                isDaemon = true
                start()
            }
            sonarThread = t
        }

        private fun playPcmBufferOnce(pcmBuffer: ShortArray, sampleRate: Int) {
            if (geofenceAudioMuted || sonarPausedByPhoneCall) return
            var track: AudioTrack? = null
            try {
                val byteSize = pcmBuffer.size * 2
                track = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    AudioTrack.Builder()
                        .setAudioAttributes(
                            AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build()
                        )
                        .setAudioFormat(
                            AudioFormat.Builder()
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setSampleRate(sampleRate)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .build()
                        )
                        .setBufferSizeInBytes(byteSize)
                        .setTransferMode(AudioTrack.MODE_STATIC)
                        .build()
                } else {
                    @Suppress("DEPRECATION")
                    AudioTrack(
                        AudioManager.STREAM_NOTIFICATION,
                        sampleRate,
                        AudioFormat.CHANNEL_OUT_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        byteSize,
                        AudioTrack.MODE_STATIC
                    )
                }
                track.write(pcmBuffer, 0, pcmBuffer.size)
                track.play()
                val durationMs = ((pcmBuffer.size.toLong() * 1000L) / sampleRate.toLong()) + 25L
                Thread.sleep(durationMs)
            } catch (e: Exception) {
            } finally {
                try {
                    track?.stop()
                } catch (e: Exception) {
                }
                try {
                    track?.release()
                } catch (e: Exception) {
                }
            }
        }

        fun hasLocationPermission(context: Context): Boolean {
            val fine = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            val coarse = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            return fine || coarse
        }

        fun shouldRun(context: Context): Boolean {
            return try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val enabled = prefs.getBoolean(KEY_ENABLED, false)
                val raw = prefs.getString(KEY_ITEMS_JSON, "[]") ?: "[]"
                enabled && JSONArray(raw).length() > 0
            } catch (e: Exception) {
                false
            }
        }

        fun updateConfigAndSyncService(context: Context, payloadJson: String) {
            try {
                val obj = JSONObject(payloadJson)
                val enabled = obj.optBoolean("enabled", false)
                val lang = obj.optString("language", "fa")
                val itemsArr = obj.optJSONArray("items") ?: JSONArray()
                val lastPosObj = obj.optJSONObject("lastPosition")

                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val oldItemsRaw = prefs.getString(KEY_ITEMS_JSON, "[]") ?: "[]"
                val oldMap = HashMap<String, String>()
                try {
                    val oldArr = JSONArray(oldItemsRaw)
                    for (i in 0 until oldArr.length()) {
                        val o = oldArr.optJSONObject(i) ?: continue
                        val oid = o.optString("id", "")
                        if (oid.isNotEmpty()) {
                            oldMap[oid] = "\${o.optInt("radius", 200)}_\${o.optString("triggerOn", "enter")}_\${o.optDouble("latitude", 0.0)}_\${o.optDouble("longitude", 0.0)}_\${o.optString("title", "")}_\${o.optString("description", "")}_\${o.optString("customMessage", "")}"
                        }
                    }
                } catch (e: Exception) {
                }

                val editor = prefs.edit()
                if (lastPosObj != null) {
                    val syncLat = lastPosObj.optDouble("latitude", Double.NaN)
                    val syncLon = lastPosObj.optDouble("longitude", Double.NaN)
                    if (!syncLat.isNaN() && !syncLon.isNaN()) {
                        val syncAcc = lastPosObj.optDouble("accuracy", 20.0).toFloat()
                        val syncTime = lastPosObj.optLong("timestamp", System.currentTimeMillis())
                        editor.putLong(KEY_LAST_SYNCED_LAT_BITS, java.lang.Double.doubleToRawLongBits(syncLat))
                        editor.putLong(KEY_LAST_SYNCED_LON_BITS, java.lang.Double.doubleToRawLongBits(syncLon))
                        editor.putFloat(KEY_LAST_SYNCED_ACC, syncAcc)
                        editor.putLong(KEY_LAST_SYNCED_TIME, syncTime)
                    }
                }

                var activeItemStillPresent = false
                for (i in 0 until itemsArr.length()) {
                    val n = itemsArr.optJSONObject(i) ?: continue
                    val nid = n.optString("id", "")
                    if (nid.isEmpty()) continue
                    val sig = "\${n.optInt("radius", 200)}_\${n.optString("triggerOn", "enter")}_\${n.optDouble("latitude", 0.0)}_\${n.optDouble("longitude", 0.0)}_\${n.optString("title", "")}_\${n.optString("description", "")}_\${n.optString("customMessage", "")}"
                    if (!oldMap.containsKey(nid) || oldMap[nid] != sig) {
                        val cleanNid = nid.removePrefix("loc_").removePrefix("rem_")
                        for (sfx in listOf(nid, cleanNid, "loc_\$cleanNid", "rem_\$cleanNid")) {
                            distanceHistoryMap.remove(sfx)
                            lastMoveRefDistMap.remove(sfx)
                            lastInwardMoveTimeMap.remove(sfx)
                            lastOutwardMoveTimeMap.remove(sfx)
                            minDistInsideMap.remove(sfx)
                            maxDistApproachMap.remove(sfx)
                            startedOutsideMap.remove(sfx)
                            outsideSampleCountMap.remove(sfx)
                            insideSampleCountMap.remove(sfx)
                            exitAntiBounceUntilMap.remove(sfx)
                            exitOscillationCountMap.remove(sfx)
                            exitOutwardSampleCountMap.remove(sfx)
                            fivePctInsideSampleCountMap.remove(sfx)
                            wasInFivePctForExitMap.remove(sfx)
                            lastExitAlertEmittedTimeMap.remove(sfx)
                            val prefix = "\${sfx}_"
                            for (k in lastPhaseWakeTimestampMap.keys().toList()) {
                                if (k.startsWith(prefix)) lastPhaseWakeTimestampMap.remove(k)
                            }
                            for (k in wokenAlertPhaseSet.toList()) {
                                if (k.startsWith(prefix)) wokenAlertPhaseSet.remove(k)
                            }
                            editor.remove("inside_\$sfx")
                            editor.remove("armed_exit_\$sfx")
                            editor.remove("sonar_done_\$sfx")
                            editor.remove("u10m_\$sfx")
                            editor.remove("last_trig_\$sfx")
                            editor.remove("last_u10m_trig_\$sfx")
                            editor.remove("five_hz_start_\$sfx")
                            editor.remove("banner_start_\$sfx")
                            editor.remove("banner_text_\$sfx")
                            editor.remove("entry_toast_start_\$sfx")
                            editor.remove("completed_cycle_\$sfx")
                            editor.remove("latched_mode_\$sfx")
                            editor.remove("paused_until_\$sfx")
                            editor.remove("cooldown_until_\$sfx")
                        }
                    }
                    if (nid == activeGeofenceItemId) {
                        activeItemStillPresent = true
                        activeGeofenceTitle = n.optString("title", activeGeofenceTitle)
                        activeGeofenceRadius = n.optInt("radius", activeGeofenceRadius).coerceAtLeast(20)
                        activeGeofenceLat = n.optDouble("latitude", activeGeofenceLat)
                        activeGeofenceLon = n.optDouble("longitude", activeGeofenceLon)
                        liveSonarRadiusMeters = activeGeofenceRadius
                        lastNotifiedStatusBarDistance = Int.MIN_VALUE
                    }
                }

                if (activeGeofenceItemId.isNotEmpty() && (!enabled || !activeItemStillPresent)) {
                    val oldNotifId = activeGeofenceNotificationId
                    stopGeofenceAudio(context, oldNotifId)
                    YaadAlarmPopupActivity.dismissIfMatching(oldNotifId)
                }

                editor
                    .putBoolean(KEY_ENABLED, enabled && itemsArr.length() > 0)
                    .putString(KEY_LANGUAGE, lang)
                    .putString(KEY_ITEMS_JSON, itemsArr.toString())
                    .apply()

                ensureServiceState(context)
            } catch (e: Exception) {
            }
        }

        fun ensureServiceState(context: Context) {
            try {
                val appCtx = context.applicationContext
                if (LocalNotificationsPlugin.isAppInForeground(appCtx) && !isScreenOffOrLockedStatic(appCtx) && activeGeofenceNotificationId != Int.MIN_VALUE) {
                    try {
                        NotificationManagerCompat.from(appCtx).cancel(activeGeofenceNotificationId)
                    } catch (e: Exception) {
                    }
                }
                val serviceIntent = Intent(appCtx, YaadGeofenceService::class.java)
                if (shouldRun(appCtx) && hasLocationPermission(appCtx)) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ContextCompat.startForegroundService(appCtx, serviceIntent)
                    } else {
                        appCtx.startService(serviceIntent)
                    }
                } else {
                    stopGeofenceAudio(appCtx)
                    cancelGpsDisabledWarningNotification(appCtx)
                    appCtx.stopService(serviceIntent)
                }
            } catch (e: Exception) {
            }
        }
    }

    class JsBridge(private val appContext: Context) {
        @android.webkit.JavascriptInterface
        fun syncGeofences(payloadJson: String) {
            updateConfigAndSyncService(appContext, payloadJson)
        }

        @android.webkit.JavascriptInterface
        fun stopGeofenceAlertAudio() {
            stopGeofenceAudio(appContext)
        }

        @android.webkit.JavascriptInterface
        fun setGeofenceAudioMuted(itemId: String, muted: Boolean) {
            setGeofenceAudioMuteState(appContext, muted)
        }

        @android.webkit.JavascriptInterface
        fun playSonarPing(distanceMeters: Int, radiusMeters: Int) {
            playSingleSubmarineSonarPing(distanceMeters, radiusMeters)
        }

        @android.webkit.JavascriptInterface
        fun consumeStoppedGeofenceItems(): String {
            return consumeQueuedStoppedItems(appContext)
        }

        @android.webkit.JavascriptInterface
        fun consumeRadarDisabledFromBackground(): Boolean {
            return consumeRadarDisabledFromBackground(appContext)
        }

        @android.webkit.JavascriptInterface
        fun acknowledgeGeofenceItem(itemId: String) {
            acknowledgeGeofenceItemForCycle(appContext, itemId)
        }

        @android.webkit.JavascriptInterface
        fun isLocationEnabled(): Boolean {
            return isDeviceLocationEnabled(appContext)
        }

        @android.webkit.JavascriptInterface
        fun openLocationSettings() {
            openDeviceLocationSettings(appContext)
        }

        @android.webkit.JavascriptInterface
        fun resetGeofenceState(itemId: String) {
            resetSavedGeofenceState(appContext, itemId)
        }

        @android.webkit.JavascriptInterface
        fun openGoogleMapsNavigation(lat: Double, lon: Double, label: String) {
            launchGoogleMapsDirections(appContext, lat, lon, label)
        }

        @android.webkit.JavascriptInterface
        fun pauseGeofenceItemTemporarily(itemId: String, durationMs: Long) {
            pauseGeofenceItemTemporarily(appContext, itemId, durationMs)
        }

        @android.webkit.JavascriptInterface
        fun snoozeGeofenceItem(itemId: String, durationMs: Long) {
            snoozeGeofenceItemForPassingThrough(appContext, itemId, durationMs)
        }

        @android.webkit.JavascriptInterface
        fun resumeGeofenceItemFromPause(itemId: String) {
            resumeGeofenceItemFromPause(appContext, itemId)
        }

        @android.webkit.JavascriptInterface
        fun hasBackgroundLocationPermission(): Boolean {
            if (!hasLocationPermission(appContext)) return false
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContextCompat.checkSelfPermission(
                    appContext,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
            } else {
                true
            }
        }

        @android.webkit.JavascriptInterface
        fun openBackgroundLocationSettings() {
            try {
                val intent = Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", appContext.packageName, null)
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                appContext.startActivity(intent)
            } catch (e: Exception) {
                openDeviceLocationSettings(appContext)
            }
        }
    }
}
`;

// 10. Patch plugin AndroidManifest.xml to register YaadAlarmPopupActivity, YaadGeofenceService, LocalNotificationRestoreReceiver, and required permissions
const manifestPath = path.join(pluginRoot, 'android/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifestContent = fs.readFileSync(manifestPath, 'utf8');
  if (!manifestContent.includes('YaadAlarmPopupActivity')) {
    manifestContent = manifestContent.replace(
      '<application>',
      `<application>
        <activity
            android:name="com.capacitorjs.plugins.localnotifications.YaadAlarmPopupActivity"
            android:theme="@android:style/Theme.Translucent.NoTitleBar"
            android:exported="false"
            android:launchMode="singleTop"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:showOnLockScreen="true"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode" />`
    );
  } else if (!manifestContent.includes('android:showWhenLocked="true"')) {
    manifestContent = manifestContent.replace(
      'android:showOnLockScreen="true"',
      'android:showOnLockScreen="true"\n            android:showWhenLocked="true"'
    );
  }
  if (!manifestContent.includes('YaadGeofenceService')) {
    manifestContent = manifestContent.replace(
      '<application>',
      `<application>
        <service
            android:name="com.capacitorjs.plugins.localnotifications.YaadGeofenceService"
            android:enabled="true"
            android:exported="false"
            android:stopWithTask="false"
            android:foregroundServiceType="location" />`
    );
  } else if (!manifestContent.includes('android:stopWithTask="false"')) {
    manifestContent = manifestContent.replace(
      'android:name="com.capacitorjs.plugins.localnotifications.YaadGeofenceService"',
      'android:name="com.capacitorjs.plugins.localnotifications.YaadGeofenceService"\n            android:stopWithTask="false"'
    );
  }
  if (!manifestContent.includes('com.capacitorjs.plugins.localnotifications.RESTART_GEOFENCE_SERVICE')) {
    manifestContent = manifestContent.replace(
      '<action android:name="android.intent.action.BOOT_COMPLETED" />',
      `<action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="com.capacitorjs.plugins.localnotifications.RESTART_GEOFENCE_SERVICE" />
                <action android:name="com.capacitorjs.plugins.localnotifications.ALARM_CLOCK_LAUNCH_POPUP" />`
    );
  } else if (!manifestContent.includes('com.capacitorjs.plugins.localnotifications.ALARM_CLOCK_LAUNCH_POPUP')) {
    manifestContent = manifestContent.replace(
      '<action android:name="com.capacitorjs.plugins.localnotifications.RESTART_GEOFENCE_SERVICE" />',
      `<action android:name="com.capacitorjs.plugins.localnotifications.RESTART_GEOFENCE_SERVICE" />
                <action android:name="com.capacitorjs.plugins.localnotifications.ALARM_CLOCK_LAUNCH_POPUP" />`
    );
  }
  if (!manifestContent.includes('android.permission.USE_FULL_SCREEN_INTENT')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>\n</manifest>`
    );
  }
  if (!manifestContent.includes('android.permission.SYSTEM_ALERT_WINDOW')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>\n</manifest>`
    );
  }
  if (!manifestContent.includes('android.permission.WAKE_LOCK')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.WAKE_LOCK"/>\n    <uses-permission android:name="android.permission.DISABLE_KEYGUARD"/>\n</manifest>`
    );
  }
  if (!manifestContent.includes('android.permission.FOREGROUND_SERVICE')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>\n    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>\n</manifest>`
    );
  }
  if (!manifestContent.includes('android.permission.READ_PHONE_STATE')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.READ_PHONE_STATE"/>\n</manifest>`
    );
  }
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
}

fs.writeFileSync(path.join(pluginDir, 'NotificationAction.kt'), notificationActionContent, 'utf8');
fs.writeFileSync(notificationStoragePath, notificationStorageContent, 'utf8');
fs.writeFileSync(managerPath, managerContent, 'utf8');
fs.writeFileSync(publisherPath, publisherContent, 'utf8');
fs.writeFileSync(channelManagerPath, channelManagerContent, 'utf8');
fs.writeFileSync(path.join(pluginDir, 'NotificationDismissReceiver.kt'), dismissReceiverContent, 'utf8');
fs.writeFileSync(restoreReceiverPath, restoreReceiverContent, 'utf8');
fs.writeFileSync(pluginPath, pluginContent, 'utf8');
fs.writeFileSync(popupActivityPath, popupActivityContent, 'utf8');
fs.writeFileSync(geofenceServicePath, geofenceServiceContent, 'utf8');

// 11. Automated Kotlin Syntax, String Literal & Balanced Delimiter Validator
// Ensures any generated/patched Kotlin file is 100% free of unescaped quotes or mismatched braces before GitHub Actions runs
function validateKotlinFiles(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.kt'));
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const src = fs.readFileSync(fullPath, 'utf8');
    let inString = false;
    let inTripleString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let braceDepth = 0;
    let parenDepth = 0;
    let lineNum = 1;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const next = src[i + 1] || '';
      const next2 = src[i + 2] || '';

      if (ch === '\n') {
        if (inString && !inTripleString) {
          throw new Error(`[KotlinValidator] Unclosed string literal in ${file} at line ${lineNum}`);
        }
        inLineComment = false;
        lineNum++;
        continue;
      }
      if (inLineComment) continue;

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (!inString && !inTripleString) {
        if (ch === '/' && next === '/') {
          inLineComment = true;
          i++;
          continue;
        }
        if (ch === '/' && next === '*') {
          inBlockComment = true;
          i++;
          continue;
        }
        if (ch === '"' && next === '"' && next2 === '"') {
          inTripleString = true;
          i += 2;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "'") {
          // Skip char literal
          i++;
          if (src[i] === '\\') i++;
          if (src[i + 1] === "'") i++;
          continue;
        }
        if (ch === '{') braceDepth++;
        else if (ch === '}') {
          braceDepth--;
          if (braceDepth < 0) {
            throw new Error(`[KotlinValidator] Unexpected closing brace '}' in ${file} at line ${lineNum}`);
          }
        } else if (ch === '(') parenDepth++;
        else if (ch === ')') {
          parenDepth--;
          if (parenDepth < 0) {
            throw new Error(`[KotlinValidator] Unexpected closing paren ')' in ${file} at line ${lineNum}`);
          }
        }
      } else if (inTripleString) {
        if (ch === '"' && next === '"' && next2 === '"') {
          inTripleString = false;
          i += 2;
        }
      } else if (inString) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === '"') {
          inString = false;
          // Check for accidental unescaped quote inside string like "foo "$bar" baz"
          const afterQuote = src.slice(i + 1).match(/^[ \t]*(\$[A-Za-z_])/);
          if (afterQuote) {
            throw new Error(
              `[KotlinValidator] Unescaped quote before ${afterQuote[1]} in ${file} at line ${lineNum}`
            );
          }
        }
      }
    }

    if (braceDepth !== 0) {
      throw new Error(`[KotlinValidator] Unbalanced braces (depth=${braceDepth}) in ${file}`);
    }
    if (parenDepth !== 0) {
      throw new Error(`[KotlinValidator] Unbalanced parentheses (depth=${parenDepth}) in ${file}`);
    }

    // Check property declarations for missing '=' (e.g. `private var foo: Double.NaN` instead of `= Double.NaN`)
    const lines = src.split('\n');
    const isYaadCustomClass = file === 'YaadAlarmPopupActivity.kt' || file === 'YaadGeofenceService.kt';
    for (let idx = 0; idx < lines.length; idx++) {
      const trimmed = lines[idx].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (isYaadCustomClass && /^(?:private|protected|internal)\s+(?:var|val)\s+\w+\s*:\s*[^=]+$/.test(trimmed)) {
        const prevLine = (lines[idx - 1] || '').trim();
        const nextLine = (lines[idx + 1] || '').trim();
        if (
          !trimmed.endsWith(',') &&
          !trimmed.endsWith(')') &&
          !prevLine.endsWith('(') &&
          !prevLine.endsWith(',') &&
          !nextLine.startsWith('=') &&
          !nextLine.startsWith('get(')
        ) {
          throw new Error(
            `[KotlinValidator] Uninitialized class property or missing '=' in ${file} at line ${idx + 1}: "${trimmed}"`
          );
        }
      }
      if (/^(?:(?:private|public|protected|internal)\s+)?(?:var|val)\s+\w+\s*:\s*(?:Double|Float|Int|Long|Boolean)\.[A-Za-z0-9_]+$/.test(trimmed)) {
        throw new Error(
          `[KotlinValidator] Missing '= Type' in property declaration in ${file} at line ${idx + 1}: "${trimmed}"`
        );
      }
    }

    // Verify all commonly used Capacitor / JSON / Android classes and all unqualified PascalCase types are imported
    const importLines = lines.filter((l) => l.trim().startsWith('import ')).join('\n');
    const codeLines = lines
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('import ') && !t.startsWith('//') && !t.startsWith('*');
      })
      .join('\n');
    for (const sym of [
      'JSObject',
      'JSArray',
      'JSONObject',
      'JSONArray',
      'JSONException',
      'CapConfig',
      'Logger',
      'TimeZone',
      'SimpleDateFormat',
      'PowerManager',
      'AlarmManager',
      'PendingIntent',
      'NotificationManagerCompat',
      'Settings',
      'PixelFormat',
    ]) {
      const unqualifiedRegex = new RegExp(`(?<!\\.)\\b${sym}\\b`);
      if (unqualifiedRegex.test(codeLines) && !importLines.includes(sym)) {
        throw new Error(`[KotlinValidator] Missing import for '${sym}' in ${file}`);
      }
    }
  }

  // Full cross-file check for any unimported PascalCase class references
  const packageClasses = new Set([
    'R',
    'BuildConfig',
  ]);
  for (const file of files) {
    const txt = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of txt.matchAll(/\b(?:class|object|interface|enum\s+class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
      packageClasses.add(m[1]);
    }
  }
  const kotlinJavaBuiltins = new Set([
    'Any', 'Unit', 'Boolean', 'Byte', 'Short', 'Int', 'Long', 'Float', 'Double', 'Char', 'String', 'CharSequence',
    'Array', 'IntArray', 'LongArray', 'FloatArray', 'DoubleArray', 'BooleanArray', 'ByteArray', 'ShortArray', 'CharArray',
    'List', 'MutableList', 'ArrayList', 'Map', 'MutableMap', 'HashMap', 'LinkedHashMap', 'Set', 'MutableSet', 'HashSet', 'LinkedHashSet',
    'Pair', 'Triple', 'Regex', 'Exception', 'RuntimeException', 'IllegalArgumentException', 'IllegalStateException',
    'SecurityException', 'InterruptedException', 'NumberFormatException', 'ClassCastException', 'NullPointerException',
    'IndexOutOfBoundsException', 'UnsupportedOperationException', 'Throwable', 'Error', 'Number', 'Comparable',
    'Iterable', 'Iterator', 'Collection', 'System', 'Math', 'Thread', 'Runnable', 'StringBuilder', 'Object', 'Class',
    'Integer', 'Volatile', 'Synchronized', 'Suppress', 'Deprecated', 'JvmStatic', 'JvmOverloads', 'Override', 'Throws', 'RegexOption',
  ]);
  for (const file of files) {
    const txt = fs.readFileSync(path.join(dir, file), 'utf8');
    const imports = new Set();
    for (const m of txt.matchAll(/^import\s+[\w.]+\.([A-Z][A-Za-z0-9_]*)/gm)) {
      imports.add(m[1]);
    }
    const localTypes = new Set();
    for (const m of txt.matchAll(/\b(?:class|object|interface|enum\s+class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
      localTypes.add(m[1]);
    }
    // Strip comments and string literals using a state machine so "://" inside strings is never treated as a comment
    let out = '';
    let sInStr = false;
    let sInTriple = false;
    let sInLine = false;
    let sInBlock = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      const n1 = txt[i + 1] || '';
      const n2 = txt[i + 2] || '';
      if (c === '\n') {
        sInLine = false;
        out += '\n';
        continue;
      }
      if (sInLine) continue;
      if (sInBlock) {
        if (c === '*' && n1 === '/') {
          sInBlock = false;
          i++;
        }
        continue;
      }
      if (!sInStr && !sInTriple) {
        if (c === '/' && n1 === '/') {
          sInLine = true;
          i++;
          continue;
        }
        if (c === '/' && n1 === '*') {
          sInBlock = true;
          i++;
          continue;
        }
        if (c === '"' && n1 === '"' && n2 === '"') {
          sInTriple = true;
          i += 2;
          out += '""';
          continue;
        }
        if (c === '"') {
          sInStr = true;
          out += '""';
          continue;
        }
        if (c === "'") {
          i++;
          if (txt[i] === '\\') i++;
          if (txt[i + 1] === "'") i++;
          out += "''";
          continue;
        }
        out += c;
      } else if (sInTriple) {
        if (c === '"' && n1 === '"' && n2 === '"') {
          sInTriple = false;
          i += 2;
        }
      } else if (sInStr) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === '"') {
          sInStr = false;
        }
      }
    }
    for (const m of out.matchAll(/(?<![.\w])([A-Z][a-z][A-Za-z0-9_]*)\b/g)) {
      const id = m[1];
      if (!imports.has(id) && !packageClasses.has(id) && !localTypes.has(id) && !kotlinJavaBuiltins.has(id)) {
        throw new Error(`[KotlinValidator] Unresolved/unimported class reference '${id}' in ${file}`);
      }
    }
  }
}

validateKotlinFiles(pluginDir);

console.log(
  `[patch-capacitor-notifications] Successfully patched and verified @capacitor/local-notifications@${pluginVersion} (with YaadAlarmPopupActivity, YaadGeofenceService & Kotlin syntax check).`
);

