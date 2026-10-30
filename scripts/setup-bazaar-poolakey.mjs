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

// 2. Patch android/app/build.gradle (Apply kotlin-android, jvmToolchain(21), and Poolakey 2.2.0)
const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
if (fs.existsSync(appGradlePath)) {
  let content = fs.readFileSync(appGradlePath, 'utf8');

  if (!content.includes("apply plugin: 'kotlin-android'") && !content.includes('org.jetbrains.kotlin.android')) {
    content = content.replace(
      "apply plugin: 'com.android.application'",
      "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'"
    );
  }

  if (!content.includes('jvmToolchain(21)')) {
    content += `\nkotlin {\n    jvmToolchain(21)\n}\n`;
  }

  if (!content.includes('com.github.cafebazaar.Poolakey:poolakey')) {
    content = content.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation "com.github.cafebazaar.Poolakey:poolakey:2.2.0"`
    );
  }

  fs.writeFileSync(appGradlePath, content, 'utf8');
  console.log('✅ Patched android/app/build.gradle with Poolakey 2.2.0 & Kotlin Android');
}

// 3. Patch android/app/src/main/AndroidManifest.xml (Bazaar permission & Android 11+ package visibility queries)
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let content = fs.readFileSync(manifestPath, 'utf8');

  const bazaarPerm = 'com.farsitel.bazaar.permission.PAY_THROUGH_BAZAAR';
  if (!content.includes(bazaarPerm)) {
    content = content.replace(
      '<application',
      `<uses-permission android:name="${bazaarPerm}" />\n\n    <application`
    );
  }

  if (!content.includes('ir.cafebazaar.pardakht.InAppBillingService.BIND')) {
    const queriesBlock = `<queries>
        <package android:name="com.farsitel.bazaar" />
        <package android:name="ir.mservices.market" />
        <intent>
            <action android:name="ir.cafebazaar.pardakht.InAppBillingService.BIND" />
            <data android:scheme="bazaar" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="bazaar" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="myket" />
        </intent>
    </queries>\n\n    <application`;
    content = content.replace('<application', queriesBlock);
  }

  fs.writeFileSync(manifestPath, content, 'utf8');
  console.log('✅ Patched AndroidManifest.xml with PAY_THROUGH_BAZAAR permission and <queries>');
}

// 4. Write BazaarBillingPlugin.kt and MainActivity.kt (and remove MainActivity.java)
const javaPkgDir = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'yaad', 'reminder');
fs.mkdirSync(javaPkgDir, { recursive: true });

const oldMainActivityJava = path.join(javaPkgDir, 'MainActivity.java');
if (fs.existsSync(oldMainActivityJava)) {
  fs.unlinkSync(oldMainActivityJava);
  console.log('✅ Removed default MainActivity.java');
}

const pluginKtContent = `package com.yaad.reminder

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.ConnectionState
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.entity.PurchaseInfo
import ir.cafebazaar.poolakey.request.PurchaseRequest

@CapacitorPlugin(name = "BazaarBilling")
class BazaarBillingPlugin : Plugin() {

    private var payment: Payment? = null
    private var paymentConnection: Connection? = null
    private var currentRsaKey: String? = null

    private fun ensureConnected(
        rsaPublicKey: String?,
        onReady: (Payment) -> Unit,
        onError: (String, Throwable?) -> Unit
    ) {
        val currentPayment = payment
        val currentConnection = paymentConnection

        if (
            currentPayment != null &&
            currentConnection != null &&
            currentConnection.getState() == ConnectionState.Connected &&
            currentRsaKey == rsaPublicKey
        ) {
            onReady(currentPayment)
            return
        }

        try {
            currentConnection?.disconnect()
        } catch (_: Exception) {
        }

        val securityCheck = if (!rsaPublicKey.isNullOrBlank()) {
            SecurityCheck.Enable(rsaPublicKey = rsaPublicKey.trim())
        } else {
            SecurityCheck.Disable
        }

        val paymentConfig = PaymentConfiguration(localSecurityCheck = securityCheck)
        val newPayment = Payment(context = context, config = paymentConfig)
        payment = newPayment
        currentRsaKey = rsaPublicKey

        paymentConnection = newPayment.connect {
            connectionSucceed {
                onReady(newPayment)
            }
            connectionFailed { throwable ->
                onError(
                    "ارتباط با سرویس پرداخت کافه‌بازار برقرار نشد. مطمئن شوید برنامه کافه‌بازار روی گوشی نصب است و وارد حساب کاربری خود شده‌اید.",
                    throwable
                )
            }
            disconnected {
                // اتصال قطع شد
            }
        }
    }

    /**
     * باز کردن مستقیم پنجره پرداخت و ورود کد تخفیف کافه‌بازار (برای خرید یک‌باره و غیرمصرفی نسخه Pro)
     * نکته: برای محصولات غیرمصرفی (Non-Consumable) متد consumeProduct فراخوانی نمی‌شود تا مالکیت دائمی بماند.
     */
    @PluginMethod
    fun purchasePro(call: PluginCall) {
        val productId = call.getString("productId")?.trim()
        if (productId.isNullOrEmpty()) {
            call.reject("شناسه محصول (productId) مشخص نشده است.")
            return
        }

        val rsaPublicKey = call.getString("rsaPublicKey")?.trim()
        val payload = call.getString("payload") ?: ""
        val dynamicPriceToken = call.getString("dynamicPriceToken")?.takeIf { it.isNotBlank() }

        val hostActivity = activity
        if (hostActivity == null || hostActivity.isFinishing) {
            call.reject("Activity در دسترس نیست.")
            return
        }

        ensureConnected(
            rsaPublicKey = rsaPublicKey,
            onReady = { activePayment ->
                hostActivity.runOnUiThread {
                    val purchaseRequest = PurchaseRequest(
                        productId = productId,
                        payload = payload,
                        dynamicPriceToken = dynamicPriceToken
                    )

                    activePayment.purchaseProduct(
                        registry = hostActivity.activityResultRegistry,
                        request = purchaseRequest
                    ) {
                        purchaseFlowBegan {
                            // پنجره کافه‌بازار (شامل قیمت، انتخاب درگاه و بخش ورود کد تخفیف) باز شد
                        }
                        failedToBeginFlow { throwable ->
                            call.reject(
                                "خطا در باز کردن پنجره پرداخت کافه‌بازار: \${throwable.localizedMessage ?: "خطای نامشخص"}",
                                "FLOW_FAILED",
                                Exception(throwable)
                            )
                        }
                        purchaseSucceed { purchaseInfo ->
                            call.resolve(buildPurchaseResult(purchaseInfo, "PURCHASED"))
                        }
                        purchaseCanceled {
                            call.reject(
                                "کاربر از ادامه پرداخت انصراف داد.",
                                "PURCHASE_CANCELLED"
                            )
                        }
                        purchaseFailed { throwable ->
                            // اگر کاربر قبلاً این محصول غیرمصرفی را خریده باشد، مالکیت را استعلام می‌کنیم
                            activePayment.getPurchasedProducts {
                                querySucceed { purchasedList ->
                                    val existing = purchasedList.firstOrNull { it.productId == productId }
                                    if (existing != null) {
                                        call.resolve(buildPurchaseResult(existing, "ALREADY_OWNED"))
                                    } else {
                                        call.reject(
                                            "پرداخت انجام نشد: \${throwable.localizedMessage ?: "خطای تراکنش"}",
                                            "PURCHASE_FAILED",
                                            Exception(throwable)
                                        )
                                    }
                                }
                                queryFailed {
                                    call.reject(
                                        "پرداخت انجام نشد: \${throwable.localizedMessage ?: "خطای تراکنش"}",
                                        "PURCHASE_FAILED",
                                        Exception(throwable)
                                    )
                                }
                            }
                        }
                    }
                }
            },
            onError = { message, throwable ->
                call.reject(message, "CONNECTION_FAILED", throwable?.let { Exception(it) })
            }
        )
    }

    /**
     * بررسی و بازیابی خرید نسخه Pro از کافه‌بازار (در زمان اجرای اپ یا نصب مجدد روی گوشی جدید)
     */
    @PluginMethod
    fun checkProOwnership(call: PluginCall) {
        val productId = call.getString("productId")?.trim()
        if (productId.isNullOrEmpty()) {
            call.reject("شناسه محصول (productId) مشخص نشده است.")
            return
        }

        val rsaPublicKey = call.getString("rsaPublicKey")?.trim()

        ensureConnected(
            rsaPublicKey = rsaPublicKey,
            onReady = { activePayment ->
                activePayment.getPurchasedProducts {
                    querySucceed { purchasedList ->
                        val ownedProduct = purchasedList.firstOrNull { it.productId == productId }
                        if (ownedProduct != null) {
                            val result = buildPurchaseResult(ownedProduct, "PURCHASED")
                            result.put("isProOwned", true)
                            call.resolve(result)
                        } else {
                            val result = JSObject()
                            result.put("isProOwned", false)
                            result.put("status", "NOT_PURCHASED")
                            call.resolve(result)
                        }
                    }
                    queryFailed { throwable ->
                        call.reject(
                            "خطا در استعلام سوابق خرید از کافه‌بازار: \${throwable.localizedMessage ?: "خطای نامشخص"}",
                            "QUERY_FAILED",
                            Exception(throwable)
                        )
                    }
                }
            },
            onError = { message, throwable ->
                call.reject(message, "CONNECTION_FAILED", throwable?.let { Exception(it) })
            }
        )
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        try {
            paymentConnection?.disconnect()
            paymentConnection = null
            payment = null
            call.resolve()
        } catch (e: Exception) {
            call.reject("خطا در قطع اتصال کافه‌بازار", e)
        }
    }

    override fun handleOnDestroy() {
        try {
            paymentConnection?.disconnect()
            paymentConnection = null
            payment = null
        } catch (_: Exception) {
        }
        super.handleOnDestroy()
    }

    private fun buildPurchaseResult(info: PurchaseInfo, status: String): JSObject {
        return JSObject().apply {
            put("status", status)
            put("orderId", info.orderId)
            put("purchaseToken", info.purchaseToken)
            put("payload", info.payload)
            put("packageName", info.packageName)
            put("purchaseTime", info.purchaseTime)
            put("purchaseState", info.purchaseState.name)
            put("dataSignature", info.dataSignature)
            put("productId", info.productId)
        }
    }
}
`;

const mainActivityKtContent = `package com.yaad.reminder

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // ثبت پلاگین پرداخت درون‌برنامه‌ای کافه‌بازار (پولاکی) قبل از super.onCreate
        registerPlugin(BazaarBillingPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
`;

fs.writeFileSync(path.join(javaPkgDir, 'BazaarBillingPlugin.kt'), pluginKtContent, 'utf8');
fs.writeFileSync(path.join(javaPkgDir, 'MainActivity.kt'), mainActivityKtContent, 'utf8');
console.log('✅ Created BazaarBillingPlugin.kt and MainActivity.kt');
