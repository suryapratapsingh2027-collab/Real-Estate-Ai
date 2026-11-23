# WhatsApp Cloud API setup

1. In [Meta for Developers](https://developers.facebook.com/), create an app of type **Business** and add the **WhatsApp** product.
2. From **WhatsApp → API Setup**, note the **Phone number ID**. Create a **System User** access token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions (temporary tokens expire in 24 h).
3. From **App settings → Basic**, copy the **App secret** (used to verify webhook signatures).
4. Choose a random **verify token** string.
5. Set these in `.env` (or **Settings → Integrations → WhatsApp**):
   ```
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_APP_SECRET=...
   WHATSAPP_VERIFY_TOKEN=...
   WHATSAPP_GRAPH_VERSION=v22.0   # use the current Graph API version
   ```
6. In **WhatsApp → Configuration → Webhook**, set the callback URL to `https://<your-domain>/api/webhooks/whatsapp` and the verify token from step 4. Subscribe to the **messages** field.
7. Press **Test** on the Integrations page; it calls `GET /{phone-number-id}` and shows the verified name.

## How the webhook is handled
- `GET` — compares `hub.verify_token` in constant time and echoes `hub.challenge`.
- `POST` — rejects any request whose `X-Hub-Signature-256` is not a valid HMAC-SHA256 of the raw body with the app secret. Then:
  - **Statuses** (`sent/delivered/read/failed`) update the matching message or notification; statuses never regress.
  - **Messages** are recorded in an idempotency ledger by WhatsApp message id (duplicate deliveries are ignored), stored, and queued for AI processing. The webhook returns `200` immediately.

## 24-hour window and templates
Free-form replies are allowed within 24 h of the customer's last message. Broker notifications and follow-up reminders are *business-initiated*; if a broker hasn't messaged your number recently, WhatsApp requires an **approved template**. Create a utility template with one body variable (e.g. `{{1}}`) and set on the integration:

- `brokerTemplateName` — used for new/reassigned lead notifications
- `reminderTemplateName` — used for follow-up reminders
- `brokerTemplateLanguage` — e.g. `en`

The full notification text is passed as `{{1}}`. Without templates, plain text is attempted and delivery failures are visible under **Notifications → WhatsApp delivery log**.

Human agents can reply from the inbox only while the window is open.
