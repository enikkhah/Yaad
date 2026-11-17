import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const androidDir = path.join(rootDir, 'android');

if (!fs.existsSync(androidDir)) {
  console.error('❌ android directory not found. Run `npx cap add android` first.');
  process.exit(1);
}

// 1. Patch android/build.gradle (Root Gradle: Kotlin plugin + JitPack repository)
const rootGradlePath = path.join(androidDir, 'build.gradle');
if (fs.existsSync(rootGradlePath)) {
  let content = fs.readFileSync(rootGradlePath, 'utf8');

  if (!content.includes('kotlin-gradle-plugin')) {
    content = content.replace(
      /dependencies\s*\{/,
      `ext.kotlin_version = project.hasProperty('kotlin_version') ? rootProject.ext.kotlin_version : '2.0.21'\n    dependencies {\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"`
    );
  }

  if (!content.includes('https://jitpack.io')) {
    content = content.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      `allprojects {\n    repositories {\n        maven { url 'https://jitpack.io' }`
    );
  }

  fs.writeFileSync(rootGradlePath, content, 'utf8');
  console.log('✅ Patched android/build.gradle with Kotlin 2.0.21 & JitPack');
}

// 2. Patch android/app/build.gradle (Apply kotlin-android, jvmToolchain(21), manifestPlaceholders, and Myket Billing Client 1.19)
const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
if (fs.existsSync(appGradlePath)) {
  let content = fs.readFileSync(appGradlePath, 'utf8');

  if (!content.includes("apply plugin: 'kotlin-android'") && !content.includes('org.jetbrains.kotlin.android')) {
    content = content.replace(
      "apply plugin: 'com.android.application'",
      "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'"
    );
  }

  if (!content.includes('marketApplicationId')) {
    content = content.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {\n        def marketApplicationId = "ir.mservices.market"\n        def marketBindAddress = "ir.mservices.market.InAppBillingService.BIND"\n        manifestPlaceholders = [\n            marketApplicationId: "\${marketApplicationId}",\n            marketBindAddress  : "\${marketBindAddress}",\n            marketPermission   : "\${marketApplicationId}.BILLING"\n        ]`
    );
  }

  if (!content.includes('jvmToolchain(21)')) {
    content += `\nkotlin {\n    jvmToolchain(21)\n}\n`;
  }

  if (!content.includes('com.github.myketstore:myket-billing-client')) {
    content = content.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation("com.github.myketstore:myket-billing-client:1.19") {\n        exclude group: "com.google.android.gms", module: "play-services-ads-identifier"\n    }`
    );
  }

  fs.writeFileSync(appGradlePath, content, 'utf8');
  console.log('✅ Patched android/app/build.gradle with Myket Billing Client 1.19, manifestPlaceholders & Kotlin Android');
}

// 3. Patch android/app/src/main/AndroidManifest.xml (Myket billing permission, remove AD_ID if transitive, & <queries>)
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let content = fs.readFileSync(manifestPath, 'utf8');

  if (!content.includes('xmlns:tools=')) {
    content = content.replace(
      '<manifest ',
      '<manifest xmlns:tools="http://schemas.android.com/tools" '
    );
  }

  const myketPerm = 'ir.mservices.market.BILLING';
  if (!content.includes(myketPerm)) {
    content = content.replace(
      '<application',
      `<uses-permission android:name="${myketPerm}" />\n    <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />\n\n    <application`
    );
  }

  if (!content.includes('ir.mservices.market.InAppBillingService.BIND')) {
    const queriesBlock = `<queries>
        <package android:name="ir.mservices.market" />
        <intent>
            <action android:name="ir.mservices.market.InAppBillingService.BIND" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="myket" />
        </intent>
    </queries>\n\n    <application`;
    content = content.replace('<application', queriesBlock);
  }

  fs.writeFileSync(manifestPath, content, 'utf8');
  console.log('✅ Patched AndroidManifest.xml with ir.mservices.market.BILLING permission and <queries>');
}

// 4. Write MyketBillingPlugin.kt and MainActivity.kt (and remove MainActivity.java)
const javaPkgDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'yaad', 'reminder');
fs.mkdirSync(javaPkgDir, { recursive: true });

