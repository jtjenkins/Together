# Signing Setup Guide

This guide covers setting up code signing for Android APK and Linux packages (.deb, .rpm, AppImage).

> **Note:** The signing keys have already been set up for this repository. The public key is available at `together-signing-public.asc` for users to verify signatures.

## Android Signing

### 1. Generate Keystore

Run the setup script locally:

```bash
cd scripts
chmod +x setup-android-keystore.sh
./setup-android-keystore.sh
```

This creates `together-release.keystore`.

### 2. Convert to Base64 for GitHub

```bash
cat together-release.keystore | base64 > keystore-base64.txt
```

### 3. Add GitHub Secrets

Go to your repository → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `ANDROID_KEYSTORE` | Contents of `keystore-base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | Password you entered during keystore creation |
| `ANDROID_KEY_ALIAS` | Usually `together` |
| `ANDROID_KEY_PASSWORD` | Key password (often same as keystore password) |

### 4. Backup Your Keystore

**CRITICAL**: Store the keystore file securely! You cannot update Android apps without it.

Options:
- Password manager attachment
- Encrypted cloud storage
- USB drive in a safe location

## Linux GPG Signing

### 1. Generate GPG Key

Run the setup script locally:

```bash
cd scripts
chmod +x setup-gpg-signing.sh
./setup-gpg-signing.sh
```

This creates:
- `together-signing-private.key` - Keep this secret
- `together-signing-public.asc` - Distribute with your packages

### 2. Add GitHub Secrets

Go to your repository → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `GPG_PRIVATE_KEY` | Contents of `together-signing-private.key` |
| `GPG_KEY_ID` | The key ID shown by the script |

### 3. Distribute Public Key

Users need your public key to verify signatures:

**For APT (.deb):**
```bash
# Users run this:
curl -fsSL https://your-domain.com/together-signing-public.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/together.gpg
```

**For RPM (.rpm):**
```bash
# Users run this:
sudo rpm --import https://your-domain.com/together-signing-public.asc
```

**For AppImage:**
```bash
# Users run this:
gpg --import together-signing-public.asc
gpg --verify Together-*.AppImage.sig
```

## Verification

After setup, releases will include:

- **Android**: Signed APK that can be uploaded to Play Store
- **Linux .deb**: GPG signature embedded in package
- **Linux .rpm**: GPG signature embedded in package  
- **AppImage**: Separate `.AppImage.sig` signature file

## Security Notes

1. **Never commit keystore or GPG private keys to the repository**
2. **Use GitHub Secrets for CI/CD** - they're encrypted and never exposed in logs
3. **Backup your keystore** - lost keystores mean you can't update your Android app
4. **Keep GPG key offline** - store securely and use only for releases