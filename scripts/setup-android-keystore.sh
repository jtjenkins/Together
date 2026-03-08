#!/bin/bash
# Generate Android signing keystore
# Run this locally, then upload the .keystore file to GitHub Secrets

set -e

KEYSTORE_NAME="together-release.keystore"
KEY_ALIAS="together"

echo "=== Android Keystore Generator ==="
echo ""
echo "This will create a release keystore for signing Android apps."
echo "IMPORTANT: Keep this keystore safe! You'll need it for all future releases."
echo ""

read -p "Enter your name or organization: " CERT_NAME
read -p "Enter your email: " CERT_EMAIL
read -p "Enter your organization (optional, press Enter to skip): " CERT_ORG
read -p "Enter your country code (e.g., US, UK, CA): " CERT_COUNTRY

# Build the distinguished name
DN="CN=$CERT_NAME"
[ -n "$CERT_EMAIL" ] && DN="$DN, EMAILADDRESS=$CERT_EMAIL"
[ -n "$CERT_ORG" ] && DN="$DN, O=$CERT_ORG"
[ -n "$CERT_COUNTRY" ] && DN="$DN, C=$CERT_COUNTRY"

echo ""
echo "Creating keystore with distinguished name:"
echo "  $DN"
echo ""

# Generate the keystore
keytool -genkeypair \
    -v \
    -keystore "$KEYSTORE_NAME" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "$DN" \
    -storetype PKCS12

echo ""
echo "=== Keystore Created ==="
echo ""
echo "File: $KEYSTORE_NAME"
echo "Alias: $KEY_ALIAS"
echo ""
echo "Next steps:"
echo "  1. Store this keystore file securely (backup it up!)"
echo "  2. Convert to base64 for GitHub Secrets:"
echo ""
echo "     cat $KEYSTORE_NAME | base64 > keystore-base64.txt"
echo ""
echo "  3. Add to GitHub repository secrets:"
echo "     - ANDROID_KEYSTORE: contents of keystore-base64.txt"
echo "     - ANDROID_KEYSTORE_PASSWORD: the password you entered"
echo "     - ANDROID_KEY_ALIAS: $KEY_ALIAS"
echo "     - ANDROID_KEY_PASSWORD: the key password (same as keystore if you kept it simple)"