const oldMainActivityJava = path.join(javaPkgDir, 'MainActivity.java');
if (fs.existsSync(oldMainActivityJava)) {
  fs.unlinkSync(oldMainActivityJava);
  console.log('✅ Removed default MainActivity.java');
}

const pluginKtContent = `package com.yaad.reminder

import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import ir.myket.billingclient.IabHelper
import ir.myket.billingclient.util.Purchase
import java.util.LinkedList
import java.util.Queue

@CapacitorPlugin(name = "MyketBilling")
class MyketBillingPlugin : Plugin() {

    private var iabHelper: IabHelper? = null
    private var isSetupDone: Boolean = false
    private var currentRsaKey: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val operationQueue: Queue<(() -> Unit) -> Unit> = LinkedList()
    private var isOperationRunning: Boolean = false

    @Synchronized
    private fun enqueueOperation(task: (onDone: () -> Unit) -> Unit) {
        operationQueue.add(task)
        if (!isOperationRunning) {
            runNextOperation()
        }
    }

    @Synchronized
    private fun runNextOperation() {
        val next = operationQueue.poll()
        if (next == null) {
            isOperationRunning = false
            return
        }
        isOperationRunning = true
        mainHandler.post {
            try {
                next {
                    runNextOperation()
                }
            } catch (_: Exception) {
                runNextOperation()
            }
        }
    }

    private fun extractRequestedSkus(call: PluginCall): List<String> {
        val list = mutableListOf<String>()
        val arr = call.getArray("productIds")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val sku = arr.optString(i, "").trim()
                if (sku.isNotEmpty() && !list.contains(sku)) {
                    list.add(sku)
                }
            }
        }
        val single = call.getString("productId")?.trim()
        if (!single.isNullOrEmpty() && !list.contains(single)) {
            list.add(single)
        }
        return list
    }

    private fun ensureReady(
        rsaPublicKey: String?,
        onReady: (IabHelper) -> Unit,
        onError: (String, String, Throwable?) -> Unit
    ) {
        val cleanKey = rsaPublicKey?.trim()
        if (cleanKey.isNullOrEmpty()) {
            onError(
                "کلید امضای پرداخت مایکت (RSA) در این بیلد تنظیم نشده است.",
                "MISSING_RSA_KEY",
                null
            )
            return
        }

        val existing = iabHelper
        if (existing != null && isSetupDone && currentRsaKey == cleanKey) {
            onReady(existing)
            return
        }

        try {
            existing?.dispose()
        } catch (_: Exception) {
        }
        iabHelper = null
        isSetupDone = false

        try {
            val helper = IabHelper(context, cleanKey)
            iabHelper = helper
            currentRsaKey = cleanKey
            helper.startSetup(IabHelper.OnIabSetupFinishedListener { result ->
                if (result == null || !result.isSuccess) {
                    isSetupDone = false
                    onError(
                        "ارتباط با سرویس پرداخت مایکت برقرار نشد. مطمئن شوید برنامه مایکت روی گوشی نصب است و وارد حساب کاربری خود شده‌اید.",
                        "CONNECTION_FAILED",
                        null
                    )
                    return@OnIabSetupFinishedListener
                }
                isSetupDone = true
                onReady(helper)
            })
        } catch (e: Exception) {
            isSetupDone = false
            onError(
                "خطا در راه‌اندازی سرویس پرداخت مایکت: \${e.localizedMessage ?: "خطای نامشخص"}",
                "CONNECTION_FAILED",
                e
            )
        }
    }

    @PluginMethod
    fun querySkuDetails(call: PluginCall) {
        val skuIds = extractRequestedSkus(call)
        if (skuIds.isEmpty()) {
            val emptyRes = JSObject()
            emptyRes.put("skuDetails", JSArray())
            call.resolve(emptyRes)
            return
        }

        val rsaPublicKey = call.getString("rsaPublicKey")?.trim()
        enqueueOperation { onDone ->
            ensureReady(
                rsaPublicKey = rsaPublicKey,
                onReady = { helper ->
                    try {
                        helper.queryInventoryAsync(
                            true,
                            skuIds,
                            IabHelper.QueryInventoryFinishedListener { queryResult, inventory ->
                                try {
                                    if (queryResult == null || queryResult.isFailure || inventory == null) {
                                        call.reject(
                                            "خطا در دریافت قیمت محصولات از مایکت: \${queryResult?.message ?: "خطای نامشخص"}",
                                            "SKU_QUERY_FAILED"
                                        )
                                        return@QueryInventoryFinishedListener
                                    }
                                    val items = JSArray()
                                    for (sku in skuIds) {
                                        val detail = inventory.getSkuDetails(sku)
                                        if (detail != null) {
                                            val obj = JSObject()
                                            obj.put("sku", detail.sku)
                                            obj.put("title", detail.title)
                                            obj.put("price", detail.price)
                                            obj.put("description", detail.description)
                                            items.put(obj)
                                        }
                                    }
                                    val res = JSObject()
                                    res.put("skuDetails", items)
                                    call.resolve(res)
                                } finally {
                                    onDone()
                                }
                            }
                        )
                    } catch (e: Exception) {
                        call.reject("خطا در استعلام قیمت محصولات مایکت", "SKU_QUERY_FAILED", e)
                        onDone()
                    }
                },
                onError = { message, code, throwable ->
                    call.reject(message, code, throwable?.let { Exception(it) })
                    onDone()
                }
            )
        }
    }

    @PluginMethod
    fun purchasePro(call: PluginCall) {
        val productId = call.getString("productId")?.trim()
        if (productId.isNullOrEmpty()) {
            call.reject("شناسه محصول (productId) مشخص نشده است.")
            return
        }

        val rsaPublicKey = call.getString("rsaPublicKey")?.trim()
        val payload = call.getString("payload") ?: ""
        val hostActivity = activity
        if (hostActivity == null || hostActivity.isFinishing) {
            call.reject("Activity در دسترس نیست.")
            return
        }

        enqueueOperation { onDone ->
            ensureReady(
                rsaPublicKey = rsaPublicKey,
                onReady = { helper ->
                    hostActivity.runOnUiThread {
                        try {
                            helper.launchPurchaseFlow(
                                hostActivity,
                                productId,
                                IabHelper.OnIabPurchaseFinishedListener { result, purchase ->
                                    if (result == null || result.isFailure || purchase == null) {
                                        if (result?.response == IabHelper.IABHELPER_USER_CANCELLED ||
                                            result?.response == IabHelper.BILLING_RESPONSE_RESULT_USER_CANCELED
                                        ) {
                                            call.reject(
                                                "کاربر از ادامه پرداخت انصراف داد.",
                                                "PURCHASE_CANCELLED"
                                            )
                                            onDone()
                                        } else {
                                            try {
                                                helper.queryInventoryAsync(
                                                    false,
                                                    listOf(productId),
                                                    IabHelper.QueryInventoryFinishedListener { qRes, inventory ->
                                                        try {
                                                            val existing =
                                                                if (qRes != null && qRes.isSuccess && inventory != null)
                                                                    inventory.getPurchase(productId)
                                                                else null
                                                            if (existing != null && existing.purchaseState == 0) {
                                                                call.resolve(buildPurchaseResult(existing, "ALREADY_OWNED"))
                                                            } else {
                                                                call.reject(
                                                                    "پرداخت انجام نشد: \${result?.message ?: "خطای تراکنش"}",
                                                                    "PURCHASE_FAILED"
                                                                )
                                                            }
                                                        } finally {
                                                            onDone()
                                                        }
                                                    }
                                                )
                                            } catch (_: Exception) {
                                                call.reject(
                                                    "پرداخت انجام نشد: \${result?.message ?: "خطای تراکنش"}",
                                                    "PURCHASE_FAILED"
                                                )
                                                onDone()
                                            }
                                        }
                                        return@OnIabPurchaseFinishedListener
                                    }

                                    try {
                                        if (purchase.purchaseState == 0) {
                                            call.resolve(buildPurchaseResult(purchase, "PURCHASED"))
                                        } else {
                                            call.reject(
                                                "تراکنش خرید در وضعیت معتبر قرار ندارد (لغو یا بازپرداخت شده است).",
                                                "PURCHASE_INVALID_STATE"
                                            )
                                        }
                                    } finally {
                                        onDone()
                                    }
                                },
                                payload
                            )
                        } catch (e: Exception) {
                            call.reject(
                                "خطا در باز کردن پنجره پرداخت مایکت: \${e.localizedMessage ?: "خطای نامشخص"}",
                                "FLOW_FAILED",
                                e
                            )
                            onDone()
                        }
                    }
                },
                onError = { message, code, throwable ->
                    call.reject(message, code, throwable?.let { Exception(it) })
                    onDone()
                }
            )
        }
    }

    @PluginMethod
    fun checkProOwnership(call: PluginCall) {
        val requestedSkus = extractRequestedSkus(call)
        if (requestedSkus.isEmpty()) {
            call.reject("شناسه محصول (productIds) مشخص نشده است.")
            return
        }

        val rsaPublicKey = call.getString("rsaPublicKey")?.trim()
        enqueueOperation { onDone ->
            ensureReady(
                rsaPublicKey = rsaPublicKey,
                onReady = { helper ->
                    try {
                        helper.queryInventoryAsync(
                            false,
                            requestedSkus,
                            IabHelper.QueryInventoryFinishedListener { queryResult, inventory ->
                                try {
                                    if (queryResult == null || queryResult.isFailure || inventory == null) {
                                        call.reject(
                                            "خطا در استعلام سوابق خرید از مایکت: \${queryResult?.message ?: "خطای نامشخص"}",
                                            "QUERY_FAILED"
                                        )
                                        return@QueryInventoryFinishedListener
                                    }

                                    val activePurchases = mutableListOf<Purchase>()
                                    val purchasesArr = JSArray()
                                    val revokedArr = JSArray()
                                    for (sku in requestedSkus) {
                                        val purchase = inventory.getPurchase(sku)
                                        if (purchase != null) {
                                            if (purchase.purchaseState == 0) {
                                                activePurchases.add(purchase)
                                                purchasesArr.put(buildPurchaseResult(purchase, "PURCHASED"))
                                            } else {
                                                revokedArr.put(sku)
                                            }
                                        }
                                    }

                                    val primary = activePurchases.firstOrNull()
                                    if (primary != null) {
                                        val result = buildPurchaseResult(primary, "PURCHASED")
                                        result.put("isProOwned", true)
                                        result.put("purchases", purchasesArr)
                                        result.put("revokedProductIds", revokedArr)
                                        call.resolve(result)
                                    } else {
                                        val result = JSObject()
                                        result.put("isProOwned", false)
                                        result.put("status", "NOT_PURCHASED")
                                        result.put("purchases", JSArray())
                                        result.put("revokedProductIds", revokedArr)
                                        call.resolve(result)
                                    }
                                } finally {
                                    onDone()
                                }
                            }
                        )
                    } catch (e: Exception) {
                        call.reject("خطا در استعلام سوابق خرید از مایکت", "QUERY_FAILED", e)
                        onDone()
                    }
                },
                onError = { message, code, throwable ->
                    call.reject(message, code, throwable?.let { Exception(it) })
                    onDone()
                }
            )
        }
    }

    @PluginMethod
    fun consumePurchase(call: PluginCall) {
        val purchaseToken = call.getString("purchaseToken")?.trim() ?: ""
        val productId = call.getString("productId")?.trim() ?: ""
        if (purchaseToken.isEmpty() && productId.isEmpty()) {
            call.reject("شناسه محصول یا توکن خرید برای مصرف مشخص نشده است.", "MISSING_TOKEN")
            return
        }

        val rsaPublicKey = call.getString("rsaPublicKey")?.trim()
        val querySkus = if (productId.isNotEmpty()) listOf(productId) else emptyList()
        enqueueOperation { onDone ->
            ensureReady(
                rsaPublicKey = rsaPublicKey,
                onReady = { helper ->
                    try {
                        helper.queryInventoryAsync(
                            false,
                            querySkus,
                            IabHelper.QueryInventoryFinishedListener { queryResult, inventory ->
                                if (queryResult == null || queryResult.isFailure || inventory == null) {
                                    call.reject(
                                        "خطا در یافتن خرید برای مصرف در مایکت: \${queryResult?.message ?: "خطای نامشخص"}",
                                        "CONSUME_QUERY_FAILED"
                                    )
                                    onDone()
                                    return@QueryInventoryFinishedListener
                                }

                                val targetPurchase: Purchase? =
                                    (if (productId.isNotEmpty()) inventory.getPurchase(productId) else null)
                                        ?: inventory.allPurchases?.firstOrNull { p ->
                                            (purchaseToken.isNotEmpty() && p.token == purchaseToken) ||
                                                (productId.isNotEmpty() && p.sku == productId)
                                        }

                                if (targetPurchase == null) {
                                    val res = JSObject()
                                    res.put("consumed", true)
                                    res.put("alreadyConsumed", true)
                                    call.resolve(res)
                                    onDone()
                                    return@QueryInventoryFinishedListener
                                }

                                try {
                                    helper.consumeAsync(
                                        targetPurchase,
                                        IabHelper.OnConsumeFinishedListener { _, consumeRes ->
                                            try {
                                                if (consumeRes != null && consumeRes.isSuccess) {
                                                    val res = JSObject()
                                                    res.put("consumed", true)
                                                    res.put("purchaseToken", targetPurchase.token ?: purchaseToken)
                                                    res.put("productId", targetPurchase.sku ?: productId)
                                                    call.resolve(res)
                                                } else {
                                                    call.reject(
                                                        "مصرف خرید در مایکت انجام نشد: \${consumeRes?.message ?: "خطای نامشخص"}",
                                                        "CONSUME_FAILED"
                                                    )
                                                }
                                            } finally {
                                                onDone()
                                            }
                                        }
                                    )
                                } catch (e: Exception) {
                                    call.reject("خطا در اجرای consumeAsync مایکت", "CONSUME_FAILED", e)
                                    onDone()
                                }
                            }
                        )
                    } catch (e: Exception) {
                        call.reject("خطا در استعلام خرید جهت مصرف در مایکت", "CONSUME_FAILED", e)
                        onDone()
                    }
                },
                onError = { message, code, throwable ->
                    call.reject(message, code, throwable?.let { Exception(it) })
                    onDone()
                }
            )
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        try {
            iabHelper?.dispose()
            iabHelper = null
            isSetupDone = false
            call.resolve()
        } catch (e: Exception) {
            call.reject("خطا در قطع اتصال مایکت", e)
        }
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
    }

    override fun handleOnDestroy() {
        try {
            iabHelper?.dispose()
            iabHelper = null
            isSetupDone = false
        } catch (_: Exception) {
        }
        super.handleOnDestroy()
    }

    private fun buildPurchaseResult(info: Purchase, status: String): JSObject {
        return JSObject().apply {
            put("status", status)
            put("orderId", info.orderId ?: "")
            put("purchaseToken", info.token ?: "")
            put("payload", info.developerPayload ?: "")
            put("packageName", info.packageName ?: "")
            put("purchaseTime", info.purchaseTime)
            put("purchaseState", if (info.purchaseState == 0) "PURCHASED" else "REFUNDED")
            put("dataSignature", info.signature ?: "")
            put("productId", info.sku ?: "")
        }
    }
}
`;

const mainActivityKtContent = `package com.yaad.reminder

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // فعال‌سازی دیباگ WebView فقط در نسخه دیباگ و غیرفعال‌سازی قطعی در release
        val isDebuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(isDebuggable)
        // ثبت پلاگین پرداخت درون‌برنامه‌ای مایکت قبل از super.onCreate
        registerPlugin(MyketBillingPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
`;

fs.writeFileSync(path.join(javaPkgDir, 'MyketBillingPlugin.kt'), pluginKtContent, 'utf8');
fs.writeFileSync(path.join(javaPkgDir, 'MainActivity.kt'), mainActivityKtContent, 'utf8');
console.log('✅ Created MyketBillingPlugin.kt and MainActivity.kt');
