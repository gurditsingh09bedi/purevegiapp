# Customer messages: how to switch each one on

Every order and booking update goes out on every channel that is switched on.
The staff app shows what is on under **Settings → Customer messages**, with a **Send test** button.

All settings go in `backend/.env` (in Codespaces: open the file, add the lines, then run
`bash .devcontainer/start.sh` again). On the live server they go in its environment settings.

| Channel | Cost | Needs |
|---|---|---|
| Phone app notifications | Free | Nothing. Customers using the Pure Vegi app get them. |
| Browser notifications | Free | Keys, made automatically in Codespaces. |
| Email | Free | A mailbox login (Gmail or your domain's email). |
| SMS | Your phone plan | An Android phone at the restaurant with the SMS Gate app. |
| WhatsApp | Free | Nothing. Staff tap the green WhatsApp button. |

## Browser notifications (website)

Customers tap **Turn on notifications** on their booking or order page. They then get the updates
even when the website is closed: Chrome, Edge, Firefox, Android. On iPhone it works after they
add the site to the Home Screen (iOS 16.4 or newer).

Keys: Codespaces makes them on first start. Anywhere else, run once in `backend/`:

```
python -m app.vapid >> .env
```

Keep the same keys forever. New keys would switch off everyone who already said yes.

## Email

With Gmail:

1. Turn on 2-Step Verification on the Google account.
2. Google Account → Security → **App passwords** → create one called "Pure Vegi".
3. Add to `backend/.env`:

```
PV_SMTP_HOST=smtp.gmail.com
PV_SMTP_PORT=587
PV_SMTP_USER=yourname@gmail.com
PV_SMTP_PASSWORD=the 16-letter app password
PV_SMTP_FROM=Pure Vegi <yourname@gmail.com>
```

With your own domain's email (after buying the domain), use the SMTP details your email host gives you.

## SMS from the restaurant's own phone

1. On an Android phone with a SIM and unlimited texts, install **SMS Gate**
   (Google Play, or https://github.com/capcom6/android-sms-gateway).
2. Open it, switch on **Cloud Server**, tap **Offline** so it changes to **Online**.
3. A username and password appear in the Cloud Server section. Add them to `backend/.env`:

```
PV_SMS_PROVIDER=android
PV_SMSGATE_USER=the username
PV_SMSGATE_PASSWORD=the password
```

Keep the phone charging, on Wi-Fi or mobile data, and turn off battery saving for SMS Gate.
Texts come from the restaurant's own number.

(Twilio still works instead: fill in the `PV_TWILIO_...` lines and leave `PV_SMS_PROVIDER` empty.)

## WhatsApp

Nothing to set up. In the staff app:

* **Bookings**: every booking has a green **WhatsApp** button that opens a chat with that customer.
* **Accept / Decline / Message**: the **+ WhatsApp** button sends the text and email as usual,
  and also opens WhatsApp with the same message typed in. Staff just press Send.
* **Deliveries**: the driver can WhatsApp the customer.

It opens WhatsApp on the device being used (phone app, or WhatsApp Web on a computer).

## Links in messages

Set the website address so texts and emails link to the customer's booking or order page:

```
PV_SITE_URL=https://purevegi.co.uk
```
