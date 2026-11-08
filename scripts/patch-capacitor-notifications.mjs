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
  'mBuilder.setFullScreenIntent(fullScreenPendingIntent, true)',
  [legacyBuildNotifV2, legacyBuildNotifV3, legacyBuildNotifV1]
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
                        YaadAlarmPopupActivity.launch(context, it, localNotification.source)
                    }
                }
            }`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'scheduleMuteAfterOneMinute and YaadAlarmPopupActivity on immediate notify',
  origImmediateNotify,
  patchedImmediateNotify,
  'if (!LocalNotificationsPlugin.isAppInForeground(context)) {\n                        YaadAlarmPopupActivity.launch(context, it, localNotification.source)\n                    }',
  [legacyImmediateNotifyV1, legacyImmediateNotifyV2, legacyImmediateNotifyV3]
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

const patchedOpenIntent = `        // Open intent: tapping the notification body opens the app directly to the Reminders Timeline (DEFAULT_PRESS_ACTION = "tap")
        val intent = buildIntent(localNotification, DEFAULT_PRESS_ACTION)
        var flags = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        val pendingIntent = PendingIntent.getActivity(context, id, intent, flags)
        mBuilder.setContentIntent(pendingIntent)`;

managerContent = applyPatchOrVerify(
  managerContent,
  'LocalNotificationManager.kt',
  'createActionIntents body tap opens Reminders Timeline',
  origOpenIntent,
  patchedOpenIntent,
  '// Open intent: tapping the notification body opens the app directly to the Reminders Timeline',
  [legacyNoopOpenIntent]
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

        // Ignore stale notifications whose scheduled 'at' timestamp is more than 15 minutes in the past
        try {
            val scheduleObj = notificationJson.getJSObject("schedule")
            val atStr = scheduleObj?.getString("at")
            if (!atStr.isNullOrEmpty()) {
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                val atDate = sdf.parse(atStr)
                if (atDate != null && (System.currentTimeMillis() - atDate.time) > 15 * 60 * 1000L) {
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
        }

        // Prevent stacking multiple insistent notifications & overlapping audio streams for the same reminder
        val reminderId = notificationJson?.optJSONObject("extra")?.optString("reminderId", "") ?: ""
        if (reminderId.isNotEmpty() && id != Int.MIN_VALUE) {
            cancelPreviousActiveNotificationsForReminder(storage, notificationManager, id, reminderId)
        }

        // Always emit the Android notification so the out-of-app notification audio plays whether the app is open or closed;
        // only launch the standalone native popup card when the app is NOT in the foreground (since in-app AlarmModal shows visually when open).
        LocalNotificationsPlugin.fireReceived(notificationJson)
        notificationManager.notify(id, notification)
        if (id != Int.MIN_VALUE && (notification.flags and Notification.FLAG_INSISTENT) != 0) {
            scheduleMuteAfterOneMinute(context, id, notificationJson.toString())
            if (!LocalNotificationsPlugin.isAppInForeground(context)) {
                YaadAlarmPopupActivity.launch(context, id, notificationJson.toString())
            }
        }
        rescheduleNotificationIfNeeded(context, intent, id)
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
            val baseId = if (hash == 0) 1 else hash
            relatedIds.add(baseId)
            for (index in 0 until 25) {
                val repeatId = ((baseId.toLong() + 1000L + index.toLong() + 1L) % 2147483647L).toInt()
                relatedIds.add(repeatId)
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
            alarmManager.setExact(AlarmManager.RTC, trigger, pendingIntent)
        } else {
            if (wantsExact) {
                Logger.warn("Capacitor/LocalNotification", "Exact alarms not allowed in user settings.  Notification scheduled with non-exact alarm.")
            }
            alarmManager.set(AlarmManager.RTC, trigger, pendingIntent)
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

        // After 1 minute of continuous alarm ringing without user reaction, silence the alarm audio, close the 1-minute popup card,
        // keep the silent notification pinned at the TOP of the dropdown shade, advance the reminder to +15m in the future,
        // and ensure the 1-minute alarm repeats every 15 minutes until the user reacts.
        if (actionId == "mute_after_1m") {
            YaadAlarmPopupActivity.dismissIfMatching(intExtra)
            LocalNotificationsPlugin.stopActiveMediaPlayer()
            try {
                val sysNotifManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                var isStillActive = false
                if (sysNotifManager != null) {
                    for (active in sysNotifManager.activeNotifications) {
                        if (active.id == intExtra) {
                            isStillActive = true
                            break
                        }
                    }
                }
                if (!isStillActive) return

                val savedJson = storage.getSavedNotificationAsJSObject(intExtra.toString()) ?: requestJson
                if (savedJson != null) {
                    val originalChannelId = savedJson.optString("channelId", "yaad_reminders_channel_v3")
                    val originalSound = savedJson.optString("sound", "digital_beep.wav")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && sysNotifManager != null) {
                        if (sysNotifManager.getNotificationChannel("yaad_channel_v3_silent") == null) {
                            val silentChannel = NotificationChannel(
                                "yaad_channel_v3_silent",
                                "YAAD Top Persistent",
                                NotificationManager.IMPORTANCE_HIGH
                            )
                            silentChannel.setSound(null, null)
                            silentChannel.enableVibration(false)
                            sysNotifManager.createNotificationChannel(silentChannel)
                        }
                    }
                    val silentJson = JSObject(savedJson.toString())
                    silentJson.remove("schedule")
                    silentJson.remove("sound")
                    silentJson.put("channelId", "yaad_channel_v3_silent")
                    val localNotif = LocalNotification.buildNotificationFromJSObject(silentJson)
                    val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                    manager.schedule(null, listOf(localNotif))
                    storage.appendNotifications(listOf(localNotif))

                    // Ensure a 15-minute repeat alarm is scheduled if no future repeat for this reminder is already pending
                    val nowMs = System.currentTimeMillis()
                    var futureRepeatMs = nowMs + 15L * 60L * 1000L
                    var hasFutureRepeat = false
                    if (reminderId.isNotEmpty()) {
                        val sdfParse = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                        sdfParse.timeZone = java.util.TimeZone.getTimeZone("UTC")
                        for (savedIdStr in storage.getSavedNotificationIds()) {
                            val sId = savedIdStr.toIntOrNull() ?: continue
                            if (sId == intExtra) continue
                            val sJson = storage.getSavedNotificationAsJSObject(savedIdStr) ?: continue
                            val sRemId = sJson.optJSONObject("extra")?.optString("reminderId", "") ?: ""
                            if (sRemId == reminderId) {
                                val atStr = sJson.optJSONObject("schedule")?.optString("at", "") ?: ""
                                if (atStr.isNotEmpty()) {
                                    val atDate = try { sdfParse.parse(atStr) } catch (e: Exception) { null }
                                    if (atDate != null && atDate.time > nowMs) {
                                        hasFutureRepeat = true
                                        futureRepeatMs = atDate.time
                                        break
                                    }
                                }
                            }
                        }
                    }
                    if (!hasFutureRepeat) {
                        val nextRepeatAtMs = nowMs + 15L * 60L * 1000L
                        futureRepeatMs = nextRepeatAtMs
                        val repeatJson = JSObject(savedJson.toString())
                        val repeatId = if (reminderId.isNotEmpty()) {
                            ((computeBaseId(reminderId).toLong() + 1001L) % 2147483647L).toInt()
                        } else {
                            ((intExtra.toLong() + 1001L) % 2147483647L).toInt()
                        }
                        repeatJson.put("id", repeatId)
                        if (originalChannelId.isNotEmpty() && originalChannelId != "yaad_channel_v3_silent" && originalChannelId != "yaad_channel_v2_silent") {
                            repeatJson.put("channelId", originalChannelId)
                        } else {
                            repeatJson.put("channelId", "yaad_reminders_channel_v3")
                        }
                        if (originalSound.isNotEmpty()) {
                            repeatJson.put("sound", originalSound)
                        }
                        val sdfOut = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                        sdfOut.timeZone = java.util.TimeZone.getTimeZone("UTC")
                        val schedObj = JSObject()
                        schedObj.put("at", sdfOut.format(Date(nextRepeatAtMs)))
                        schedObj.put("allowWhileIdle", true)
                        repeatJson.put("schedule", schedObj)
                        val repeatNotif = LocalNotification.buildNotificationFromJSObject(repeatJson)
                        manager.schedule(null, listOf(repeatNotif))
                        storage.appendNotifications(listOf(repeatNotif))
                    }

                    // Notify or queue "mute_after_1m" action so the app advances this reminder to futureRepeatMs (+15m after NOW) in the timeline
                    // and treats it like a future reminder (never triggering the in-app alarm modal when the app is opened)
                    val muteActionJson = JSObject()
                    muteActionJson.put("actionId", "mute_after_1m")
                    muteActionJson.put("actionTimestamp", nowMs)
                    muteActionJson.put("snoozedUntil", futureRepeatMs)
                    muteActionJson.put("notification", savedJson)
                    val dispatchedLive = LocalNotificationsPlugin.fireActionPerformed(muteActionJson)
                    if (!dispatchedLive) {
                        LocalNotificationsPlugin.queueBackgroundAction(context, muteActionJson)
                    }
                }
            } catch (e: Exception) {
                Logger.error(Logger.tags("LN"), "Failed to mute notification after 1 minute", e)
            }
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
        return if (hash == 0) 1 else hash
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

        // Also compute deterministic baseId and 25 repeat IDs if reminderId is present
        if (reminderId.isNotEmpty()) {
            val baseId = computeBaseId(reminderId)
            idsToCancel.add(baseId)
            for (index in 0 until 25) {
                val repeatId = ((baseId.toLong() + 1000L + index.toLong() + 1L) % 2147483647L).toInt()
                idsToCancel.add(repeatId)
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

const patchedPluginLoad = `        // YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge v2
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
  '// YAAD clean foreground state, WebView configuration & Out-of-App Geofence Bridge v2',
  [legacyPluginLoad, legacyPluginLoadV2, legacyPluginLoadV3, legacyPluginLoadV4, legacyPluginLoadV5, legacyPluginLoadV6, legacyPluginLoadV7, legacyPluginLoadV8, legacyPluginLoadV9, legacyPluginLoadV10, legacyPluginLoadV11]
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
        if (Intent.ACTION_MAIN != data.action) {
            return
        }
        if (data.hasExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY)) {
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

const patchedCompanionFire = `        private const val BG_ACTION_PREFS = "YAAD_BG_NOTIFICATION_ACTIONS"
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

pluginContent = applyPatchOrVerify(
  pluginContent,
  'LocalNotificationsPlugin.kt',
  'companion isAppInForeground, stopActiveMediaPlayer, fireActionPerformed, and deduplicated queueBackgroundAction',
  origCompanionFire,
  patchedCompanionFire,
  'if (!isAppInForegroundState && !act.hasWindowFocus()) return false',
  [legacyCompanionFire, legacyCompanionFireV2, legacyCompanionFireV3, legacyCompanionFireV4, legacyCompanionFireV5, legacyCompanionFireV6]
);

// 8. Create standalone YaadAlarmPopupActivity.kt (Out-of-app minimal theme-matched 1-minute notification card)
const popupActivityPath = path.join(pluginDir, 'YaadAlarmPopupActivity.kt');
const popupActivityContent = `package com.capacitorjs.plugins.localnotifications

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
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
import com.getcapacitor.JSObject
import java.lang.ref.WeakReference

/**
 * Standalone out-of-app minimal notification card that displays for 1 minute alongside the alarm
 * without opening the main YAAD app (unless the user explicitly clicks the "Edit" / "Open" button).
 * Supports both standard Reminders and distinct Submarine Radar Geofence alerts (with pulsing GPS logo).
 */
class YaadAlarmPopupActivity : Activity() {

    private var notificationId: Int = Int.MIN_VALUE
    private var sourceJson: String? = null
    private var requestJson: JSObject? = null
    private var countDownTimer: CountDownTimer? = null
    private var progressFillView: View? = null
    private var progressTrackView: FrameLayout? = null
    private var timerTextView: TextView? = null
    private var distanceBadgeTextView: TextView? = null
    private var isPersian: Boolean = true
    private var isGeofencePopup: Boolean = false
    private var isSub10mArrival: Boolean = false
    private var sonarRingAnimator: ObjectAnimator? = null
    private var gpsPinPulseAnimator: ObjectAnimator? = null

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

    private inner class GpsPinBadgeView(context: Context, private val badgeBgColor: Int) : View(context) {
        private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = badgeBgColor
        }
        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = dp(1.8f).toFloat()
            color = Color.parseColor("#04231F")
        }
        private val pinPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.WHITE
        }
        private val holePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = badgeBgColor
        }
        private val pinPath = Path()

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            val cx = w / 2f
            val cy = h / 2f
            val r = (w.coerceAtMost(h) / 2f) - dp(1f)

            canvas.drawCircle(cx, cy, r, bgPaint)
            canvas.drawCircle(cx, cy, r, strokePaint)

            // Draw crisp vector GPS Pin inside the circular badge
            val headR = r * 0.42f
            val headCy = cy - r * 0.14f
            val tipY = cy + r * 0.56f

            pinPath.reset()
            pinPath.addCircle(cx, headCy, headR, Path.Direction.CW)
            pinPath.moveTo(cx - headR * 0.86f, headCy + headR * 0.45f)
            pinPath.lineTo(cx, tipY)
            pinPath.lineTo(cx + headR * 0.86f, headCy + headR * 0.45f)
            pinPath.close()
            canvas.drawPath(pinPath, pinPaint)

            // Inner GPS pin dot
            canvas.drawCircle(cx, headCy, headR * 0.42f, holePaint)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DIM_BEHIND
        )
        window.setDimAmount(0.55f)
        setFinishOnTouchOutside(false)
        volumeControlStream = android.media.AudioManager.STREAM_NOTIFICATION

        activeInstance = WeakReference(this)
        bindFromIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            bindFromIntent(intent)
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
                editBtnBorder = Color.parseColor("#06B6D4"),
                editBtnText = Color.parseColor("#67E8F9")
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
        val distText = if (isPersian) toPersianDigits(distanceMeters.toString()) else distanceMeters.toString()
        return if (sub10m) {
            if (isPersian) "🎯 در نقطه مقصد (فاصله: \$distText متر • زیر ۱۰ متر)" else "🎯 At Target (\$distText m • < 10m)"
        } else {
            if (isPersian) "📡 فاصله فعلی: \$distText متر • ریتم سونار تطبیقی" else "📡 Distance: \$distText m • Adaptive Sonar"
        }
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
        val initialDistance = extraObj?.optInt("distance", -1) ?: -1

        val rawTitle = requestJson?.getString("title") ?: (if (isPersian) "یادآور" else "Reminder")
        val cleanTitle = rawTitle
            .replaceFirst("🔔 یادآور: ", "")
            .replaceFirst("یادآور: ", "")
            .replaceFirst("🔔 ", "")
            .replaceFirst("📍 اعلام حصار مکانی: ", "")
            .replaceFirst("📍 رادار حصار مکانی: ", "")
            .replaceFirst("🎯 مقصد ثبت‌شده: ", "")
            .replaceFirst("🎯 ", "")
            .replaceFirst("📍 ", "")
            .trim()
        val bodyText = requestJson?.getString("body") ?: ""

        val effectiveTheme = if (isGeofencePopup) {
            if (isSub10mArrival) "geofence-sub10m" else "geofence-radar"
        } else {
            themeName
        }
        val palette = resolvePalette(effectiveTheme)
        buildMinimalCardUI(palette, cleanTitle, bodyText, initialDistance)
        startOneMinuteCountdown()
    }

    private fun stopPulseAnimators() {
        try {
            sonarRingAnimator?.cancel()
            sonarRingAnimator = null
            gpsPinPulseAnimator?.cancel()
            gpsPinPulseAnimator = null
        } catch (e: Exception) {
        }
    }

    private fun buildMinimalCardUI(palette: ThemePalette, titleStr: String, bodyStr: String, initialDistance: Int) {
        stopPulseAnimators()

        val root = FrameLayout(this)
        root.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        root.setPadding(dp(16f), dp(36f), dp(16f), dp(16f))

        val cardContainer = LinearLayout(this)
        cardContainer.orientation = LinearLayout.VERTICAL
        cardContainer.layoutDirection = if (isPersian) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        cardContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, if (isGeofencePopup) 2.2f else 1.8f, 24f)
        cardContainer.elevation = dp(18f).toFloat()

        val cardParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        cardParams.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        cardContainer.layoutParams = cardParams

        // 1. Minimal 60s top progress bar inside card
        val track = FrameLayout(this)
        val trackParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(4f)
        )
        trackParams.setMargins(dp(18f), dp(12f), dp(18f), 0)
        track.layoutParams = trackParams
        track.background = makeRoundedDrawable(Color.argb(45, 128, 128, 128), Color.TRANSPARENT, 0f, 2f)

        val fill = View(this)
        val fillParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        fill.layoutParams = fillParams
        fill.background = makeRoundedDrawable(palette.accentColor, Color.TRANSPARENT, 0f, 2f)
        track.addView(fill)
        progressTrackView = track
        progressFillView = fill
        cardContainer.addView(track)

        // Inner content container
        val content = LinearLayout(this)
        content.orientation = LinearLayout.VERTICAL
        content.setPadding(dp(18f), dp(14f), dp(18f), dp(18f))

        // Header row: Official App Icon (or Radar Pulsing GPS Logo Emblem for Geofence) + Brand label + close button
        val headerRow = LinearLayout(this)
        headerRow.orientation = LinearLayout.HORIZONTAL
        headerRow.gravity = Gravity.CENTER_VERTICAL

        if (isGeofencePopup) {
            // Distinct Geofence Radar Emblem: App Logo + Expanding Sonar Ring + Pulsing GPS Pin Symbol
            val emblemSize = dp(50f)
            val emblemFrame = FrameLayout(this)
            val emblemParams = LinearLayout.LayoutParams(emblemSize, emblemSize)
            if (isPersian) {
                emblemParams.leftMargin = dp(10f)
            } else {
                emblemParams.rightMargin = dp(10f)
            }
            emblemFrame.layoutParams = emblemParams
            emblemFrame.clipChildren = false
            emblemFrame.clipToPadding = false

            // Expanding Sonar Wave Ring behind App Logo
            val sonarRing = View(this)
            val ringSize = dp(40f)
            val ringParams = FrameLayout.LayoutParams(ringSize, ringSize, Gravity.CENTER)
            sonarRing.layoutParams = ringParams
            sonarRing.background = makeOvalDrawable(
                Color.argb(35, 16, 185, 129),
                palette.accentColor,
                1.5f
            )
            emblemFrame.addView(sonarRing)

            // App Logo Container
            val logoBoxSize = dp(38f)
            val logoBox = FrameLayout(this)
            logoBox.layoutParams = FrameLayout.LayoutParams(logoBoxSize, logoBoxSize, Gravity.CENTER)
            logoBox.background = makeRoundedDrawable(
                Color.parseColor("#063B32"),
                palette.accentColor,
                1.5f,
                12f
            )
            try {
                val appIconView = android.widget.ImageView(this)
                val appDrawable = packageManager.getApplicationIcon(applicationInfo)
                appIconView.setImageDrawable(appDrawable)
                appIconView.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                val innerIconSize = dp(28f)
                appIconView.layoutParams = FrameLayout.LayoutParams(innerIconSize, innerIconSize, Gravity.CENTER)
                logoBox.addView(appIconView)
            } catch (e: Exception) {
            }
            emblemFrame.addView(logoBox)

            // Pulsing GPS Pin Badge on top-right corner of the App Logo
            val pinBadgeSize = dp(20f)
            val pinBadge = GpsPinBadgeView(
                this,
                if (isSub10mArrival) Color.parseColor("#059669") else Color.parseColor("#10B981")
            )
            val pinParams = FrameLayout.LayoutParams(
                pinBadgeSize,
                pinBadgeSize,
                Gravity.TOP or Gravity.RIGHT
            )
            pinBadge.layoutParams = pinParams
            pinBadge.elevation = dp(4f).toFloat()
            emblemFrame.addView(pinBadge)

            // Start continuous animations for Sonar Ring and Pulsing GPS Pin
            sonarRingAnimator = ObjectAnimator.ofPropertyValuesHolder(
                sonarRing,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 0.92f, 1.38f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.92f, 1.38f),
                PropertyValuesHolder.ofFloat(View.ALPHA, 0.85f, 0.0f)
            ).apply {
                duration = 1400L
                repeatCount = ValueAnimator.INFINITE
                repeatMode = ValueAnimator.RESTART
                interpolator = AccelerateDecelerateInterpolator()
                start()
            }

            gpsPinPulseAnimator = ObjectAnimator.ofPropertyValuesHolder(
                pinBadge,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 1.0f, 1.35f, 0.94f, 1.24f, 1.0f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.0f, 1.35f, 0.94f, 1.24f, 1.0f)
            ).apply {
                duration = 1150L
                repeatCount = ValueAnimator.INFINITE
                repeatMode = ValueAnimator.RESTART
                interpolator = AccelerateDecelerateInterpolator()
                start()
            }

            headerRow.addView(emblemFrame)
        } else {
            try {
                val appIconView = android.widget.ImageView(this)
                val notifIconResId = resources.getIdentifier("ic_stat_notification", "drawable", packageName)
                if (notifIconResId != 0) {
                    appIconView.setImageResource(notifIconResId)
                } else {
                    val appDrawable = packageManager.getApplicationIcon(applicationInfo)
                    appIconView.setImageDrawable(appDrawable)
                }
                appIconView.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                val iconSize = dp(24f)
                val iconParams = LinearLayout.LayoutParams(iconSize, iconSize)
                if (isPersian) {
                    iconParams.leftMargin = dp(8f)
                } else {
                    iconParams.rightMargin = dp(8f)
                }
                appIconView.layoutParams = iconParams
                headerRow.addView(appIconView)
            } catch (e: Exception) {
            }
        }

        val brandColumn = LinearLayout(this)
        brandColumn.orientation = LinearLayout.VERTICAL
        val brandColParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        brandColumn.layoutParams = brandColParams

        val brandTv = TextView(this)
        brandTv.text = if (isGeofencePopup) {
            if (isSub10mArrival) {
                if (isPersian) "🎯 حضور در مکان ثبت‌شده (زیر ۱۰ متر)" else "🎯 Saved Location Reached (< 10m)"
            } else {
                if (isPersian) "رادار حصار مکانی یاد" else "YAAD Geofence Radar"
            }
        } else {
            if (isPersian) "یادآور هوشمند یاد" else "YAAD Reminder"
        }
        brandTv.setTextColor(palette.accentColor)
        brandTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, if (isGeofencePopup) 13f else 12f)
        brandTv.setTypeface(Typeface.DEFAULT_BOLD)
        brandColumn.addView(brandTv)

        if (isGeofencePopup && initialDistance >= 0) {
            val distTv = TextView(this)
            distTv.text = formatDistanceLabel(initialDistance, isSub10mArrival)
            distTv.setTextColor(palette.mutedColor)
            distTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            val distParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            distParams.topMargin = dp(2f)
            distTv.layoutParams = distParams
            distanceBadgeTextView = distTv
            brandColumn.addView(distTv)
        } else {
            distanceBadgeTextView = null
        }

        headerRow.addView(brandColumn)

        val closeTv = TextView(this)
        closeTv.text = "✕"
        closeTv.setTextColor(palette.mutedColor)
        closeTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        closeTv.setPadding(dp(6f), dp(2f), dp(6f), dp(2f))
        closeTv.setOnClickListener {
            performBackgroundAction("mute_after_1m")
        }
        headerRow.addView(closeTv)
        content.addView(headerRow)

        // Subject (Title) - Distinct larger, extra-bold typography inside a subtle highlighted box
        val titleTv = TextView(this)
        titleTv.text = titleStr
        titleTv.setTextColor(palette.titleColor)
        titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        titleTv.typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        titleTv.maxLines = 2
        titleTv.ellipsize = TextUtils.TruncateAt.END
        titleTv.setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
        titleTv.background = makeRoundedDrawable(
            Color.argb(32, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
            Color.argb(105, Color.red(palette.accentColor), Color.green(palette.accentColor), Color.blue(palette.accentColor)),
            1.2f,
            12f
        )
        val titleParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        titleParams.topMargin = dp(10f)
        titleTv.layoutParams = titleParams
        titleTv.setOnClickListener {
            performTapOpenTimelineAction()
        }
        content.addView(titleTv)

        // Body / Saved Location Content
        if (bodyStr.isNotEmpty()) {
            val bodyTv = TextView(this)
            bodyTv.text = bodyStr
            bodyTv.setTextColor(palette.bodyColor)
            bodyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            bodyTv.typeface = Typeface.DEFAULT
            bodyTv.maxLines = 4
            bodyTv.ellipsize = TextUtils.TruncateAt.END
            val bodyParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            bodyParams.topMargin = dp(8f)
            bodyTv.layoutParams = bodyParams
            bodyTv.setOnClickListener {
                performTapOpenTimelineAction()
            }
            content.addView(bodyTv)
        }

        // Action Buttons Row
        val actionsRow = LinearLayout(this)
        actionsRow.orientation = LinearLayout.HORIZONTAL
        actionsRow.gravity = Gravity.CENTER
        val actionsParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        actionsParams.topMargin = dp(16f)
        actionsRow.layoutParams = actionsParams

        if (isGeofencePopup) {
            val gotItBtn = buildActionButton(
                text = if (isPersian) "✓ متوجه شدم" else "✓ Got It",
                bgColor = palette.doneBtnBg,
                borderColor = Color.TRANSPARENT,
                textColor = palette.doneBtnText,
                strokeDp = 0f
            ) {
                performBackgroundAction("done")
            }

            val muteSonarBtn = buildActionButton(
                text = if (isPersian) "🔇 قطع صدای رادار" else "🔇 Mute Sonar",
                bgColor = palette.secondaryBtnBg,
                borderColor = palette.secondaryBtnBorder,
                textColor = palette.secondaryBtnText,
                strokeDp = 1.2f
            ) {
                performBackgroundAction("mute_after_1m")
            }

            val openAppBtn = buildActionButton(
                text = if (isPersian) "📍 باز کردن اپ" else "📍 Open App",
                bgColor = palette.editBtnBg,
                borderColor = palette.editBtnBorder,
                textColor = palette.editBtnText,
                strokeDp = 1.2f
            ) {
                performTapOpenTimelineAction()
            }

            val btnMargin = dp(4f)
            (gotItBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
            (muteSonarBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
            (openAppBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)

            actionsRow.addView(gotItBtn)
            actionsRow.addView(muteSonarBtn)
            actionsRow.addView(openAppBtn)
        } else {
            // Standard Reminder Buttons: 1. Done (انجام شد), 2. Snooze (تعویق), 3. Edit (ویرایش)
            val doneBtn = buildActionButton(
                text = if (isPersian) "✓ انجام شد" else "✓ Done",
                bgColor = palette.doneBtnBg,
                borderColor = Color.TRANSPARENT,
                textColor = palette.doneBtnText,
                strokeDp = 0f
            ) {
                performBackgroundAction("done")
            }

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
            (doneBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
            (snoozeBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
            (editBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)

            actionsRow.addView(doneBtn)
            actionsRow.addView(snoozeBtn)
            actionsRow.addView(editBtn)
        }
        content.addView(actionsRow)

        brandColumn.setOnClickListener {
            performTapOpenTimelineAction()
        }
        cardContainer.setOnClickListener {
            performTapOpenTimelineAction()
        }

        cardContainer.addView(content)
        root.addView(cardContainer)
        setContentView(root)
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
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        btn.setTypeface(Typeface.DEFAULT_BOLD)
        btn.setSingleLine(true)
        btn.ellipsize = TextUtils.TruncateAt.END
        btn.setPadding(dp(8f), dp(11f), dp(8f), dp(11f))
        btn.background = makeRoundedDrawable(bgColor, borderColor, strokeDp, 14f)
        btn.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        btn.setOnClickListener { onClick() }
        return btn
    }

    private fun startOneMinuteCountdown() {
        countDownTimer?.cancel()
        countDownTimer = object : CountDownTimer(60_000L, 1_000L) {
            override fun onTick(millisUntilFinished: Long) {
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
                performBackgroundAction("mute_after_1m")
            }
        }.start()
    }

    private fun stopGeofenceAlertIfNeeded(cancelStatusBarNotif: Boolean) {
        if (!isGeofencePopup) return
        try {
            YaadGeofenceService.stopGeofenceAudio(
                this,
                if (cancelStatusBarNotif) notificationId else Int.MIN_VALUE
            )
        } catch (e: Exception) {
        }
    }

    private fun performBackgroundAction(actionId: String) {
        countDownTimer?.cancel()
        stopPulseAnimators()
        if (isGeofencePopup) {
            stopGeofenceAlertIfNeeded(cancelStatusBarNotif = (actionId == "done"))
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
        val dispatched = LocalNotificationsPlugin.fireActionPerformed(dataJson)
        if (!dispatched) {
            LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
        }

        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.action = Intent.ACTION_MAIN
                launchIntent.addCategory(Intent.CATEGORY_LAUNCHER)
                launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                launchIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                launchIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "tap")
                if (sourceJson != null) {
                    launchIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                }
                startActivity(launchIntent)
            }
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    private fun performEditAction() {
        countDownTimer?.cancel()
        stopPulseAnimators()
        if (isGeofencePopup) {
            stopGeofenceAlertIfNeeded(cancelStatusBarNotif = true)
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
        val dispatched = LocalNotificationsPlugin.fireActionPerformed(dataJson)
        if (!dispatched) {
            LocalNotificationsPlugin.queueBackgroundAction(this, dataJson)
        }

        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.action = Intent.ACTION_MAIN
                launchIntent.addCategory(Intent.CATEGORY_LAUNCHER)
                launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                launchIntent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                launchIntent.putExtra(LocalNotificationManager.ACTION_INTENT_KEY, "edit")
                if (sourceJson != null) {
                    launchIntent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                }
                startActivity(launchIntent)
            }
        } catch (e: Exception) {
        }
        finish()
        overridePendingTransition(0, 0)
    }

    override fun onDestroy() {
        countDownTimer?.cancel()
        stopPulseAnimators()
        if (activeInstance?.get() === this) {
            activeInstance = null
        }
        super.onDestroy()
    }

    companion object {
        private var activeInstance: WeakReference<YaadAlarmPopupActivity>? = null
        private var activeNotificationId: Int = Int.MIN_VALUE

        fun updateLiveGeofenceDistance(distanceMeters: Int, sub10m: Boolean) {
            val act = activeInstance?.get() ?: return
            if (!act.isGeofencePopup) return
            act.runOnUiThread {
                try {
                    if (!act.isFinishing && !act.isDestroyed) {
                        act.distanceBadgeTextView?.text = act.formatDistanceLabel(
                            distanceMeters,
                            sub10m || act.isSub10mArrival
                        )
                    }
                } catch (e: Exception) {
                }
            }
        }

        fun dismissIfMatching(notificationId: Int) {
            val act = activeInstance?.get() ?: return
            if (activeNotificationId == notificationId || notificationId == Int.MIN_VALUE) {
                act.runOnUiThread {
                    try {
                        if (!act.isFinishing && !act.isDestroyed) {
                            act.countDownTimer?.cancel()
                            act.stopPulseAnimators()
                            act.finish()
                            act.overridePendingTransition(0, 0)
                        }
                    } catch (e: Exception) {
                    }
                }
            }
        }

        fun launch(context: Context, notificationId: Int, sourceJson: String?) {
            try {
                val intent = Intent(context, YaadAlarmPopupActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                intent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                if (sourceJson != null) {
                    intent.putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJson)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                // Handled by setFullScreenIntent when background activity start is restricted
            }
        }
    }
}
`;

// 9. Create YaadGeofenceService.kt for Out-of-App Background Geofence Monitoring
const geofenceServicePath = path.join(pluginDir, 'YaadGeofenceService.kt');
const geofenceServiceContent = `package com.capacitorjs.plugins.localnotifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
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

    private val periodicCheckRunnable = object : Runnable {
        override fun run() {
            try {
                if (!shouldRun(applicationContext)) {
                    stopGeofenceAudio(applicationContext)
                    stopSelf()
                    return
                }
                checkLastKnownLocations()
            } catch (e: Exception) {
            }
            mainHandler.postDelayed(this, 8000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_STOP_GEOFENCE_ALERT) {
            val notifId = intent?.getIntExtra(EXTRA_NOTIFICATION_ID, Int.MIN_VALUE) ?: Int.MIN_VALUE
            stopGeofenceAudio(applicationContext, notifId)
            YaadAlarmPopupActivity.dismissIfMatching(notifId)
            if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
                stopLocationUpdates()
                stopSelf()
                return START_NOT_STICKY
            }
            return START_STICKY
        }

        if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
            stopGeofenceAudio(applicationContext)
            stopLocationUpdates()
            stopSelf()
            return START_NOT_STICKY
        }

        promoteToForegroundService()
        startLocationUpdates()
        mainHandler.removeCallbacks(periodicCheckRunnable)
        mainHandler.post(periodicCheckRunnable)
        return START_STICKY
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
            val text = if (isEn) "Monitoring your saved location boundaries in the background" else "در حال پایش هوشمند محدوده مکان‌های ثبت‌شده در پس‌زمینه"

            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val contentPi = if (launchIntent != null) {
                PendingIntent.getActivity(this, 909100, launchIntent, piFlags)
            } else null

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

    private fun startLocationUpdates() {
        if (isTrackingRegistered) return
        val lm = locationManager ?: return
        if (!hasLocationPermission(this)) return
        try {
            val providers = listOf(
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            )
            for (provider in providers) {
                try {
                    if (lm.isProviderEnabled(provider)) {
                        lm.requestLocationUpdates(
                            provider,
                            3500L,
                            2f,
                            this,
                            Looper.getMainLooper()
                        )
                    }
                } catch (e: Exception) {
                }
            }
            isTrackingRegistered = true
            checkLastKnownLocations()
        } catch (e: SecurityException) {
        } catch (e: Exception) {
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

    private fun checkLastKnownLocations() {
        val lm = locationManager ?: return
        if (!hasLocationPermission(this)) return
        try {
            var bestLocation: Location? = null
            val providers = listOf(
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            )
            for (provider in providers) {
                try {
                    val loc = lm.getLastKnownLocation(provider) ?: continue
                    val currentBest = bestLocation
                    if (currentBest == null || loc.time > currentBest.time) {
                        bestLocation = loc
                    }
                } catch (e: Exception) {
                }
            }
            val finalBest = bestLocation
            if (finalBest != null && System.currentTimeMillis() - finalBest.time <= 5 * 60 * 1000L) {
                evaluateLocationAgainstGeofences(finalBest)
            }
        } catch (e: SecurityException) {
        } catch (e: Exception) {
        }
    }

    override fun onLocationChanged(location: Location) {
        evaluateLocationAgainstGeofences(location)
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun evaluateLocationAgainstGeofences(location: Location) {
        try {
            // When app is actively open in foreground, the WebView handles UI + notification directly
            if (LocalNotificationsPlugin.isAppInForeground(this)) {
                return
            }

            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val isEn = prefs.getString(KEY_LANGUAGE, "fa") == "en"
            val rawItems = prefs.getString(KEY_ITEMS_JSON, "[]") ?: "[]"
            val arr = JSONArray(rawItems)
            if (arr.length() == 0) return

            val now = System.currentTimeMillis()
            val editor = prefs.edit()
            var prefsModified = false

            var nearestDistance = Int.MAX_VALUE
            var nearestRadius = 200
            var bestRatio = Double.MAX_VALUE

            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val id = item.optString("id", "")
                if (id.isEmpty()) continue

                val title = item.optString("title", "")
                val description = item.optString("description", "")
                val targetLat = item.optDouble("latitude", Double.NaN)
                val targetLon = item.optDouble("longitude", Double.NaN)
                if (targetLat.isNaN() || targetLon.isNaN()) continue

                val radius = item.optInt("radius", 200).coerceAtLeast(20)
                val triggerOn = item.optString("triggerOn", "enter")
                val customMessage = item.optString("customMessage", "")
                val cooldownMs = item.optLong("cooldownMs", 180000L)

                val distance = calculateHaversineMeters(
                    location.latitude,
                    location.longitude,
                    targetLat,
                    targetLon
                )

                val ratio = distance.toDouble() / radius.toDouble()
                if (ratio < bestRatio) {
                    bestRatio = ratio
                    nearestDistance = distance
                    nearestRadius = radius
                }

                val isInsideNow = distance <= radius
                val isUnder10mNow = distance <= 10

                val insideKey = "inside_\$id"
                val hasPreviousState = prefs.contains(insideKey)
                val wasInsideBefore = prefs.getBoolean(insideKey, false)

                val u10mKey = "u10m_\$id"
                val wasUnder10mBefore = prefs.getBoolean(u10mKey, false)

                if (!hasPreviousState || wasInsideBefore != isInsideNow) {
                    editor.putBoolean(insideKey, isInsideNow)
                    prefsModified = true
                }
                if (wasUnder10mBefore != isUnder10mNow) {
                    editor.putBoolean(u10mKey, isUnder10mNow)
                    prefsModified = true
                }

                // 1. Sub-10m Target Arrival Alert (< 10 meters inside the boundary)
                // Fires with the saved location's content and a distinct arrival sound effect!
                if (isInsideNow && isUnder10mNow && !wasUnder10mBefore) {
                    val lastU10mKey = "last_u10m_trig_\$id"
                    val lastU10mTrig = prefs.getLong(lastU10mKey, 0L)
                    if (lastU10mTrig == 0L || now - lastU10mTrig >= 60_000L) {
                        editor.putLong(lastU10mKey, now)
                        prefsModified = true
                        fireOutOfAppGeofenceAlert(
                            id = id,
                            title = title,
                            description = description,
                            customMessage = customMessage,
                            eventType = "arrived_under_10m",
                            distance = distance,
                            radius = radius,
                            isEn = isEn
                        )
                        continue
                    }
                }

                // 2. Boundary Entry / Exit Alert
                val lastTrigKey = "last_trig_\$id"
                val lastTriggeredAt = prefs.getLong(lastTrigKey, 0L)
                if (lastTriggeredAt > 0L && now - lastTriggeredAt < cooldownMs) {
                    continue
                }

                var shouldTrigger = false
                var eventType = "enter"

                when (triggerOn) {
                    "enter" -> {
                        if (isInsideNow && (!hasPreviousState || !wasInsideBefore)) {
                            shouldTrigger = true
                            eventType = "enter"
                        }
                    }
                    "exit" -> {
                        if (!isInsideNow && hasPreviousState && wasInsideBefore) {
                            shouldTrigger = true
                            eventType = "exit"
                        }
                    }
                    "both" -> {
                        if (hasPreviousState && isInsideNow != wasInsideBefore) {
                            shouldTrigger = true
                            eventType = if (isInsideNow) "enter" else "exit"
                        } else if (!hasPreviousState && isInsideNow) {
                            shouldTrigger = true
                            eventType = "enter"
                        }
                    }
                }

                if (shouldTrigger) {
                    editor.putLong(lastTrigKey, now)
                    prefsModified = true
                    fireOutOfAppGeofenceAlert(
                        id = id,
                        title = title,
                        description = description,
                        customMessage = customMessage,
                        eventType = eventType,
                        distance = distance,
                        radius = radius,
                        isEn = isEn
                    )
                }
            }

            // Dynamically modulate live submarine sonar rhythm & lock-screen popup distance badge
            // as the user gets closer to or farther from the target location!
            if (nearestDistance != Int.MAX_VALUE) {
                updateLiveSonarDistance(nearestDistance, nearestRadius)
                YaadAlarmPopupActivity.updateLiveGeofenceDistance(nearestDistance, nearestDistance <= 10)
            }

            if (prefsModified) {
                editor.apply()
            }
        } catch (e: Exception) {
        }
    }

    private fun fireOutOfAppGeofenceAlert(
        id: String,
        title: String,
        description: String,
        customMessage: String,
        eventType: String,
        distance: Int,
        radius: Int,
        isEn: Boolean
    ) {
        try {
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
                        // Silent channel sound because YaadGeofenceService synthesizes real-time
                        // distance-adaptive Submarine Sonar & Sub-10m Target Arrival audio directly!
                        setSound(null, null)
                    }
                    nm.createNotificationChannel(ch)
                }
            }

            val notifTitle = if (isSub10m) {
                if (isEn) "🎯 Saved Location Reached: \$title" else "🎯 مقصد ثبت‌شده: \$title"
            } else {
                if (isEn) "📍 Geofence Radar: \$title" else "📍 رادار حصار مکانی: \$title"
            }

            val savedContentDetails = listOf(description.trim(), customMessage.trim())
                .filter { it.isNotEmpty() }
                .distinct()
                .joinToString(" — ")

            val notifBody = if (isSub10m) {
                if (savedContentDetails.isNotEmpty()) {
                    if (isEn) {
                        "\$savedContentDetails (Within 10m of \$title • \${distance}m)"
                    } else {
                        "\$savedContentDetails (حضور در فاصله زیر ۱۰ متری «\$title» • \${distance} متر)"
                    }
                } else {
                    if (isEn) {
                        "You have reached the exact saved location «\$title» (Distance: \${distance}m)"
                    } else {
                        "شما در نقطه دقیق مکان ثبت‌شده «\$title» قرار دارید (فاصله: \${distance} متر)"
                    }
                }
            } else {
                val actionLabel = if (eventType == "enter") {
                    if (isEn) "Entered boundary of" else "ورود به محدوده"
                } else {
                    if (isEn) "Exited boundary of" else "خروج از محدوده"
                }
                if (savedContentDetails.isNotEmpty()) {
                    if (isEn) {
                        "\$savedContentDetails • \$actionLabel \$title (Distance: \${distance}m)"
                    } else {
                        "\$savedContentDetails • \$actionLabel «\$title» (فاصله: \${distance} متر)"
                    }
                } else if (isEn) {
                    "\$actionLabel \$title (Distance: \${distance}m)"
                } else {
                    "\$actionLabel «\$title» (فاصله: \${distance} متر)"
                }
            }

            val notificationId = ((if (isSub10m) "u10m_\$id" else id).hashCode() and 0x7fffffff).coerceAtLeast(10000)

            // Build sourceJson payload for YaadAlarmPopupActivity (lockscreen / screen-off card)
            val extraJson = JSObject().apply {
                put("geofence", true)
                put("sub10m", isSub10m)
                put("distance", distance)
                put("radius", radius)
                put("language", if (isEn) "en" else "fa")
                put("theme", if (isSub10m) "geofence-sub10m" else "geofence-radar")
            }
            val sourceObj = JSObject().apply {
                put("id", notificationId)
                put("title", notifTitle)
                put("body", notifBody)
                put("extra", extraJson)
            }
            val sourceJsonStr = sourceObj.toString()

            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }

            // Full-Screen / Lock-Screen Popup PendingIntent (wakes screen & shows Geofence Radar card)
            val popupIntent = Intent(this, YaadAlarmPopupActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJsonStr)
            }
            val fullScreenPi = PendingIntent.getActivity(
                this,
                notificationId + 100000,
                popupIntent,
                piFlags
            )

            // Stop / Acknowledge Action PendingIntent for Status Bar Notification
            val stopIntent = Intent(this, YaadGeofenceService::class.java).apply {
                action = ACTION_STOP_GEOFENCE_ALERT
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            }
            val stopPi = PendingIntent.getService(
                this,
                notificationId + 200000,
                stopIntent,
                piFlags
            )

            // Open App PendingIntent
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val contentPi = if (launchIntent != null) {
                PendingIntent.getActivity(this, notificationId, launchIntent, piFlags)
            } else fullScreenPi

            val smallIconRes = resources.getIdentifier("ic_stat_icon_config_sample", "drawable", packageName)
                .takeIf { it != 0 } ?: applicationInfo.icon

            val builder = NotificationCompat.Builder(this, alertChannelId)
                .setSmallIcon(smallIconRes)
                .setContentTitle(notifTitle)
                .setContentText(notifBody)
                .setStyle(NotificationCompat.BigTextStyle().bigText(notifBody))
                .setColor(if (isSub10m) 0xFF059669.toInt() else 0xFF04231F.toInt())
                .setColorized(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setFullScreenIntent(fullScreenPi, true)
                .setDeleteIntent(stopPi)
                .setVibrate(longArrayOf(0, 450, 180, 450))
                .addAction(
                    0,
                    if (isEn) "✓ Got It" else "✓ متوجه شدم",
                    stopPi
                )

            if (contentPi != null) {
                builder.setContentIntent(contentPi)
            }

            NotificationManagerCompat.from(this).notify(notificationId, builder.build())

            // Launch Lock-Screen / Screen-Off Geofence Radar Popup Activity immediately
            YaadAlarmPopupActivity.launch(this, notificationId, sourceJsonStr)

            // Play Distinct Audio Effect:
            // - Sub-10m Arrival: Distinct celebratory multi-tone Target-Lock Arrival Fanfare
            // - Boundary Alert: Submarine Sonar Loop whose rhythm speeds up/slows down with live GPS distance
            if (isSub10m) {
                playNativeSub10mArrivalSound(applicationContext, notificationId)
            } else {
                startNativeSubmarineSonarLoop(applicationContext, distance, radius, notificationId)
            }
        } catch (e: Exception) {
        }
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
        stopLocationUpdates()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private class ToneNote(
            val freq: Double,
            val startSec: Double,
            val durSec: Double,
            val gain: Double
        )

        private const val PREFS_NAME = "YAAD_GEOFENCE_PREFS"
        private const val KEY_ENABLED = "geofence_enabled"
        private const val KEY_LANGUAGE = "geofence_lang"
        private const val KEY_ITEMS_JSON = "geofence_items_json"
        private const val RADAR_SERVICE_CHANNEL_ID = "yaad_geofence_radar_service_v1"
        private const val RADAR_FOREGROUND_NOTIFICATION_ID = 889911
        const val ACTION_STOP_GEOFENCE_ALERT = "com.capacitorjs.plugins.localnotifications.STOP_GEOFENCE_ALERT"
        const val EXTRA_NOTIFICATION_ID = "extra_geofence_notif_id"

        @Volatile
        private var sonarLoopActive: Boolean = false
        @Volatile
        private var liveSonarDistanceMeters: Int = 100
        @Volatile
        private var liveSonarRadiusMeters: Int = 200
        @Volatile
        private var activeGeofenceNotificationId: Int = Int.MIN_VALUE
        private var sonarThread: Thread? = null
        private var sonarWakeLock: PowerManager.WakeLock? = null

        fun computeSonarIntervalMs(distanceMeters: Int, radiusMeters: Int): Long {
            val safeRadius = radiusMeters.coerceAtLeast(30).toDouble()
            val clampedDist = distanceMeters.coerceAtLeast(0).toDouble()
            val ratio = (clampedDist / safeRadius).coerceIn(0.0, 1.5)
            val minMs = 280.0
            val maxMs = 2200.0
            val normalized = (ratio / 1.5).coerceIn(0.0, 1.0)
            return (minMs + (maxMs - minMs) * Math.pow(normalized, 0.85)).roundToInt().toLong()
        }

        fun updateLiveSonarDistance(distanceMeters: Int, radiusMeters: Int) {
            liveSonarDistanceMeters = distanceMeters
            if (radiusMeters > 0) {
                liveSonarRadiusMeters = radiusMeters
            }
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

        fun startNativeSubmarineSonarLoop(
            context: Context,
            initialDistance: Int,
            radius: Int,
            notificationId: Int
        ) {
            stopGeofenceAudio(context)
            liveSonarDistanceMeters = initialDistance
            liveSonarRadiusMeters = radius.coerceAtLeast(30)
            activeGeofenceNotificationId = notificationId
            sonarLoopActive = true
            acquireTemporaryWakeLock(context, 62_000L)

            val t = Thread {
                val sampleRate = 24000
                val pingDurationSec = 0.42
                val numSamples = (sampleRate * pingDurationSec).toInt()
                val pcmBuffer = ShortArray(numSamples)
                val startedAt = System.currentTimeMillis()

                while (sonarLoopActive && System.currentTimeMillis() - startedAt < 60_000L) {
                    try {
                        val dist = liveSonarDistanceMeters
                        val rad = liveSonarRadiusMeters.coerceAtLeast(30)
                        val closeness = (1.0 - (dist.toDouble() / (rad.toDouble() * 1.2)).coerceIn(0.0, 1.0))
                        // Pitch rises slightly as user gets closer to target (1260 Hz -> 1480 Hz)
                        val baseFreq = 1260.0 + closeness * 220.0
                        val echoDelaySamples = (0.13 * sampleRate).toInt()

                        for (i in 0 until numSamples) {
                            val timeSec = i.toDouble() / sampleRate.toDouble()
                            // Primary submarine sonar ping with fast attack and underwater decay
                            val attack1 = (timeSec / 0.008).coerceIn(0.0, 1.0)
                            val env1 = attack1 * exp(-timeSec * 10.5)
                            val sig1 = sin(2.0 * PI * baseFreq * timeSec) * 0.72 +
                                sin(2.0 * PI * (baseFreq * 2.0) * timeSec) * 0.16

                            // Secondary hull reflection echo 130ms later
                            var sig2 = 0.0
                            if (i >= echoDelaySamples) {
                                val echoTime = (i - echoDelaySamples).toDouble() / sampleRate.toDouble()
                                val attack2 = (echoTime / 0.008).coerceIn(0.0, 1.0)
                                val env2 = attack2 * exp(-echoTime * 11.5) * 0.36
                                sig2 = sin(2.0 * PI * (baseFreq * 0.992) * echoTime) * env2
                            }

                            val combined = ((sig1 * env1) + sig2).coerceIn(-0.98, 0.98)
                            pcmBuffer[i] = (combined * Short.MAX_VALUE).toInt().toShort()
                        }

                        playPcmBufferOnce(pcmBuffer, sampleRate)
                    } catch (ie: InterruptedException) {
                        break
                    } catch (e: Exception) {
                    }

                    // Dynamic sleep in 40ms slices so if GPS updates distance to be closer,
                    // the sonar rhythm accelerates immediately without waiting out an old long interval!
                    var sleptMs = 0L
                    while (sonarLoopActive) {
                        val targetWaitMs = computeSonarIntervalMs(liveSonarDistanceMeters, liveSonarRadiusMeters)
                        if (sleptMs >= targetWaitMs) break
                        try {
                            Thread.sleep(40L)
                            sleptMs += 40L
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

        fun playNativeSub10mArrivalSound(context: Context, notificationId: Int) {
            stopGeofenceAudio(context)
            activeGeofenceNotificationId = notificationId
            acquireTemporaryWakeLock(context, 15_000L)

            Thread {
                try {
                    val sampleRate = 24000
                    val totalDurationSec = 1.35
                    val numSamples = (sampleRate * totalDurationSec).toInt()
                    val pcm = ShortArray(numSamples)

                    // Celebratory Target-Lock Arrival Fanfare (distinct from submarine sonar ping)
                    val notes = listOf(
                        ToneNote(523.25, 0.00, 0.14, 0.55), // C5
                        ToneNote(659.25, 0.11, 0.14, 0.60), // E5
                        ToneNote(783.99, 0.22, 0.16, 0.65), // G5
                        ToneNote(1046.50, 0.35, 0.28, 0.75), // C6
                        ToneNote(1318.51, 0.56, 0.24, 0.70), // E6
                        ToneNote(1567.98, 0.74, 0.55, 0.82)  // G6 target lock chime
                    )

                    // Play fanfare twice with a short pause so user unmistakably hears the <10m arrival
                    for (repeatIdx in 0..1) {
                        for (i in 0 until numSamples) {
                            val t = i.toDouble() / sampleRate.toDouble()
                            var sampleVal = 0.0
                            for (note in notes) {
                                if (t >= note.startSec && t <= note.startSec + note.durSec) {
                                    val localT = t - note.startSec
                                    val attack = (localT / 0.012).coerceIn(0.0, 1.0)
                                    val decay = exp(-localT * (4.2 / note.durSec))
                                    val wave = sin(2.0 * PI * note.freq * localT) * 0.75 +
                                        sin(2.0 * PI * (note.freq * 2.0) * localT) * 0.25
                                    sampleVal += wave * attack * decay * note.gain
                                }
                            }
                            pcm[i] = (sampleVal.coerceIn(-0.98, 0.98) * Short.MAX_VALUE).toInt().toShort()
                        }
                        playPcmBufferOnce(pcm, sampleRate)
                        if (repeatIdx == 0) {
                            Thread.sleep(280L)
                        }
                    }
                } catch (e: Exception) {
                }
            }.apply {
                name = "yaad-sub10m-arrival"
                isDaemon = true
                start()
            }
        }

        private fun playPcmBufferOnce(pcmBuffer: ShortArray, sampleRate: Int) {
            var track: AudioTrack? = null
            try {
                val byteSize = pcmBuffer.size * 2
                track = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    AudioTrack.Builder()
                        .setAudioAttributes(
                            AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
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
                        AudioManager.STREAM_ALARM,
                        sampleRate,
                        AudioFormat.CHANNEL_OUT_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        byteSize,
                        AudioTrack.MODE_STATIC
                    )
                }
                track.write(pcmBuffer, 0, pcmBuffer.size)
                track.play()
                val durationMs = ((pcmBuffer.size.toLong() * 1000L) / sampleRate.toLong()) + 30L
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

                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit()
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
                val serviceIntent = Intent(appCtx, YaadGeofenceService::class.java)
                if (shouldRun(appCtx) && hasLocationPermission(appCtx)) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ContextCompat.startForegroundService(appCtx, serviceIntent)
                    } else {
                        appCtx.startService(serviceIntent)
                    }
                } else {
                    stopGeofenceAudio(appCtx)
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
    }
}
`;

// 10. Patch plugin AndroidManifest.xml to register YaadAlarmPopupActivity, YaadGeofenceService, and required permissions
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
            android:turnScreenOn="true"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode" />`
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
            android:foregroundServiceType="location" />`
    );
  }
  if (!manifestContent.includes('android.permission.USE_FULL_SCREEN_INTENT')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>\n</manifest>`
    );
  }
  if (!manifestContent.includes('android.permission.FOREGROUND_SERVICE')) {
    manifestContent = manifestContent.replace(
      '</manifest>',
      `    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>\n    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>\n</manifest>`
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
fs.writeFileSync(pluginPath, pluginContent, 'utf8');
fs.writeFileSync(popupActivityPath, popupActivityContent, 'utf8');
fs.writeFileSync(geofenceServicePath, geofenceServiceContent, 'utf8');

console.log(
  `[patch-capacitor-notifications] Successfully patched and verified @capacitor/local-notifications@${pluginVersion} (with YaadAlarmPopupActivity & YaadGeofenceService).`
);

