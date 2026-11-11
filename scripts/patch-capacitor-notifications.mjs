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
  'companion isAppInForeground, evaluateJsInWebView, stopActiveMediaPlayer, fireActionPerformed, and deduplicated queueBackgroundAction',
  origCompanionFire,
  patchedCompanionFire,
  'fun evaluateJsInWebView(jsCode: String)',
  [legacyCompanionFire, legacyCompanionFireV2, legacyCompanionFireV3, legacyCompanionFireV4, legacyCompanionFireV5, legacyCompanionFireV6, legacyCompanionFireV7]
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
    private var screenWakeLock: android.os.PowerManager.WakeLock? = null

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

        val shouldWakeScreenOnce = intent?.getBooleanExtra("yaad_wake_screen_once", false) == true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(shouldWakeScreenOnce)
        }
        @Suppress("DEPRECATION")
        var winFlags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DIM_BEHIND
        if (shouldWakeScreenOnce) {
            @Suppress("DEPRECATION")
            winFlags = winFlags or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        }
        window.addFlags(winFlags)
        window.setDimAmount(0.65f)
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

    override fun onPause() {
        super.onPause()
        // Release any screen wake lock immediately when user presses Power button to turn off screen
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
        // immediately stop sonar audio, cancel the notification, open the app, and navigate to Geofence Radius section.
        if (data.getBooleanExtra("yaad_direct_geofence_edit", false)) {
            performEditAction()
            return
        }

        // If launched via Status Bar Notification "🧭 مسیریابی" ("Directions") action button,
        // immediately stop sonar audio, cancel the notification, and launch Google Maps turn-by-turn navigation.
        if (data.getBooleanExtra("yaad_direct_geofence_directions", false)) {
            performDirectionsAction()
            return
        }

        val bodyText = requestJson?.getString("body") ?: ""

        val effectiveTheme = if (isGeofencePopup) {
            if (isSub10mArrival) "geofence-sub10m" else "geofence-radar"
        } else {
            themeName
        }
        val palette = resolvePalette(effectiveTheme)
        if (isGeofencePopup) {
            countDownTimer?.cancel()
            if (data.getBooleanExtra("yaad_wake_screen_once", false)) {
                acquireBriefScreenWakeLock()
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
            if (isVisualOnlyBanner && multiItemsArr.length() <= 1) {
                countDownTimer = object : CountDownTimer(20_000L, 1_000L) {
                    override fun onTick(millisUntilFinished: Long) {}
                    override fun onFinish() {
                        releaseScreenWakeLock()
                        finish()
                        overridePendingTransition(0, 0)
                    }
                }.start()
            }
        } else {
            buildMinimalCardUI(palette, cleanTitle, bodyText, initialDistance)
            startOneMinuteCountdown()
        }
    }

    private fun acquireBriefScreenWakeLock() {
        try {
            if (screenWakeLock?.isHeld == true) return
            val pm = getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    android.os.PowerManager.ON_AFTER_RELEASE,
                "yaad:geofenceLockScreenWakeLock"
            )
            wl.setReferenceCounted(false)
            wl.acquire(7_000L)
            screenWakeLock = wl
        } catch (e: Exception) {
        }
    }

    private fun releaseScreenWakeLock() {
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
        outerContainer.setPadding(dp(14f), dp(14f), dp(14f), dp(14f))
        outerContainer.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

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

            // 3. 4 Concise Buttons (قطع صدا, توقف, مسیریابی, ویرایش)
            val btnRow = LinearLayout(this)
            btnRow.orientation = LinearLayout.HORIZONTAL
            btnRow.gravity = Gravity.CENTER
            val btnRowLp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            btnRowLp.topMargin = dp(10f)
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
                YaadGeofenceService.pauseGeofenceItemTemporarily(this, itemId, 20_000L, itemNotifId)
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
                performEditAction()
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
        content.setPadding(dp(8f), dp(10f), dp(8f), dp(10f))
        content.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

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

        // 3. BOTTOM SECTION: 4 Compact Buttons ("قطع صدا", "توقف", "مسیریابی", "ویرایش") in 2x2 grid
        val row1 = LinearLayout(this)
        row1.orientation = LinearLayout.HORIZONTAL
        row1.gravity = Gravity.CENTER
        val row1Params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        row1Params.topMargin = dp(6f)
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
        muteAudioBtn.setPadding(dp(6f), dp(9f), dp(6f), dp(9f))

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
        gotItBtn.setPadding(dp(6f), dp(9f), dp(6f), dp(9f))

        val btnMargin = dp(3f)
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
        directionsBtn.setPadding(dp(6f), dp(9f), dp(6f), dp(9f))

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
        editBtn.setPadding(dp(6f), dp(9f), dp(6f), dp(9f))

        (directionsBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        (editBtn.layoutParams as LinearLayout.LayoutParams).setMargins(btnMargin, 0, btnMargin, 0)
        row2.addView(directionsBtn)
        row2.addView(editBtn)
        content.addView(row2)

        cardContainer.addView(content)
        root.addView(cardContainer)
        setContentView(root)
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
        cardContainer.background = makeRoundedDrawable(palette.cardBg, palette.cardBorder, 1.8f, 24f)
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

        // Header row: Official App Icon + Brand label + close button
        val headerRow = LinearLayout(this)
        headerRow.orientation = LinearLayout.HORIZONTAL
        headerRow.gravity = Gravity.CENTER_VERTICAL

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

        val brandColumn = LinearLayout(this)
        brandColumn.orientation = LinearLayout.VERTICAL
        val brandColParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        brandColumn.layoutParams = brandColParams

        val brandTv = TextView(this)
        brandTv.text = if (isPersian) "یادآور هوشمند یاد" else "YAAD Reminder"
        brandTv.setTextColor(palette.accentColor)
        brandTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        brandTv.setTypeface(Typeface.DEFAULT_BOLD)
        brandColumn.addView(brandTv)
        distanceBadgeTextView = null

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

        // Body / Saved Content
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

        // Standard Reminder Action Buttons Row: 1. Done (انجام شد), 2. Snooze (تعویق), 3. Edit (ویرایش)
        val actionsRow = LinearLayout(this)
        actionsRow.orientation = LinearLayout.HORIZONTAL
        actionsRow.gravity = Gravity.CENTER
        val actionsParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        actionsParams.topMargin = dp(16f)
        actionsRow.layoutParams = actionsParams

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

    private fun performBackgroundAction(actionId: String) {
        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()
        if (isGeofencePopup) {
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

    private fun performDirectionsAction() {
        countDownTimer?.cancel()
        stopPulseAnimators()
        releaseScreenWakeLock()
        YaadGeofenceService.pauseGeofenceItemTemporarily(
            this,
            geofenceItemId,
            20_000L,
            notificationId
        )
        try {
            if (notificationId != Int.MIN_VALUE) {
                NotificationManagerCompat.from(this).cancel(notificationId)
            }
        } catch (e: Exception) {
        }
        YaadGeofenceService.launchGoogleMapsDirections(
            this,
            targetLatitude,
            targetLongitude,
            cleanLocationTitle
        )
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
            YaadGeofenceService.pauseGeofenceItemTemporarily(
                this,
                geofenceItemId,
                60_000L,
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
        releaseScreenWakeLock()
        if (activeInstance?.get() === this) {
            activeInstance = null
        }
        super.onDestroy()
    }

    companion object {
        private var activeInstance: WeakReference<YaadAlarmPopupActivity>? = null
        private var activeNotificationId: Int = Int.MIN_VALUE

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

        fun dismissIfMatching(notificationId: Int) {
            val act = activeInstance?.get() ?: return
            if (activeNotificationId == notificationId || notificationId == Int.MIN_VALUE) {
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
            wakeScreenOnce: Boolean = false
        ) {
            try {
                val intent = Intent(context, YaadAlarmPopupActivity::class.java)
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
                intent.putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
                intent.putExtra("yaad_wake_screen_once", wakeScreenOnce)
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
    private var lastGpsFixTimeMs: Long = 0L
    private var lastAcceptedLocationTimeMs: Long = 0L
    private var lastAcceptedLat: Double = Double.NaN
    private var lastAcceptedLon: Double = Double.NaN
    private var lastAcceptedAccuracy: Float = Float.MAX_VALUE

    /**
     * BroadcastReceiver for Screen-On on Lockscreen:
     * IMPORTANT: Never trigger on ACTION_SCREEN_OFF, otherwise pressing the Power button to turn off the screen
     * while a notification is active in the notification menu would wake the screen back up and bounce back into Android!
     * Only when the user turns ON the screen (ACTION_SCREEN_ON) while the keyguard is locked, show the lockscreen card.
     */
    private val screenStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (action == Intent.ACTION_SCREEN_ON) {
                mainHandler.postDelayed({
                    try {
                        relaunchActivePopupOnLockscreenIfNeeded()
                    } catch (e: Exception) {
                    }
                }, 150L)
            }
        }
    }

    private val periodicCheckRunnable = object : Runnable {
        override fun run() {
            try {
                if (!shouldRun(applicationContext)) {
                    stopGeofenceAudio(applicationContext)
                    cancelGpsDisabledWarningNotification(applicationContext)
                    stopSelf()
                    return
                }
                checkLastKnownLocations()
            } catch (e: Exception) {
            }
            // 1-second check cycle for <2s geofence alert response
            mainHandler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        registerScreenStateReceiver()
    }

    private fun registerScreenStateReceiver() {
        if (isScreenReceiverRegistered) return
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
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

    private fun relaunchActivePopupOnLockscreenIfNeeded() {
        if (activeGeofenceNotificationId == Int.MIN_VALUE || activeGeofenceItemId.isEmpty()) return
        if (!isScreenInteractive() || !isDeviceKeyguardLocked()) return
        if (YaadAlarmPopupActivity.isShowingGeofencePopup()) return

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val pausedUntil = prefs.getLong("paused_until_\$activeGeofenceItemId", 0L)
        if (pausedUntil > now) return
        if (prefs.getBoolean("completed_cycle_\$activeGeofenceItemId", false)) return

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
            postToStatusBar = false,
            visualOnlyBanner = isVisualOnly,
            visualBannerText = activeGeofenceCustomMessage,
            multiCardsJson = lastActiveMultiCardsJson
        )
        YaadAlarmPopupActivity.launch(this, activeGeofenceNotificationId, sourceJsonStr, wakeScreenOnce = false)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_STOP_GEOFENCE_ALERT) {
            val notifId = intent?.getIntExtra(EXTRA_NOTIFICATION_ID, Int.MIN_VALUE) ?: Int.MIN_VALUE
            val targetItemId = intent?.getStringExtra(EXTRA_GEOFENCE_ITEM_ID) ?: activeGeofenceItemId
            stopGeofenceOperationForItem(applicationContext, targetItemId, notifId)
            if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
                stopLocationUpdates()
                stopSelf()
                return START_NOT_STICKY
            }
            return START_STICKY
        }

        if (!shouldRun(applicationContext) || !hasLocationPermission(applicationContext)) {
            stopGeofenceAudio(applicationContext)
            cancelGpsDisabledWarningNotification(applicationContext)
            stopLocationUpdates()
            stopSelf()
            return START_NOT_STICKY
        }

        registerScreenStateReceiver()
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
            val text = if (isEn) "Monitoring your saved location boundaries" else "در حال پایش محدوده مکان‌های ثبت‌شده"

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
        val lm = locationManager ?: return
        if (!hasLocationPermission(this)) return
        try {
            if (isTrackingRegistered) {
                try {
                    lm.removeUpdates(this)
                } catch (e: Exception) {
                }
                isTrackingRegistered = false
            }
            var anyRegistered = false
            // 1. High-accuracy satellite GPS_PROVIDER (1000ms, 0m minDistance) for <2s response
            try {
                if (lm.allProviders.contains(LocationManager.GPS_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        1000L,
                        0.0f,
                        this,
                        Looper.getMainLooper()
                    )
                    anyRegistered = true
                }
            } catch (e: Exception) {
            }
            // 2. Fast NETWORK_PROVIDER (1000ms, 0m) for instant indoor/urban response (<2s)
            try {
                if (lm.allProviders.contains(LocationManager.NETWORK_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        1000L,
                        0.0f,
                        this,
                        Looper.getMainLooper()
                    )
                    anyRegistered = true
                }
            } catch (e: Exception) {
            }
            // 3. PASSIVE_PROVIDER (500ms, 0m) to capture location fixes from any system service immediately
            try {
                if (lm.allProviders.contains(LocationManager.PASSIVE_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.PASSIVE_PROVIDER,
                        500L,
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

    private fun stopLocationUpdates() {
        if (!isTrackingRegistered) return
        try {
            locationManager?.removeUpdates(this)
        } catch (e: Exception) {
        }
        isTrackingRegistered = false
    }

    private fun shouldAcceptNativeLocation(loc: Location): Boolean {
        val now = System.currentTimeMillis()
        val locTime = if (loc.time > 0L) loc.time else now
        if (locTime < lastAcceptedLocationTimeMs - 2000L) {
            return false
        }

        val acc = if (loc.hasAccuracy() && loc.accuracy > 0f) loc.accuracy else 20f
        val isGps = loc.provider == LocationManager.GPS_PROVIDER
        if (isGps) {
            lastGpsFixTimeMs = now
        } else {
            if (now - lastGpsFixTimeMs < 12_000L && acc > lastAcceptedAccuracy + 15f) {
                return false
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

            val chosen = if (gpsLoc != null && now - gpsLoc.time <= 15_000L) {
                gpsLoc
            } else if (gpsLoc != null && netLoc != null) {
                if (gpsLoc.time >= netLoc.time - 8_000L && gpsLoc.accuracy <= netLoc.accuracy + 15f) gpsLoc else netLoc
            } else {
                gpsLoc ?: netLoc
            }

            if (chosen != null && now - chosen.time <= 5 * 60 * 1000L) {
                evaluateLocationAgainstGeofences(chosen)
            }
        } catch (e: SecurityException) {
        } catch (e: Exception) {
        }
    }

    override fun onLocationChanged(location: Location) {
        if (shouldAcceptNativeLocation(location)) {
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
        return !isScreenInteractive() || isDeviceKeyguardLocked()
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

            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val id = item.optString("id", "")
                // Monitor ONLY Saved Locations (id starting with loc_ or non-rem_)
                if (id.isEmpty() || id.startsWith("rem_")) continue

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
                val triggerOn = item.optString("triggerOn", "enter")

                val rawDistance = calculateHaversineMeters(
                    location.latitude,
                    location.longitude,
                    targetLat,
                    targetLon
                )

                // Accuracy-weighted moving average + fuzzy hysteresis
                val (smoothedDistDouble, deltaMeters) = recordAndAnalyzeNativeTrend(id, rawDistance.toDouble(), accuracyMeters, now)
                val distance = smoothedDistDouble.roundToInt()

                val fivePctMeters = kotlin.math.min((radius * 0.35).toInt(), kotlin.math.max(15, (radius * 0.05).roundToInt()))
                val centerZoneMeters = fivePctMeters
                val preEntryStartMeters = radius + fivePctMeters
                val fuzzyHyst = kotlin.math.min(25, kotlin.math.max(10, (accuracyMeters * 0.6).roundToInt()))

                val insideKey = "inside_\$id"
                val armedExitKey = "armed_exit_\$id"
                val sonarDoneKey = "sonar_done_\$id"
                val hasPreviousState = prefs.contains(insideKey)
                val wasInsideBefore = prefs.getBoolean(insideKey, false)
                var armedForExit = prefs.getBoolean(armedExitKey, false)
                var sonarDone = prefs.getBoolean(sonarDoneKey, false)

                if (!startedOutsideMap.containsKey(id)) {
                    startedOutsideMap[id] = rawDistance > radius
                }
                val startedOutside = startedOutsideMap[id] == true

                val isInsideNow = if (wasInsideBefore) {
                    distance <= radius + fuzzyHyst
                } else {
                    distance <= radius
                }

                if (isInsideNow || distance <= radius) {
                    val prevMin = minDistInsideMap[id] ?: Double.POSITIVE_INFINITY
                    if (smoothedDistDouble < prevMin) {
                        minDistInsideMap[id] = smoothedDistDouble
                    }
                } else if (distance > preEntryStartMeters + fuzzyHyst) {
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

                val minDistInside = minDistInsideMap[id] ?: Double.POSITIVE_INFINITY
                val maxDistApproach = maxDistApproachMap[id] ?: smoothedDistDouble

                val lastInwardMs = lastInwardMoveTimeMap[id] ?: 0L
                val lastOutwardMs = lastOutwardMoveTimeMap[id] ?: 0L
                val isMovingInward = deltaMeters <= -0.8 || (lastInwardMs > 0L && lastInwardMs >= lastOutwardMs && now - lastInwardMs < 60_000L)
                val isMovingOutward = deltaMeters >= 1.2 || (lastOutwardMs > 0L && lastOutwardMs > lastInwardMs && now - lastOutwardMs < 60_000L)

                // Strict directional confirmation so Enter mode NEVER fires on Exit and Exit mode NEVER fires on Enter
                val isConfirmedExiting = deltaMeters >= 1.0 ||
                    (lastOutwardMs > lastInwardMs && now - lastOutwardMs <= 60_000L) ||
                    (minDistInside.isFinite() && smoothedDistDouble - minDistInside >= kotlin.math.max(6.0, fuzzyHyst * 0.8))

                val isConfirmedEntering = deltaMeters <= -0.8 ||
                    (lastInwardMs > lastOutwardMs && now - lastInwardMs <= 60_000L) ||
                    (maxDistApproach - smoothedDistDouble >= kotlin.math.max(5.0, fuzzyHyst * 0.6))

                val safeInteriorRadius = kotlin.math.max(centerZoneMeters + 5, radius - kotlin.math.max(12, (fuzzyHyst * 0.8).roundToInt()))
                if ((distance <= centerZoneMeters || (!startedOutside && isConfirmedExiting && distance <= safeInteriorRadius)) && !armedForExit) {
                    armedForExit = true
                    editor.putBoolean(armedExitKey, true)
                    prefsModified = true
                }

                val fiveHzKey = "five_hz_start_\$id"
                val bannerStartKey = "banner_start_\$id"
                val bannerTextKey = "banner_text_\$id"
                val entryToastStartKey = "entry_toast_start_\$id"
                val completedCycleKey = "completed_cycle_\$id"
                val phaseTransitionKey = "phase_trans_\$id"

                var fiveHzStart = prefs.getLong(fiveHzKey, 0L)
                var bannerStart = prefs.getLong(bannerStartKey, 0L)
                var bannerText = prefs.getString(bannerTextKey, "") ?: ""
                var entryToastStart = prefs.getLong(entryToastStartKey, 0L)
                var completedCycle = prefs.getBoolean(completedCycleKey, false)
                val lastPhaseTrans = prefs.getLong(phaseTransitionKey, 0L)

                // Active 20-second visual-only banner (after 10s of 5Hz = 30s total; NO 6s sonar after 5Hz finishes)
                if (bannerStart > 0L) {
                    if (now - bannerStart < 20_000L) {
                        val targetDist = if (triggerOn == "enter") distance else kotlin.math.abs(distance - radius)
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
                    } else {
                        editor.remove(bannerStartKey)
                        editor.remove(bannerTextKey)
                        editor.putBoolean(completedCycleKey, true)
                        editor.putBoolean(sonarDoneKey, true)
                        editor.putLong(phaseTransitionKey, now)
                        prefsModified = true
                        bannerStart = 0L
                        completedCycle = true
                        sonarDone = true
                        val notifIdToCancel = geofenceNotifId(id)
                        try {
                            NotificationManagerCompat.from(this).cancel(notifIdToCancel)
                        } catch (e: Exception) {
                        }
                        YaadAlarmPopupActivity.dismissIfMatching(notifIdToCancel)
                    }
                }

                when (triggerOn) {
                    "enter" -> {
                        if (distance > preEntryStartMeters + fuzzyHyst) {
                            if (wasInsideBefore || completedCycle || fiveHzStart > 0L || entryToastStart > 0L || sonarDone) {
                                editor.putBoolean(insideKey, false)
                                editor.putBoolean(completedCycleKey, false)
                                editor.putBoolean(sonarDoneKey, false)
                                editor.putBoolean(armedExitKey, false)
                                editor.remove(fiveHzKey)
                                editor.remove(entryToastStartKey)
                                prefsModified = true
                            }
                            continue
                        }
                        if (distance > preEntryStartMeters && !wasInsideBefore) {
                            continue
                        }
                        // Do NOT reset completedCycle while still inside the fence or exiting!
                        if (completedCycle) {
                            continue
                        }
                        // If user is moving outward / exiting away from center, NEVER fire Enter alert!
                        if (isConfirmedExiting && !isConfirmedEntering && distance > centerZoneMeters) {
                            if (fiveHzStart > 0L) {
                                editor.remove(fiveHzKey)
                                prefsModified = true
                            }
                            continue
                        }
                        if (!wasInsideBefore && isInsideNow && !isConfirmedExiting) {
                            editor.putBoolean(insideKey, true)
                            editor.putLong(entryToastStartKey, now)
                            entryToastStart = now
                            lastInwardMoveTimeMap[id] = now
                            prefsModified = true
                        }

                        val activeEntryToastMsg = if (entryToastStart > 0L && now - entryToastStart < 10_000L) {
                            if (isEn) "Entered «\$title»" else "ورود به حصار مکانی «\$title»"
                        } else ""

                        if (distance <= centerZoneMeters || fiveHzStart > 0L) {
                            if (fiveHzStart == 0L) {
                                fiveHzStart = now
                                editor.putLong(fiveHzKey, now)
                                prefsModified = true
                            }
                            val elapsed5Hz = now - fiveHzStart
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
                        } else if (!sonarDone && !isConfirmedExiting && (isConfirmedEntering || isMovingInward || (!startedOutside && wasInsideBefore))) {
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
                        if (distance <= centerZoneMeters) {
                            if (!wasInsideBefore || completedCycle || sonarDone || fiveHzStart > 0L) {
                                editor.putBoolean(insideKey, true)
                                editor.putBoolean(completedCycleKey, false)
                                editor.putBoolean(sonarDoneKey, false)
                                editor.remove(fiveHzKey)
                                sonarDone = false
                                completedCycle = false
                                fiveHzStart = 0L
                                prefsModified = true
                            }
                            if (!armedForExit) {
                                armedForExit = true
                                editor.putBoolean(armedExitKey, true)
                                prefsModified = true
                            }
                            continue
                        }

                        // Strictly block Exit alert if not armed or if the user is entering / moving inward toward center!
                        if (!armedForExit || completedCycle || (isConfirmedEntering && !isConfirmedExiting)) {
                            if (fiveHzStart > 0L && isConfirmedEntering) {
                                editor.remove(fiveHzKey)
                                prefsModified = true
                            }
                            continue
                        }

                        if (isInsideNow && fiveHzStart == 0L) {
                            if (!isConfirmedExiting || isMovingInward || sonarDone) {
                                continue
                            }
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
                        } else if (isConfirmedExiting && !completedCycle) {
                            val exitedMsg = if (isEn) "Exited «\$title»" else "خروج از حصار مکانی «\$title»"
                            if (fiveHzStart == 0L) {
                                fiveHzStart = now
                                editor.putBoolean(insideKey, false)
                                editor.putBoolean(armedExitKey, false)
                                editor.putLong(fiveHzKey, now)
                                prefsModified = true
                            }
                            val elapsed5Hz = now - fiveHzStart
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
                            editor.putBoolean(insideKey, false)
                            prefsModified = true
                        }
                    }

                    "both" -> {
                        val distToBoundary = kotlin.math.max(0, radius - distance)
                        if (!hasPreviousState) {
                            editor.putBoolean(insideKey, isInsideNow)
                            if (distance <= centerZoneMeters || (!startedOutside && distance <= safeInteriorRadius)) {
                                armedForExit = true
                                editor.putBoolean(armedExitKey, true)
                            }
                            prefsModified = true
                        } else if (!wasInsideBefore && isInsideNow && !isConfirmedExiting) {
                            editor.putBoolean(insideKey, true)
                            editor.putBoolean(completedCycleKey, false)
                            editor.putBoolean(sonarDoneKey, false)
                            sonarDone = false
                            editor.putLong(phaseTransitionKey, now)
                            editor.putLong(entryToastStartKey, now)
                            entryToastStart = now
                            editor.remove(fiveHzKey)
                            lastInwardMoveTimeMap[id] = now
                            prefsModified = true
                        } else if (wasInsideBefore && !isInsideNow && armedForExit && isConfirmedExiting) {
                            editor.putBoolean(insideKey, false)
                            editor.putBoolean(armedExitKey, false)
                            armedForExit = false
                            editor.putBoolean(completedCycleKey, false)
                            editor.putBoolean(sonarDoneKey, false)
                            sonarDone = false
                            editor.putLong(phaseTransitionKey, now)
                            editor.putLong(fiveHzKey, now)
                            fiveHzStart = now
                            prefsModified = true
                        } else if (wasInsideBefore && !isInsideNow && !armedForExit) {
                            editor.putBoolean(insideKey, false)
                            prefsModified = true
                        }

                        if (!isInsideNow) {
                            if (fiveHzStart > 0L) {
                                val exitedMsg = if (isEn) "Exited «\$title»" else "خروج از حصار مکانی «\$title»"
                                val elapsed5Hz = now - fiveHzStart
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
                                continue
                            }
                            if (distance <= preEntryStartMeters && !isConfirmedExiting && (isConfirmedEntering || isMovingInward) && !sonarDone) {
                                val approachingMsg = if (isEn) "Approaching «\$title»" else "نزدیک شدن به «\$title»"
                                activeCandidates.add(
                                    NativeAlertCandidate(
                                        id = id,
                                        title = title,
                                        statusPhrase = approachingMsg,
                                        eventType = "enter",
                                        sonarMode = "enter",
                                        distance = distance,
                                        radius = radius,
                                        targetDistance = distance,
                                        targetLat = targetLat,
                                        targetLon = targetLon,
                                        visualOnlyBanner = false,
                                        visualBannerText = approachingMsg,
                                        is5Hz = false,
                                        playAudio = true
                                    )
                                )
                            }
                            continue
                        }

                        val activeEntryToastMsg = if (entryToastStart > 0L && now - entryToastStart < 10_000L) {
                            if (isEn) "Entered «\$title»" else "ورود به حصار مکانی «\$title»"
                        } else ""

                        if (!completedCycle && (distance <= centerZoneMeters || (fiveHzStart > 0L && distance <= centerZoneMeters + 6))) {
                            if (!armedForExit) {
                                armedForExit = true
                                editor.putBoolean(armedExitKey, true)
                                prefsModified = true
                            }
                            if (fiveHzStart == 0L) {
                                fiveHzStart = now
                                editor.putLong(fiveHzKey, now)
                                editor.putLong(phaseTransitionKey, now)
                                prefsModified = true
                            }
                            val centerMsg = if (isEn) "At center of «\$title»" else "در مرکز حصار مکانی «\$title»"
                            val elapsed5Hz = now - fiveHzStart
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
                                editor.putLong(phaseTransitionKey, now)
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
                        } else if (armedForExit && now - lastPhaseTrans >= 8_000L && distance > centerZoneMeters && isConfirmedExiting && !isMovingInward) {
                            if (fiveHzStart > 0L) {
                                editor.remove(fiveHzKey)
                                prefsModified = true
                            }
                            if (sonarDone && completedCycle) {
                                editor.putBoolean(sonarDoneKey, false)
                                editor.putBoolean(completedCycleKey, false)
                                sonarDone = false
                                completedCycle = false
                                prefsModified = true
                            }
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
                        } else if (!completedCycle && !sonarDone && !isConfirmedExiting && (isConfirmedEntering || isMovingInward || activeEntryToastMsg.isNotEmpty())) {
                            if (fiveHzStart > 0L) {
                                editor.remove(fiveHzKey)
                                prefsModified = true
                            }
                            val statusMsg = if (activeEntryToastMsg.isNotEmpty()) {
                                activeEntryToastMsg
                            } else {
                                if (isEn) "Entered «\$title»" else "ورود به حصار مکانی «\$title»"
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
                }
            }

            if (prefsModified) {
                editor.apply()
            }

            if (activeCandidates.isEmpty()) {
                wokenAlertPhaseSet.clear()
                if (sonarLoopActive) {
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

            // Always keep top candidate state cached so if the user switches to another app and locks the screen,
            // screenStateReceiver can immediately re-launch the full-screen lockscreen alert!
            activeGeofenceNotificationId = geofenceNotifId(topOverall.id)
            activeGeofenceItemId = topOverall.id
            activeGeofenceTitle = topOverall.title
            activeGeofenceDescription = topOverall.statusPhrase
            activeGeofenceCustomMessage = topOverall.visualBannerText
            activeGeofenceEventType = topOverall.eventType
            activeGeofenceRadius = topOverall.radius
            activeGeofenceLat = topOverall.targetLat
            activeGeofenceLon = topOverall.targetLon
            activeGeofenceIsEn = isEn
            liveSonarDistanceMeters = topOverall.distance
            liveSonarRadiusMeters = topOverall.radius

            // Mark any alert phase shown while the screen is ON so turning off the screen from the notification menu
            // NEVER wakes the screen back up or bounces back into Android!
            if (!screenOffOrLocked) {
                for (cand in activeCandidates) {
                    wokenAlertPhaseSet.add("\${cand.id}_\${cand.eventType}")
                }
            }

            // If app is in foreground AND screen is on/unlocked, WebView handles the in-app modal & WebAudio sonar
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

            val topBearingDeg = computeBearingDeg(
                topOverall.targetLat,
                topOverall.targetLon,
                location.latitude,
                location.longitude
            )
            activeGeofenceBearingDeg = topBearingDeg
            activeGeofenceSonarMode = topOverall.sonarMode

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
            val screenOffOrLocked = isScreenOffOrLocked()
            if (LocalNotificationsPlugin.isAppInForeground(this) && !screenOffOrLocked) {
                return
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
            val wakePhaseKey = "\${id}_\${eventType}"
            // Only wake the screen and launch full-screen popup ONCE when a brand-new alert phase starts
            // while the screen was ALREADY off/locked. Never re-wake if the alert was already active in the
            // notification menu and the user pressed Power to turn off the screen!
            val isFirstWakeForPhase = screenOffOrLocked && isTopPriority && wokenAlertPhaseSet.add(wakePhaseKey)

            if (isFirstWakeForPhase && !popupAlreadyShowing) {
                wakeScreenForLockscreenAlert()
            }

            val shouldPostNotif = if (screenOffOrLocked) {
                !popupAlreadyShowing
            } else {
                true
            }
            val shouldUseLiveUpdate = !isFirstWakeForPhase

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
                showFullScreen = isFirstWakeForPhase,
                postToStatusBar = shouldPostNotif,
                visualOnlyBanner = visualOnlyBanner,
                visualBannerText = visualBannerText,
                multiCardsJson = multiCardsJson
            )

            if (isFirstWakeForPhase && !popupAlreadyShowing) {
                YaadAlarmPopupActivity.launch(this, notificationId, sourceJsonStr, wakeScreenOnce = true)
            }
        } catch (e: Exception) {
        }
    }

    private fun wakeScreenForLockscreenAlert() {
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
            wl.acquire(7_000L)
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
        multiCardsJson: String = ""
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
        }
        val fullScreenPi = PendingIntent.getActivity(
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

        val directionsIntent = Intent(this, YaadAlarmPopupActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
            putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJsonStr)
            putExtra("yaad_direct_geofence_directions", true)
        }
        val directionsPi = PendingIntent.getActivity(
            this,
            notificationId + 400000,
            directionsIntent,
            piFlags
        )

        val editIntent = Intent(this, YaadAlarmPopupActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
            putExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, notificationId)
            putExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY, sourceJsonStr)
            putExtra("yaad_direct_geofence_edit", true)
        }
        val editPi = PendingIntent.getActivity(
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
            .setOnlyAlertOnce(isLiveUpdate)
            .setAutoCancel(true)
            .setGroup(GEOFENCE_MULTI_GROUP_KEY)
            .setDeleteIntent(stopPi)
            .setContentIntent(editPi)
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
            .addAction(
                0,
                if (isEn) "✎ Edit" else "✎ ویرایش",
                editPi
            )

        if (visualOnlyBanner) {
            builder.setTimeoutAfter(20_000L)
        }
        if (!isLiveUpdate) {
            builder.setVibrate(longArrayOf(0, 450, 180, 450))
        }
        if (showFullScreen) {
            builder.setFullScreenIntent(fullScreenPi, true)
        }

        val nmCompat = NotificationManagerCompat.from(this)
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
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val PREFS_NAME = "YAAD_GEOFENCE_PREFS"
        private const val KEY_ENABLED = "geofence_enabled"
        private const val KEY_LANGUAGE = "geofence_lang"
        private const val KEY_ITEMS_JSON = "geofence_items_json"
        private const val KEY_STOPPED_ITEMS_QUEUE = "geofence_stopped_items_queue"
        private const val RADAR_SERVICE_CHANNEL_ID = "yaad_geofence_radar_service_v1"
        private const val RADAR_FOREGROUND_NOTIFICATION_ID = 889911
        private const val GPS_WARNING_NOTIFICATION_ID = 889912
        private const val GEOFENCE_MULTI_GROUP_KEY = "YAAD_GEOFENCE_MULTI_GROUP"
        private const val GEOFENCE_GROUP_SUMMARY_ID = 889915
        const val ACTION_STOP_GEOFENCE_ALERT = "com.capacitorjs.plugins.localnotifications.STOP_GEOFENCE_ALERT"
        const val EXTRA_NOTIFICATION_ID = "extra_geofence_notif_id"
        const val EXTRA_GEOFENCE_ITEM_ID = "extra_geofence_item_id"

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
        private val wokenAlertPhaseSet = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

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
            list.add(WeightedSample(rawDistance, weight))
            while (list.size > 5) {
                list.removeAt(0)
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
        private var gpsWarningPosted: Boolean = false

        private var sonarThread: Thread? = null
        private var sonarWakeLock: PowerManager.WakeLock? = null

        fun isGeofenceAudioMuted(): Boolean = geofenceAudioMuted

        fun setGeofenceAudioMuteState(context: Context, muted: Boolean): Boolean {
            geofenceAudioMuted = muted
            if (geofenceAudioMuted) {
                sonarLoopActive = false
                try {
                    sonarThread?.interrupt()
                } catch (e: Exception) {
                }
                sonarThread = null
            } else if (activeGeofenceNotificationId != Int.MIN_VALUE && activeGeofenceEventType != "visual_banner") {
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
                    distanceHistoryMap.remove(itemId)
                    distanceHistoryMap.remove("loc_\$itemId")
                    distanceHistoryMap.remove("rem_\$itemId")
                    val suffixes = listOf(itemId, "loc_\$itemId", "rem_\$itemId")
                    for (sfx in suffixes) {
                        lastMoveRefDistMap.remove(sfx)
                        lastInwardMoveTimeMap.remove(sfx)
                        lastOutwardMoveTimeMap.remove(sfx)
                        minDistInsideMap.remove(sfx)
                        maxDistApproachMap.remove(sfx)
                        startedOutsideMap.remove(sfx)
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
                    }
                } else {
                    distanceHistoryMap.clear()
                    lastMoveRefDistMap.clear()
                    lastInwardMoveTimeMap.clear()
                    lastOutwardMoveTimeMap.clear()
                    minDistInsideMap.clear()
                    maxDistApproachMap.clear()
                    startedOutsideMap.clear()
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
                            key.startsWith("completed_cycle_")
                        ) {
                            editor.remove(key)
                        }
                    }
                }
                editor.apply()
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

                prefs.edit()
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

        fun pauseGeofenceItemTemporarily(
            context: Context,
            rawItemId: String,
            durationMs: Long = 20_000L,
            notificationIdToCancel: Int = Int.MIN_VALUE
        ) {
            val targetId = rawItemId.ifEmpty { activeGeofenceItemId }
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
            if (geofenceAudioMuted) return
            Thread {
                try {
                    if (geofenceAudioMuted) return@Thread
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
            if (geofenceAudioMuted) return
            val savedItemId = activeGeofenceItemId
            stopGeofenceAudio(context)
            activeGeofenceItemId = savedItemId
            liveSonarDistanceMeters = initialDistance
            liveSonarRadiusMeters = radius.coerceAtLeast(1)
            liveSonarMode = mode
            activeGeofenceNotificationId = notificationId
            sonarLoopActive = true
            acquireTemporaryWakeLock(context, 15 * 60_000L)

            val t = Thread {
                val sampleRate = 24000
                while (sonarLoopActive && !geofenceAudioMuted) {
                    var pingDurationMs = 450L
                    try {
                        val dist = liveSonarDistanceMeters
                        val rad = liveSonarRadiusMeters.coerceAtLeast(1)
                        val curMode = liveSonarMode
                        val pcmBuffer = synthesizeSonarPingPcm(dist, rad, sampleRate, curMode)
                        pingDurationMs = ((pcmBuffer.size.toLong() * 1000L) / sampleRate.toLong()) + 20L
                        if (!geofenceAudioMuted) {
                            playPcmBufferOnce(pcmBuffer, sampleRate)
                        }
                    } catch (ie: InterruptedException) {
                        break
                    } catch (e: Exception) {
                    }

                    var sleptMs = pingDurationMs
                    while (sonarLoopActive && !geofenceAudioMuted) {
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
            if (geofenceAudioMuted) return
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
                var activeItemStillPresent = false
                for (i in 0 until itemsArr.length()) {
                    val n = itemsArr.optJSONObject(i) ?: continue
                    val nid = n.optString("id", "")
                    if (nid.isEmpty()) continue
                    val sig = "\${n.optInt("radius", 200)}_\${n.optString("triggerOn", "enter")}_\${n.optDouble("latitude", 0.0)}_\${n.optDouble("longitude", 0.0)}_\${n.optString("title", "")}_\${n.optString("description", "")}_\${n.optString("customMessage", "")}"
                    if (!oldMap.containsKey(nid) || oldMap[nid] != sig) {
                        editor.remove("inside_\$nid")
                        editor.remove("armed_exit_\$nid")
                        editor.remove("sonar_done_\$nid")
                        editor.remove("u10m_\$nid")
                        editor.remove("last_trig_\$nid")
                        editor.remove("last_u10m_trig_\$nid")
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
                if (LocalNotificationsPlugin.isAppInForeground(appCtx) && activeGeofenceNotificationId != Int.MIN_VALUE) {
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
        fun resumeGeofenceItemFromPause(itemId: String) {
            resumeGeofenceItemFromPause(appContext, itemId)
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
  }
}

validateKotlinFiles(pluginDir);

console.log(
  `[patch-capacitor-notifications] Successfully patched and verified @capacitor/local-notifications@${pluginVersion} (with YaadAlarmPopupActivity, YaadGeofenceService & Kotlin syntax check).`
);

