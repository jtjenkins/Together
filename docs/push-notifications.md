# Push Notifications Setup

Together supports push notifications via three transports:
- **Web Push (VAPID)** — browsers and PWAs (always enabled when keys are configured)
- **FCM** — Android (via Firebase Cloud Messaging, optional)
- **APNs** — iOS (via Apple Push Notification service, optional)

## VAPID Keys (Web Push — required for browser notifications)

Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

Set in your environment:
```
VAPID_PRIVATE_KEY=<private key (base64url encoded)>
VAPID_PUBLIC_KEY=<public key (base64url encoded)>
VAPID_SUBJECT=mailto:admin@yourdomain.com
```

## FCM (Android — optional)

1. Create a Firebase project at https://console.firebase.google.com
2. Go to Project Settings → Service accounts → Generate new private key
3. Download the JSON file
4. Set environment variables:
```
FCM_SERVICE_ACCOUNT_JSON=<contents of the JSON file>
FCM_PROJECT_ID=<your Firebase project ID>
```

## APNs (iOS — optional)

1. In Apple Developer portal: Certificates → Keys → Create a new key with APNs enabled
2. Download the `.p8` file
3. Note the Key ID and your Team ID
4. Set environment variables:
```
APNS_KEY_PEM=<contents of the .p8 file>
APNS_KEY_ID=<10-character key ID>
APNS_TEAM_ID=<10-character team ID>
APNS_BUNDLE_ID=<your app bundle ID, e.g. com.example.together>
APNS_SANDBOX=true   # use 'false' for production
```

## Testing

After setting VAPID keys, open the Together web app and go to user settings → notifications to enable push notifications.
